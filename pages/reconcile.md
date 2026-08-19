---
tags: [internals]
sources:
  - moco@40f54d72:controllers/mysqlcluster_controller.go
  - moco@40f54d72:cmd/moco-controller/cmd/
  - moco@40f54d72:docs/reconcile.md
last_updated: 2026-08-19
---

# Reconcile の仕組み

MySQLClusterReconciler は Server-Side Apply（field manager `moco-controller`）で子リソースを管理する。

## moco-controller に載っているもの

| 要素 | 役割 |
|---|---|
| `MySQLClusterReconciler` | 子リソース一式の生成・更新（下記 12 ステップ） |
| `StatefulSetPartitionReconciler` | partition を 1 つずつ下げる → [rolling-update](rolling-update.md) |
| `PodWatcher` | Pod の削除・`demote` アノテーションを検知して ClusterManager に通知 |
| `ClusterManager` | [クラスタリング](clustering-states.md)の維持ループ（Reconciler ではなく常駐 goroutine 群） |
| Webhook ×4 | MySQLCluster (mutating + validating) / BackupPolicy (validating) / StatefulSet (mutating) |
| `cert.Reloader` | gRPC クライアント証明書の定期リロード（1 時間ごと） |

根拠: `cmd/moco-controller/cmd/run.go#subMain`

## reconcileV1 の 12 ステップ

```
 1. Secret        controller Secret (moco-system) → user → my.cnf 用
 2. Certificate   cert-manager Certificate (moco-agent-<ns>.<name>)
 3. gRPC Secret   証明書をクラスタ namespace へコピー (moco-<name>-grpc)
 4. my.cnf ConfigMap        内容ハッシュ付きの名前で生成
 5. fluent-bit ConfigMap    slow-log サイドカー用
 6. ServiceAccount
 7. Service ×3    headless / primary / replica
 8. PVC           リサイズ + ラベル/アノテーション同期
 9. StatefulSet   offline なら replicas=0
10. PDB           maxUnavailable = replicas/2（バックアップ実行中は 0）
11. backup CronJob + Role/RoleBinding
12. restore Job + Role/RoleBinding
→ 最後に ClusterManager.Update() でクラスタリングのループを起動/更新
```

削除時は finalizer `moco.cybozu.com/mysqlcluster` の処理として、ClusterManager の停止、moco-system 側の controller Secret と Certificate の削除、メトリクスのラベル削除が行われる。`moco.cybozu.com/reconciliation-stopped: "true"` の間はステップ全体がスキップされる。

根拠: `controllers/mysqlcluster_controller.go#reconcileV1`

## 生成されるリソースの要点

| リソース | 要点 |
|---|---|
| my.cnf ConfigMap | 名前に内容の FNV-1a ハッシュ（`moco-<name>.<hash>`）。内容変更 = 新 ConfigMap → StatefulSet 更新。古い世代は `--mysql-configmap-history-limit`（既定 10）まで保持 → [mycnf](mycnf.md) |
| StatefulSet | `PodManagementPolicy=Parallel`。offline 時は replicas 0。既定で hostname 分散の podAntiAffinity。`terminationGracePeriodSeconds` 既定 300 |
| PDB | `maxUnavailable = replicas/2`。**backup CronJob 実行中は 0**。replicas < 3 または offline では削除 |
| PVC | StatefulSet の PVC テンプレートは不変なので、拡張時は PVC を直接書き換え → StatefulSet を orphan 削除 → 再作成。`--pvc-sync-annotation-keys` / `--pvc-sync-label-keys` のメタデータも同期 |
| headless Service | `publishNotReadyAddresses=true`。primary / replica Service は `moco.cybozu.com/role` ラベルで振り分け |

## Server-Side Apply と差分抑制

すべての子リソースは apply configuration で宣言し、`client.FieldOwner("moco-controller")` + `ForceOwnership` の SSA で適用する。適用前に現在値から自分の所有フィールドを extract して期待値と比較し、**等価なら apply 自体をスキップ**する（`ErrApplyConfigurationNotChanged`）。resourceVersion の無駄な更新と、自分の更新がきっかけで reconcile ループが再び動いてしまうことを防ぐ（`mysqlcluster_controller.go#apply`）。

## Reconciler バージョニング

`status.reconcileInfo.reconcileVersion` を見て、既存 generation には古いバージョンの reconcile ロジックを使い続ける。これにより **MOCO 自体の更新では mysqld Pod が再起動しない**（spec を変更したときに初めて新ロジックが適用される）。

## moco-controller の主要フラグ

| フラグ | デフォルト | 意味 |
|---|---|---|
| `--check-interval` | 1m | クラスタリングの巡回間隔 |
| `--max-concurrent-reconciles` | 8 | 3 つの Reconciler すべてに適用 |
| `--mysql-configmap-history-limit` | 10 | my.cnf ConfigMap の保持世代数 |
| `--partition-update-interval` | 0 | partition を下げる間隔の rate limit |
| `--apiserver-qps-throttle` | 20 | kube-apiserver への QPS（Burst は 1.5 倍） |
| `--agent-image` / `--backup-image` ほか | go.mod / version.go から解決 | サイドカー・バックアップイメージ |
| `--disable-default-security-context` | false | OpenShift 等で既定 securityContext を無効化 |

必須環境変数: `POD_NAMESPACE`（leader election と controller Secret の置き場所）。

## 関連

- [rolling-update](rolling-update.md) — StatefulSet webhook + PartitionReconciler
- [crd-mysqlcluster](crd-mysqlcluster.md) — 入力となる CR
- [pod-anatomy](pod-anatomy.md) — 生成される Pod の中身
