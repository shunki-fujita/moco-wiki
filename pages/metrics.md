---
tags: [operations]
sources:
  - moco@40f54d72:pkg/metrics/metrics.go
  - moco@40f54d72:docs/metrics.md
  - moco-agent@a649f51:metrics/metrics.go
last_updated: 2026-08-19
---

# メトリクス リファレンス

MOCO が出す Prometheus メトリクスの全一覧。発生源は 3 つ: moco-controller (:8080)、moco-agent (:8080)、任意の mysqld-exporter (:9104)。「どれを監視すべきか」の絞り込みは [operations](operations.md) を参照。

## moco-controller — クラスタ管理 (moco_cluster_*)

ラベルは `name` / `namespace`（例外は表中に明記）。ClusterManager の維持ループ（updateStatus）と Reconciler が更新する（`pkg/metrics/metrics.go`）。

| メトリクス | 型 | 意味 |
|---|---|---|
| `checks_total` | Counter | 維持ループの実行回数（1 分ごと + イベント契機） |
| `errors_total` | Counter | 維持ループのエラー回数 |
| `available` / `healthy` | Gauge | condition の値をそのまま反映（1/0）。**clustering 停止中は NaN** |
| `switchover_total` / `failover_total` | Counter | primary 交代の回数 |
| `replicas` / `ready_replicas` / `errant_replicas` | Gauge | インスタンス数 / Ready Pod 数 / errant 数 |
| `processing_time_seconds` | Histogram | 1 サイクルの処理時間（バケット 0.1s〜30s） |
| `volume_resized_total` / `volume_resized_errors_total` | Counter | PVC 拡張の成否（失敗は reconcile ごとに増え続ける） |
| `statefulset_recreate_total` / `statefulset_recreate_errors_total` | Counter | StatefulSet 再作成の成否 |
| `clustering_stopped` / `reconciliation_stopped` | Gauge | 停止アノテーションの状態（1/0） |
| `current_replicas` / `updated_replicas` | Gauge | ローリングアップデートの進捗（StatefulSet の status の値をそのまま反映） |
| `last_partition_updated` | Gauge | 最後に partition を下げた時刻 |
| `partition_update_retries_total` | Counter | partition 更新のリトライ回数。**ラベルは `namespace` のみ**（`name` なし） |

> **Note** `partition_update_retries_total` に `name` ラベルが無いのは実装がそう定義しているため。docs/metrics.md は「すべて name/namespace 付き」と読める → [docs-discrepancies](docs-discrepancies.md) #9

このほか controller-runtime 標準の `controller_runtime_*`、Go ランタイム / プロセスメトリクスも同じ :8080 に出る。

## moco-controller — バックアップ (moco_backup_*)

ラベルは `name` / `namespace`。バックアップ Job の成功時に `status.backup` と同時に更新される。

| メトリクス | 意味 |
|---|---|
| `timestamp` | 最後に成功したバックアップの UNIX 時刻。**鮮度監視はこれ** |
| `elapsed_seconds` | 所要時間 |
| `dump_bytes` / `binlog_bytes` | 圧縮後のフルダンプ / binlog サイズ |
| `workdir_usage_bytes` | 作業ディレクトリの最大使用量（workVolume のサイジングに使う） |
| `warnings` | 直近成功バックアップの warning 数（binlog スキップ等） |

## moco-agent — インスタンス (moco_instance_*)

ラベルは `name` / `index`（**namespace が無い**点に注意。スクレイプ設定で補う）。詳細な意味と落とし穴は [moco-agent](moco-agent.md) を参照。

| メトリクス | 型 | 注意 |
|---|---|---|
| `replication_delay_seconds` | Gauge | readiness 判定時に更新。**primary とトランザクション未受信のレプリカでは動的に unregister されメトリクス自体が消える** |
| `clone_count` / `clone_failure_count` | Counter | |
| `clone_duration_seconds` | Summary | 分位点 0.5 / 0.9 / 0.99 |
| `clone_in_progress` | Gauge | |
| `log_rotation_count` | Counter | **ConstLabels 指定漏れで `name`/`index` ラベルが付かない**（→ [docs-discrepancies](docs-discrepancies.md) #8） |
| `log_rotation_failure_count` / `log_rotation_duration_seconds` | Counter / Summary | |

同じ :8080 に gRPC サーバメトリクス（`grpc_server_*`）、Go ランタイム / プロセスメトリクスも出る（`moco-agent@a649f51:metrics/metrics.go#Init`）。

## mysqld-exporter (任意)

`spec.collectors` を非空にすると mysqld_exporter サイドカーが :9104 で mysqld 自体のメトリクスを出す。ユーザは `moco-exporter` 権限の範囲（PROCESS, REPLICATION CLIENT, SELECT）。

## スクレイプ設定

- Helm の `monitoring.enabled=true` で controller / agent / mysqld-exporter の **PodMonitor が 3 つ**作られる（[development](development.md)）
- 生の Prometheus 設定例は `docs/metrics.md` にある。ポイントはコンテナポート名でのフィルタ（`metrics` / `agent-metrics` / `mysqld-metrics`）と、mysqld-exporter に Pod ラベルから `name` / `index` / `role` ラベルを relabel で付与すること

## 関連

- [operations](operations.md) — アラートに使う最小セットの選定
- [moco-agent](moco-agent.md) — agent メトリクスの実装詳細
- [rolling-update](rolling-update.md) — partition 系メトリクスの背景
