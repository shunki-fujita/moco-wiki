---
tags: [internals]
sources:
  - moco@40f54d72:pkg/dbop/
last_updated: 2026-08-19
---

# dbop — mysqld への SQL 操作層

`pkg/dbop` は ClusterManager が mysqld に発行する SQL をすべて閉じ込めた抽象層。[クラスタ状態判定](clustering-states.md)の GatherStatus と[各種操作](clustering-operations.md)は、この層の `Operator` インターフェース越しにのみ mysqld と会話する。テストは Docker 上の実 MySQL に対して走る（`make test-dbop`、[development](development.md) 参照）。

## Operator インターフェース

インスタンス 1 台につき 1 つ生成される（`pkg/dbop/operator.go#Operator`）。

| メソッド | 発行する SQL（要約） |
|---|---|
| `GetStatus` | 下記「状態収集」の 5 クエリ |
| `SubtractGTID` / `IsSubsetGTID` | `SELECT GTID_SUBTRACT(?,?)` / `SELECT GTID_SUBSET(?,?)` |
| `ConfigureReplica` | `STOP REPLICA` → `CHANGE REPLICATION SOURCE TO`（下記）→ semi-sync 変数 → `START REPLICA` |
| `ConfigurePrimary` | `rpl_semi_sync_master_timeout=24h` / `wait_for_slave_count` / `enabled=ON` |
| `StopReplicaIOThread` | `STOP REPLICA IO_THREAD`（failover 前の書き込み封じ） |
| `WaitForGTID` | `SELECT WAIT_FOR_EXECUTED_GTID_SET(?, ?)`。タイムアウトで `ErrTimeout` |
| `SetReadOnly(true)` | `SET GLOBAL super_read_only=1` |
| `SetReadOnly(false)` | `STOP REPLICA` → `RESET REPLICA` → `SET GLOBAL read_only=0`（primary 昇格） |
| `KillConnections` | PROCESSLIST を見て `KILL CONNECTION`（下記） |

> **Note** GTID set の包含・差分計算を **Go では実装せず MySQL の GTID 関数に委譲**しているのが設計上のポイント。GTID set のパーサを自前で持たないため、比較のたびに mysqld への問い合わせが発生する（`pkg/dbop/gtid.go`）。

## 接続の性質

`moco-admin` ユーザで admin ポート (33062) に TCP 接続する。connTimeout 5 秒 / readTimeout 1 分、アイドル接続は 1 本のみ保持（30 秒で破棄）。TLS はなし（[security](security.md) 参照）。プレースホルダはクライアント側展開（`InterpolateParams=true`）だが、値はすべて controller 内部由来（`pkg/dbop/operator.go#defaultFactory.New`）。

`OperatorFactory` は `Resolver` で Pod IP を解決してから Operator を作る。**解決に失敗すると全メソッドが `ErrNop` を返す `NopOperator` を返す**（エラーにしない）。Pod がまだ存在しない index を「落ちているインスタンス」として扱うための仕掛け（`pkg/dbop/nop.go`）。

## 状態収集（GetStatus）

`MySQLInstanceStatus` に詰められる 5 クエリ（`pkg/dbop/status.go#GetStatus`）:

| クエリ | 結果 |
|---|---|
| `SELECT @@server_uuid, @@gtid_executed, @@gtid_purged, @@read_only, @@super_read_only, semi-sync 変数×3` | `GlobalVariables` |
| `performance_schema.global_status` の `Rpl_semi_sync_master_wait_sessions` | `GlobalStatus`（hangup レプリカ検出に使う） |
| `SHOW REPLICAS` | `ReplicaHosts`（primary から見えるレプリカ一覧） |
| `SHOW REPLICA STATUS` | `ReplicaStatus`。**非レプリカでは nil**（`sql.ErrNoRows` を nil に変換） |
| `performance_schema.clone_status` の `state` | `CloneStatus`。クローン歴がなければ nil |

`ReplicaStatus` は `SHOW REPLICA STATUS` の全カラムを写した巨大な構造体だが、reconcile が実際に使うのはエラー番号・`Source_Host`・`Retrieved/Executed_Gtid_Set`・IO/SQL スレッドの稼働状態だけ（型コメントに明記。`pkg/dbop/types.go#ReplicaStatus`）。

## レプリケーション設定のバージョン分岐

`ConfigureReplica` は `SELECT SUBSTRING_INDEX(VERSION(), '.', 2)` でバージョンを見て構文を切り替える。`8.4` → `CHANGE REPLICATION SOURCE TO`、`8.0` → `CHANGE MASTER TO`、**それ以外は unsupported エラー**。どちらも `AUTO_POSITION=1` + `GET_(SOURCE|MASTER)_PUBLIC_KEY=1`（`pkg/dbop/replication.go#ConfigureReplica`）。

レプリカ側では常に `rpl_semi_sync_master_enabled=OFF` にする（役割の混在防止）。semi-sync の設定値の意味は [clustering-operations](clustering-operations.md) を参照。

## FindTopRunner — failover の選出ロジック

`pkg/dbop/gtid.go#FindTopRunner` は全レプリカの GTID を総当たりで比較し、最も進んだものの index を返す。

1. 各レプリカの `Retrieved_Gtid_Set` と `Executed_Gtid_Set` を**カンマ結合で和集合**にする（failover 直後は Retrieved が空になりうるため）
2. 現在の首位と `GTID_SUBSET` を**双方向**に評価。どちらの部分集合でもなければ分岐がある = `ErrErrantTransactions`
3. 候補が 1 つもなければ `ErrNoTopRunner`

## KillConnections — 除外リスト方式

`information_schema.PROCESSLIST` を列挙し、以下**以外**をすべて `KILL CONNECTION`（`pkg/dbop/kill.go`）:

- MOCO のシステムユーザ 6 種（`pkg/constants` の `MocoSystemUsers`）
- `localhost` からの接続（moco-agent の UNIX ソケット接続を守る）
- `system user`（レプリケーションスレッド）

KILL 対象がすでに消えていた場合の ER_NO_SUCH_THREAD (1094) は無視する。つまり **`moco-readonly` / `moco-writable` を含むアプリの接続はすべて切られる**。switchover / configure での役割変更時に古い接続を確実に排除するための仕様。

## 番兵エラー

呼び出し側は `errors.Is` で分岐する（`pkg/dbop/errors.go`）: `ErrErrantTransactions` / `ErrNoTopRunner` / `ErrTimeout`、および NopOperator の `ErrNop`。

## 関連

- [clustering-states](clustering-states.md) — GetStatus の呼び出し元（GatherStatus）
- [clustering-operations](clustering-operations.md) — Configure* / KillConnections の使われ方
- [moco-agent](moco-agent.md) — agent 側の mysqld 接続（この層とは別実装）
