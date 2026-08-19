---
tags: [user-guide]
sources:
  - moco@40f54d72:api/v1beta2/backuppolicy_types.go
  - moco@40f54d72:api/v1beta2/backuppolicy_webhook.go
  - moco@40f54d72:api/v1beta2/job_types.go
last_updated: 2026-08-19
---

# BackupPolicy CRD と JobConfig

status を持たない spec のみの namespace リソース。[MySQLCluster](crd-mysqlcluster.md) の `spec.backupPolicyName` から参照される。**MySQLCluster と同じ namespace に置く必要がある。**

## BackupPolicySpec

| フィールド | デフォルト | 意味 |
|---|---|---|
| `schedule` | 必須 | cron 形式。webhook で `cron.ParseStandard` により検証 |
| `timeZone` | nil | CronJob の timeZone へ |
| `jobConfig` | 必須 | 下記 JobConfig |
| `concurrencyPolicy` | Allow | CronJob へコピー |
| `startingDeadlineSeconds` | nil | 〃 |
| `activeDeadlineSeconds` | nil | jobTemplate へ |
| `backoffLimit` | 6 | 〃 |
| `successfulJobsHistoryLimit` / `failedJobsHistoryLimit` | 3 / 1 | CronJob へ |

> **Warning** MySQLCluster から参照されている間は**削除できない**（validating webhook が同一 namespace の MySQLCluster を列挙して拒否。`backuppolicy_webhook.go`）。

## JobConfig（backup と restore で共通）

| フィールド | デフォルト | 意味 |
|---|---|---|
| `serviceAccountName` | 必須 | Job の SA。controller が Role/RoleBinding を紐づける |
| `workVolume` | 必須 | 作業ディレクトリ。**generic ephemeral volume 推奨、emptyDir 非推奨** |
| `threads` | 4 | mysqlsh・zstd の並列度 |
| `cpu` / `memory` | 4 / 4Gi | requests。`maxCpu` / `maxMemory` 未指定なら limits なし |
| `env` / `envFrom` | — | ストレージ認証情報の注入 |
| `affinity` / `volumes` / `volumeMounts` | — | 追加 CA のマウント等 |

## BucketConfig

| フィールド | 意味 |
|---|---|
| `bucketName` | 必須（MinLength=1） |
| `region` | `AWS_REGION` 環境変数でも可 |
| `endpointURL` | 非 AWS 用。`^https?://.*` を検証 |
| `usePathStyle` | true で path-style URL |
| `backendType` | enum: `s3`（既定）/ `gcs` / `azure` |
| `caCert` | システム既定に追加する CA 証明書パス |

認証: S3 は `AWS_*` 環境変数 or EKS IRSA、GCS は `GOOGLE_APPLICATION_CREDENTIALS`、Azure は `AZURE_STORAGE_CONNECTION_STRING` ほか。MinIO 等の S3 互換でも動作する。

根拠: `api/v1beta2/job_types.go`

## 関連

- [backup-restore](backup-restore.md) — この設定で動くバックアップの仕組み
