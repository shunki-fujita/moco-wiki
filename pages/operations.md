---
tags: [operations]
sources:
  - moco@40f54d72:cmd/kubectl-moco/
  - moco@40f54d72:docs/usage.md
  - moco@40f54d72:docs/change-pvc-template.md
  - moco@40f54d72:docs/metrics.md
  - moco@40f54d72:pkg/constants/meta.go
last_updated: 2026-08-19
---

# 運用ノート

日常運用で使うインタフェースと、コードから読み取れる実務上の注意点。

## kubectl-moco

| コマンド | 内容 |
|---|---|
| `kubectl moco mysql CLUSTER -- ...` | mysqld コンテナに **exec** して mysql クライアントを実行（port-forward ではない）。パスワードは Pod にマウント済みの `/mysql-credentials/<user>-my.cnf` を `--defaults-extra-file` で読むため手元に降りない。`-u`（既定 moco-readonly）、`--index`（既定 primary）、`-i` / `-t` |
| `kubectl moco credential CLUSTER` | Secret からパスワード取得。`--format plain`（既定）/ `mycnf`。対象は moco-readonly / moco-writable / moco-admin のみ |
| `kubectl moco switchover CLUSTER` | 現 primary Pod に `moco.cybozu.com/demote: true` を patch するだけ。offline と replicas=1 では拒否 |
| `kubectl moco stop\|start clustering CLUSTER` | failover 等の自動操作を停止/再開 |
| `kubectl moco stop\|start reconciliation CLUSTER` | リソース reconcile を停止/再開 |

インストールは krew（`kubectl krew install moco`）か GitHub releases。

## 制御用アノテーション

| アノテーション | 対象 | 効果 |
|---|---|---|
| `moco.cybozu.com/demote: "true"` | Pod | switchover をトリガー |
| `moco.cybozu.com/clustering-stopped: "true"` | MySQLCluster | ClusterManager を Pause。Available/Healthy が Unknown、メトリクスは NaN |
| `moco.cybozu.com/reconciliation-stopped: "true"` | MySQLCluster | reconcile を停止 |
| `moco.cybozu.com/force-rolling-update: "true"` | MySQLCluster | partition 制御をバイパス |
| `moco.cybozu.com/prevent-delete: "true"` | Pod（MOCO が自動付与） | `maxDelaySecondsForPodDeletion` 超過中の primary 削除ブロック（docs 未記載機能） |

根拠: `pkg/constants/meta.go`

## PVC の拡張と縮小

- **拡張は自動**: `spec.volumeClaimTemplates` のサイズを増やすだけ。StorageClass の `allowVolumeExpansion` が false だと webhook で拒否。StatefulSet テンプレートは不変なので controller が orphan 削除 → 再作成する（Pod は残る）
- online expansion 非対応のストレージでは Pod 再起動を手動で行う
- pvc-autoresizer 等で実 PVC が既に大きい場合、controller は縮小方向の更新をしない
- **縮小は手動**: テンプレートを小さくした後、1 台ずつ PVC + Pod を削除 → CLONE 再作成 → Healthy を待つ、を繰り返す

根拠: `docs/change-pvc-template.md`, `controllers/pvc.go`

> **Warning** **MySQLCluster を削除すると PVC も消える**（PVC に ownerReference が付く）。データを残すには削除前に PVC の `metadata.ownerReferences` を外すこと（`docs/usage.md`）。

## 見るべきメトリクス

| メトリクス | 意味 |
|---|---|
| `moco_cluster_available` / `moco_cluster_healthy` | Available / Healthy condition。healthy=0 が続いたらレプリカ障害か errant |
| `moco_cluster_switchover_total` / `failover_total` | 交代回数。failover の増加は要調査 |
| `moco_cluster_errant_replicas` | 0 以外なら該当レプリカの再初期化が必要 |
| `moco_cluster_clustering_stopped` / `reconciliation_stopped` | 止めっぱなしの検知に |
| `moco_cluster_volume_resized_total` / `statefulset_recreate_total` | PVC リサイズ / StatefulSet 再作成の記録 |
| `moco_backup_timestamp` / `moco_backup_warnings` | バックアップの鮮度と警告 |
| `moco_instance_replication_delay_seconds` | agent 発のレプリカ遅延。**primary では存在しない**（動的登録） |

Helm の `monitoring.enabled=true` で controller / agent / mysqld-exporter の PodMonitor が 3 つ作られる。

## 読み書きの止め方（メンテナンス）

- クラスタを read-only にしたい: `kubectl moco stop clustering` してから `SET GLOBAL super_read_only=1`。clustering が動いていると MOCO が primary を writable に戻してしまう
- 計算資源を解放したい（データは残す）: `spec.offline: true` — StatefulSet が 0 replica になる

## トラブル時のチェックリスト

- **クラスタが Lost** — 自動復旧なし。`spec.restore` 付きの新クラスタを作って[バックアップから復元](backup-restore.md)
- **errant replica が出た** — 該当 index の PVC と Pod を削除して再初期化（CLONE で復旧）。`kubectl delete --wait=false pvc mysql-data-moco-<name>-<i>` → `kubectl delete --grace-period=1 pod moco-<name>-<i>`。StatefulSet controller が PVC 削除前に pending Pod を作ることがあるので消し続ける
- **操作が何も起きない** — Pod が 1 つでも欠けていると ClusterManager は判定を打ち切る。まず Pod を replicas 数まで戻す
- **ローリングアップデートが進まない** — [partition 制御](rolling-update.md)は Healthy のときしか進まない。`Healthy` / `ClusteringActive` condition を確認
- **Pod が Ready にならない** — Ready の実体は [moco-agent](moco-agent.md) の `/readyz`。クローン中 / レプリケーションスレッド停止 / 遅延超過 / 起動直後でトランザクション未受信、のどれかで 503
- **バックアップが失敗する** — offline でないか、Pod 数が replicas と一致しているか、workVolume の容量を確認

## 関連

- [rolling-update](rolling-update.md) — MySQL バージョンアップ手順
- [backup-restore](backup-restore.md) — バックアップ運用
