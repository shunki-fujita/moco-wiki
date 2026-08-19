# Index

全ページの目録。各ページの内容が変わったら一行要約も更新すること（[schema](CLAUDE.md) 参照）。

## User Guide

- [moco-overview](pages/moco-overview.md) — MOCO とは何か。設計思想（semi-sync 採用 / group replication 不採用）、機能一覧、両リポジトリの地図
- [architecture](pages/architecture.md) — Reconciler + ClusterManager の 2 層構成、controller / agent の役割分担、通信経路と mTLS、ポートとユーザ一覧
- [crd-mysqlcluster](pages/crd-mysqlcluster.md) — MySQLCluster の spec 全フィールド、status / conditions、リソース命名規則、webhook 検証
- [crd-backuppolicy](pages/crd-backuppolicy.md) — BackupPolicy と JobConfig / BucketConfig の仕様、削除保護
- [custom-containers](pages/custom-containers.md) — カスタム mysqld イメージの要件、overwriteContainers、ユーザコンテナ追加

## Internals

- [clustering-states](pages/clustering-states.md) — 維持ループ（do サイクル）、8 つのクラスタ状態、判定ロジックと状態遷移図、PreventPodDeletion / hangup 検出
- [dbop](pages/dbop.md) — mysqld への SQL 操作層。Operator インターフェース、GTID 比較の MySQL 委譲、FindTopRunner、KillConnections
- [clustering-operations](pages/clustering-operations.md) — switchover / failover / configure の実装、semi-sync 設定値、errant transaction の検出と隔離
- [reconcile](pages/reconcile.md) — reconcileV1 の 12 ステップ、SSA と差分抑制、Reconciler バージョニング、controller フラグ
- [rolling-update](pages/rolling-update.md) — StatefulSet webhook + partition 制御による安全なローリングアップデート、MySQL バージョンアップの制約
- [backup-restore](pages/backup-restore.md) — mysqlsh dump + binlog 増分、オブジェクトキー、PITR リストアの流れ、運用上の注意
- [object-storage](pages/object-storage.md) — Bucket 抽象と S3 / GCS / Azure 実装、backendType の設計経緯、認証方法
- [pod-anatomy](pages/pod-anatomy.md) — mysqld Pod の init/サイドカー構成、probe と preStop、リソース既定値、volume 一覧
- [mycnf](pages/mycnf.md) — my.cnf の 3 層マージ、強制設定と buffer pool 自動計算、ConfigMap のハッシュ命名と再起動
- [moco-agent](pages/moco-agent.md) — サイドカーの初期化フロー、ユーザ 8 種の権限、Clone gRPC と mTLS、readiness の遅延計測、ログローテ

## Operations

- [operations](pages/operations.md) — kubectl-moco、制御アノテーション、Events 一覧、PVC 拡張/縮小、トラブル時チェックリスト
- [metrics](pages/metrics.md) — controller / agent / exporter の全メトリクス一覧、ラベルの罠、スクレイプ設定

## Development

- [development](pages/development.md) — インストール（Helm/kustomize）、テスト 4 層と e2e、コード生成、リリースフロー、CI マトリクス

## Synthesis

- [security](pages/security.md) — mTLS 証明書チェーン、パスワード管理、RBAC、脆弱性報告ポリシーの横断ガイド
- [docs-discrepancies](pages/docs-discrepancies.md) — 公式 docs とソースの食い違い一覧（9 件、upstream PR 候補）
