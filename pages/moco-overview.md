---
tags: [user-guide]
sources:
  - moco@40f54d72:README.md
  - moco@40f54d72:docs/design.md
  - moco@40f54d72:version.go
last_updated: 2026-08-19
---

# MOCO 概要

MOCO は Cybozu が開発する Kubernetes 上の MySQL オペレータで、**GTID ベースのロスレス準同期レプリケーション**による MySQL クラスタを管理する。制約の多い group replication は採用せず、標準 MySQL との互換性を重視している（`README.md`, `docs/design.md`）。

現行バージョン: v0.36.0。対応: MySQL 8.0.28 / 8.0.43–45 / 8.4.4 / 8.4.8（LTS のみ）、Kubernetes 1.33–1.35。

## 設計上の 3 つの性質

| 性質 | 内容 |
|---|---|
| 互換性 | 標準の MySQL semi-sync replication をそのまま使う。group replication は使わない |
| 安全性 | 書き込みは常に単一 primary のみ。errant transaction を検出しそのレプリカを隔離する |
| 可用性 | primary 障害時の自動 failover、Pod 再起動時の自動 switchover。1 クラスタ最大 5 インスタンス（正の奇数） |

## 主な機能

- MySQLCluster CR ごとの StatefulSet / Service / Secret / PDB などの自動管理 → [reconcile](reconcile.md)
- 自動 switchover / failover → [clustering-operations](clustering-operations.md)
- mysqlsh によるバックアップと Point-in-Time Recovery → [backup-restore](backup-restore.md)
- partition 制御による安全な MySQL バージョンアップ → [rolling-update](rolling-update.md)
- 外部 MySQL からのレプリケーション（intermediate primary）
- `kubectl-moco` プラグイン → [operations](operations.md)

## リポジトリ地図

### cybozu-go/moco（Go 147 ファイル・約 3.3 万行）

| ディレクトリ | 役割 |
|---|---|
| `api/v1beta2/` | CRD の Go 型定義と webhook（v1beta2 が唯一の API バージョン） |
| `clustering/` | クラスタ維持ロジックの中核。MySQLCluster ごとに 1 goroutine |
| `controllers/` | Reconciler 群（MySQLCluster / StatefulSetPartition / PodWatcher） |
| `backup/`, `pkg/bkop/` | バックアップ・リストア。mysqlsh / mysqlbinlog を呼ぶ |
| `pkg/dbop/` | mysqld への SQL 操作抽象 |
| `pkg/mycnf/`, `pkg/bucket/`, `pkg/password/` ほか | my.cnf 生成、ストレージ抽象、パスワード生成、メトリクス、定数 |
| `cmd/` | 3 バイナリ: `moco-controller` / `moco-backup` / `kubectl-moco` |
| `e2e/`, `config/`, `charts/moco/`, `docs/` | E2E、kustomize、Helm、mdBook |

### cybozu-go/moco-agent（Go 22 ファイル）

| ディレクトリ | 役割 |
|---|---|
| `server/` | 初期化（ユーザ・プラグイン・RESET MASTER）、probe、Clone、ログローテ |
| `cmd/` | 3 バイナリ: `moco-agent` / `moco-init` / `cp` |
| `proto/` | gRPC 定義（メソッドは Clone のみ） |
| `cert/`, `metrics/` | mTLS 証明書リロード、Prometheus メトリクス |

## 関連

- [architecture](architecture.md) — コンポーネント構成と通信経路
- [docs-discrepancies](docs-discrepancies.md) — 公式 docs とソースの食い違い一覧
