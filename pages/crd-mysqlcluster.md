---
tags: [user-guide]
sources:
  - moco@40f54d72:api/v1beta2/mysqlcluster_types.go
  - moco@40f54d72:api/v1beta2/mysqlcluster_webhook.go
  - moco@40f54d72:api/v1beta2/conversion.go
last_updated: 2026-08-19
---

# MySQLCluster CRD

API グループは `moco.cybozu.com/v1beta2` のみ（storage version）。CRD は MySQLCluster と [BackupPolicy](crd-backuppolicy.md) の 2 つ。`conversion.go` の `Hub()` は将来の多バージョン変換のためのマーカーで、現在 spoke バージョンは存在しない。

## spec 全フィールド

| フィールド | デフォルト | 意味 / 制約 |
|---|---|---|
| `replicas` | 1 | インスタンス数。**正の奇数のみ**、最大 5。**減らすことは禁止**（webhook で拒否） |
| `podTemplate` | 必須 | mysqld Pod のテンプレート。`mysqld` コンテナ必須。システムコンテナ名・ポート・volume 名は予約済み。`overwriteContainers` でシステムコンテナの resources / securityContext のみ上書き可 |
| `volumeClaimTemplates` | 必須 | `mysql-data` という名前の claim が必須。各 claim に storage requests 必須 |
| `primaryServiceTemplate` / `replicaServiceTemplate` | nil | primary / replica Service の annotations / labels / spec を上書き |
| `mysqlConfigMapName` | nil | ユーザ定義 my.cnf の ConfigMap 名（[mycnf](mycnf.md) 参照） |
| `replicationSourceSecretName` | nil | 設定すると外部 MySQL からレプリケートする intermediate primary になる。**新規作成時のみ設定可・変更不可** |
| `collectors` | 空 | 非空なら mysqld_exporter サイドカーを追加 |
| `serverIDBase` | 自動採番 | 0 なら mutating webhook が乱数（1..2^30）を採番 |
| `maxDelaySeconds` | 60 | レプリカ遅延がこれを超えると readiness NG（agent の `--max-delay` へ）。0 で無効 |
| `maxDelaySecondsForPodDeletion` | 0 (無効) | 遅延超過中の primary Pod 削除をブロック（switchover も保留） |
| `startupWaitSeconds` | 3600 | mysqld 起動待ちの上限（startupProbe に反映） |
| `logRotationSchedule` | 空 (agent 既定 5 分毎) | cron。webhook でパース検証 |
| `logRotationSize` | 0 (無効) | サイズ基準ログローテの閾値 |
| `backupPolicyName` | nil | 同一 namespace の BackupPolicy 名 |
| `restore` | nil | PITR 指定。**作成後は編集不可** |
| `disableSlowQueryLogContainer` | false | slow-log サイドカーを作らない |
| `slowQueryLogConfigTmpl` | nil | fluent-bit 設定テンプレート（`{{ .Path }}` がログパスに置換） |
| `agentUseLocalhost` | false | agent が mysqld へ localhost (socket) 接続する |
| `initializeTimezoneData` | false | init container で timezone データを投入 |
| `offline` | false | true でデータを消さずに StatefulSet を 0 replica に |

根拠: `api/v1beta2/mysqlcluster_types.go#MySQLClusterSpec`

## status

| フィールド | 意味 |
|---|---|
| `currentPrimaryIndex` | 現 primary の Pod index（初期 0）。failover / switchover で更新 |
| `syncedReplicas` | primary を含む同期済みインスタンス数 |
| `errantReplicas` / `errantReplicaList` | errant transaction を持つレプリカの数と index リスト |
| `backup` | 最後に成功したバックアップの詳細（time, gtidSet, dumpSize, binlogSize, workDirUsage, warnings …） |
| `restoredTime` | リストア完了時刻。非 nil なら restore Job は二度と作られない |
| `cloned` | 外部ソースからの初期 CLONE 完了フラグ |
| `reconcileInfo` | 最後に reconcile した generation と reconciler バージョン |

### Conditions（7 種類）

| Type | セットする側 | 意味 |
|---|---|---|
| `Initialized` | ClusterManager | クラスタ初期化済み（Cloning / Restoring 中は False） |
| `Available` | ClusterManager | primary が書き込み可能（Healthy または Degraded） |
| `Healthy` | ClusterManager | 全レプリカが健全 |
| `StatefulSetReady` | Reconciler | availableReplicas + revision + observedGeneration 一致で True |
| `ReconcileSuccess` | Reconciler | 直近の reconcile が成功したか |
| `ReconciliationActive` | Reconciler | `reconciliation-stopped` アノテーションで False |
| `ClusteringActive` | Reconciler / ClusterManager | `clustering-stopped` で False。停止中は Available / Healthy が Unknown |

`kubectl get mysqlcluster` の表示列: Available / Healthy / Primary / Synced replicas / Errant replicas / Clustering Active / Reconcile Active / Last backup。

## 生成されるリソース名の規則

```
Pod:            moco-<name>-<index>
StatefulSet / headless Service / SA / user Secret:  moco-<name>
Service:        moco-<name>-primary / moco-<name>-replica
my.cnf Secret:  moco-my-cnf-<name>
my.cnf ConfigMap: moco-<name>.<fnv32a hash>
controller 側 Secret:  mysql-<namespace>.<name>   (moco-system に置かれる)
gRPC 証明書:    moco-agent-<ns>.<name> (Certificate) → moco-<name>-grpc (Secret)
バックアップ:   moco-backup-<name> (CronJob/Role/RoleBinding)
リストア:       moco-restore-<name> (Job/Role/RoleBinding)
```

根拠: `api/v1beta2/mysqlcluster_types.go` の命名ヘルパ群。

> **Note** クラスタ名は **40 文字以下**（StatefulSet / CronJob 名の 52 文字制限から逆算。`mysqlcluster_webhook.go#ValidateCreate`）。

## Webhook による検証

| タイミング | 検証内容 |
|---|---|
| 作成時 (mutating) | finalizer `moco.cybozu.com/mysqlcluster` の付与、`serverIDBase` の採番 |
| 作成時 (validating) | 名前 40 文字以下 / `mysql-data` claim 必須 / replicas 正の奇数 / `mysqld` コンテナ必須 / 予約コンテナ名（`agent`, `slow-log`, `mysqld-exporter`, `moco-init`）・予約ポート（3306, 33060, 33062, 9081）・予約 volume 名（`tmp`, `run`, `var-log`, `mysql-conf`, `mysql-init-conf`, `mysql-conf-secret`, `slow-log-agent-config`）の使用禁止 / cron 形式の検証 |
| 更新時 (validating) | replicas 減少禁止 / `replicationSourceSecretName` の追加・変更禁止 / `restore` 編集不可 / ボリューム拡張は StorageClass の `allowVolumeExpansion` を実際に確認して許可 |

## 関連

- [crd-backuppolicy](crd-backuppolicy.md) — BackupPolicy と JobConfig
- [reconcile](reconcile.md) — この CR から生成されるリソース
- [clustering-states](clustering-states.md) — status.conditions を書く側
