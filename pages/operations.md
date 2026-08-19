---
tags: [operations]
sources:
  - moco@40f54d72:cmd/kubectl-moco/
  - moco@40f54d72:docs/usage.md
  - moco@40f54d72:docs/change-pvc-template.md
  - moco@40f54d72:docs/known_issues.md
  - moco@40f54d72:pkg/constants/meta.go
  - moco@40f54d72:pkg/event/event.go
  - moco@40f54d72:docs/designdoc/clustering_stop.md
  - moco@40f54d72:docs/designdoc/support_reduce_volume_size.md
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

## Kubernetes Events 一覧

トラブル時は `kubectl describe mysqlcluster` / `kubectl get events` でまずこれを見る。定義は `pkg/event/event.go`、発行元は ClusterManager（維持ループ）とバックアップ / リストア Job。

| Reason | Type | 意味 |
|---|---|---|
| `SwitchOver` / `SwitchOverFailed` | Normal / Warning | 計画的な primary 交代の成否（成功時は新 primary の index 付き） |
| `FailOver` / `FailOverFailed` | Normal / Warning | 障害時 failover の成否 |
| `Cloned` / `CloneFailed` | Normal / Warning | レプリカ再作成時の CLONE の成否（instance index 付き） |
| `InitCloned` / `InitCloneFailed` | Normal / Warning | 外部 MySQL からの初期 CLONE（intermediate primary）の成否 |
| `Writable` | Normal | configure 完了で primary が書き込み可能になった |
| `BackupCreated` / `BackupNoBinlog` | Normal / Warning | バックアップ成功 / binlog 抜きで成功（[backup-restore](backup-restore.md)） |
| `Restored` | Normal | リストア完了 |
| `PartitionUpdate` | Normal | **StatefulSet に対して**発行。partition を 1 下げた（`controllers/partition_controller.go`） |

バックアップ / リストア Job は controller を経由せず Event オブジェクトを直接 create する（Job の Role に events create 権限があるのはこのため → [security](security.md)）。

## 既知の問題

`docs/known_issues.md` に登録されているのは 1 件のみで解消済み（8.0.25 以前でのマルチスレッドレプリケーションのクラッシュ復帰問題。現在サポートされる MySQL バージョンでは発生しない）。

## PVC の拡張と縮小

- **拡張は自動**: `spec.volumeClaimTemplates` のサイズを増やすだけ。StorageClass の `allowVolumeExpansion` が false だと webhook で拒否。StatefulSet テンプレートは不変なので controller が orphan 削除 → 再作成する（Pod は残る）
- online expansion 非対応のストレージでは Pod 再起動を手動で行う
- pvc-autoresizer 等で実 PVC が既に大きい場合、controller は縮小方向の更新をしない
- **縮小は手動**: テンプレートを小さくした後、1 台ずつ PVC + Pod を削除 → CLONE 再作成 → Healthy を待つ、を繰り返す

根拠: `docs/change-pvc-template.md`, `controllers/pvc.go`

設計経緯: 拡張の自動化は `docs/designdoc/support_apply_pvc_template_changes.md`（PVC メタデータの書き換えを自動化しないのは他コントローラとの競合を避けるため。失敗は `moco_cluster_volume_resized_errors_total` / `statefulset_recreate_errors_total` が reconcile ごとに増え続けることで検知する設計）。縮小の半自動手順は `docs/designdoc/support_reduce_volume_size.md`（縮小の全自動化は明示的に non-goal）。

> **Warning** **MySQLCluster を削除すると PVC も消える**（PVC に ownerReference が付く）。データを残すには削除前に PVC の `metadata.ownerReferences` を外すこと（`docs/usage.md`）。

## 見るべきメトリクス

アラート向けの最小セット。全メトリクスの一覧は [metrics](metrics.md) を参照。

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
  - clustering 停止機能の元々のユースケースは「レプリカの SQL スレッドを止めて手動で GTID を揃える整合性チェック」（`docs/designdoc/clustering_stop.md`）。停止中にクラスタを壊した場合の復旧は保証されない（non-goal と明記）
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
- [metrics](metrics.md) — メトリクスの全一覧
- [security](security.md) — Secret / 権限まわりの全体像
