---
tags: [internals]
sources:
  - moco@40f54d72:pkg/bucket/
  - moco@40f54d72:cmd/moco-backup/cmd/root.go
  - moco@40f54d72:docs/designdoc/object_storage_type.md
last_updated: 2026-08-19
---

# オブジェクトストレージ層 (pkg/bucket)

[バックアップ](backup-restore.md)の保存先を抽象化する層。インターフェースは `Put` / `Get` / `List` の 3 メソッドだけ（`pkg/bucket/interface.go#Bucket`）。moco-backup コマンドが [BucketConfig](crd-backuppolicy.md) の `backendType` を見て実装を選ぶ（`cmd/moco-backup/cmd/root.go`）。

## なぜ backendType があるか（設計経緯）

当初は S3 API のみ対応で「S3 互換ストレージなら何でも使える」建前だったが、**GCS の S3 互換 API が aws-sdk-go-v2 では動かない**（issue #427、aws-sdk-go-v2#1816）ことが判明し、プロバイダを明示的に切り替える `backendType` enum（`s3` 既定 / `gcs` / `azure`）が追加された。既定を s3 にしたのは後方互換のため（`docs/designdoc/object_storage_type.md`）。

## バックエンドごとの実装と認証

| | S3 (`s3.go`) | GCS (`gcs.go`) | Azure Blob (`azure.go`) |
|---|---|---|---|
| SDK | aws-sdk-go-v2 | cloud.google.com/go/storage | azure-sdk-for-go azblob |
| アップロード | multipart（Concurrency 1、パートサイズは下記） | resumable upload、チャンク 16 MiB（SDK 既定） | UploadStream、ブロック 4 MiB |
| 認証 | `AWS_*` 環境変数 / EKS IRSA 等の default config chain | `GOOGLE_APPLICATION_CREDENTIALS`（ADC） | `AZURE_STORAGE_CONNECTION_STRING` があれば接続文字列、無ければ DefaultAzureCredential + `AZURE_STORAGE_ACCOUNT`（必須） |
| endpointURL | `BaseEndpoint` に反映（MinIO 等） | — | serviceURL に反映（Azurite 等） |
| e2e エミュレータ | MinIO | fake-gcs-server | Azurite |

認証情報は JobConfig の `env` / `envFrom` で注入する（[crd-backuppolicy](crd-backuppolicy.md)）。`caCert`（追加 CA）は S3 の HTTP クライアントにのみ適用される。

## S3 のパートサイズ計算

`decidePartSize` は「オブジェクトサイズ ÷ 4096 パートを 128 MiB 単位に切り上げ」る（`pkg/bucket/s3.go`）。つまりパートサイズ 128 MiB のままで **512 GiB** までのオブジェクトを扱え、それを超えると 256 MiB, 384 MiB… と段階的に増える。バックアップ側はダンプの実サイズを `objectSize` として渡す。

## 細部の仕様

- Put は拡張子で Content-Type を付ける: `.tar` → `application/x-tar`、`.zst` → `application/zstd`（S3 / Azure。GCS は付けない）
- List は単純な**前方一致**。`foo1` を渡すと `foo1/...` と `foo11/...` の両方が返るため、呼び出し側はプレフィックスを `/` で終わらせる規約（interface.go のコメントに明記）。[バックアップのキー設計](backup-restore.md)はこの規約前提
- 古いオブジェクトの削除機能は**この層に存在しない**（Delete メソッドが無い）。世代管理はバケットのライフサイクルポリシーで行う

## 関連

- [backup-restore](backup-restore.md) — この層を使う側（キー形式・PITR）
- [crd-backuppolicy](crd-backuppolicy.md) — BucketConfig の仕様
