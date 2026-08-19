---
tags: [synthesis]
sources:
  - moco@40f54d72
  - moco-agent@a649f51
last_updated: 2026-08-19
---

# 公式 docs とソースの食い違い

ソースコードを正として公式ドキュメントと突き合わせた結果見つかった乖離。upstream への PR 候補。
Lint 操作で見つけた食い違いはここに追記する（解消されたら「✅ 解消済み (PR#)」を付ける。行は消さない）。

## cybozu-go/moco

| # | 状態 | 内容 |
|---|---|---|
| 1 | 未報告 | `docs/customize-system-container.md` に「runAsUser=1000 / runAsGroup=1000」と記載だが、実装は **10000**（`pkg/constants/container.go` の `ContainerUID/GID`）。同じ docs/usage.md の例は `fsGroup: 10000` なので docs 内でも矛盾 |
| 2 | 未報告 | `docs/moco-controller.md` のフラグ既定値のイメージバージョン表記（agent 0.15.0 / fluent-bit 3.0.2.1 / exporter 0.15.1.2）が現行値（0.16.0 / 5.0.2.1 / 0.19.0.1）と不一致 |
| 3 | 未報告 | `docs/install-plugin.md` の `kubectl moco -h` 出力例に `start` / `stop` サブコマンドが載っていない |
| 4 | 未報告 | `docs/clustering.md` に `Offline` 状態が未記載（実装 `clustering/status.go` には存在） |
| 5 | 未報告 | `spec.maxDelaySecondsForPodDeletion` と `moco.cybozu.com/prevent-delete` アノテーション: 実装 + e2e（`e2e/prevent_delete_test.go`）はあるが docs に解説ページが無い |
| 9 | 未報告 | `docs/metrics.md` は moco_cluster_* の全メトリクスに `name`/`namespace` ラベルがあると記載だが、`moco_cluster_partition_update_retries_total` だけラベルが `namespace` のみ（`pkg/metrics/metrics.go#Register` の PartitionUpdateRetriesTotalVec） |
| 10 | 報告済み ([PR#903 レビューコメント](https://github.com/cybozu-go/moco/pull/903#discussion_r3810879340)) | 生成 doc `docs/crd_mysqlcluster_v1beta2.md` で `status.backup` / `status.reconcileInfo` / `backup.uuidSet` / `reconcileInfo.reconcileVersion` の Required 列が **true** になっている。実際は型定義で `+optional`（`api/v1beta2/mysqlcluster_types.go#MySQLClusterStatus`）。json タグに `omitempty` が無いフィールドを doc 生成ツールが必須と判定するのが原因 |

## cybozu-go/moco-agent

| # | 状態 | 内容 |
|---|---|---|
| 6 | 未報告 | `docs/moco-agent.md` の環境変数表に `EXPORTER_PASSWORD` / `BACKUP_PASSWORD` が欠落（`server/initialize.go#ensureMOCOUsers` は 8 個すべて必須） |
| 7 | 未報告 | `docs/moco-agent.md` のフラグ一覧に `--mysqld-localhost` が無く、実装に存在しない `--logfile` / `--logformat` / `--loglevel` が載っている（現在は zap 固定） |
| 8 | 未報告 | `docs/metrics.md` は「全メトリクスに name / index ラベルがある」と読めるが、`moco_instance_log_rotation_count` だけ ConstLabels の指定漏れでラベルが付かない（`metrics/metrics.go#Init`）— これは docs というより実装バグの可能性 |

## 関連

- [development](development.md) — upstream への貢献フロー
