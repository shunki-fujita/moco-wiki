---
tags: [internals]
sources:
  - moco-agent@a649f51:server/
  - moco-agent@a649f51:cmd/
  - moco-agent@a649f51:proto/agentrpc.proto
  - moco-agent@a649f51:cert/cert.go
  - moco@40f54d72:controllers/mysql_container.go
  - moco@40f54d72:clustering/agent.go
last_updated: 2026-08-19
---

# moco-agent — mysqld Pod のサイドカー

別リポジトリ `cybozu-go/moco-agent`（v0.16.0）。MySQL の初期化、readiness/liveness probe、CLONE の gRPC API、slow log ローテーションを担当する。scratch ベースのイメージに 3 バイナリが同梱される。

## 3 つのバイナリ

| バイナリ | 役割 |
|---|---|
| `/moco-agent` | サイドカー本体。初期化 + gRPC (:9080) + probe (:9081) + metrics (:8080) + ログローテ |
| `/moco-init` | init コンテナで実行。`mysqld --initialize-insecure` と instance 固有 my.cnf（`server_id` と `admin_address` の 2 行）の生成。`server_id = serverIDBase + Pod index` |
| `/bin/cp` | scratch イメージに cp が無いための自前実装。`copy-moco-init` init コンテナが使う |

`moco-init` は初期化済み判定に `<data-dir>/moco-initialized` マーカーを使い、書き込み → `syncfs` → rename → ディレクトリ sync の耐障害手順を踏む（`cmd/moco-init/main.go#initMySQL`）。

## 起動シーケンス

1. `POD_NAME` / `AGENT_PASSWORD` / `CLUSTER_NAME` を確認（無ければ即終了）
2. **MySQL 初期化を同期実行**（下記）。終わるまでサーバは立たない
3. mysqld の admin ポート (33062) への TCP 接続プールを作成 — **mysqld が起動していないと agent は起動失敗**
4. cron（ログローテ）、gRPC サーバ（mTLS）、probe HTTP、metrics HTTP を起動。証明書は 1 時間ごとにリロード

根拠: `cmd/moco-agent/cmd/root.go#RunE`

## MySQL 初期化

UNIX ソケット経由でパスワード無し `root@localhost` として接続を試み、**接続できなければ「初期化済み」と判断して何もしない**（MySQL エラー 1045/1524 を「root がもういない」と解釈。`server/connect.go#UserNotExists`）。これが Pod 再起動時の冪等性の要。

接続できた場合（`server/initialize.go#Init`）:

```
read_only=OFF
→ ユーザ 8 種を作成 (partial_revokes=ON)
→ プラグイン導入 (rpl_semi_sync_master / rpl_semi_sync_slave / clone)
→ moco-admin で再接続し root@localhost を DROP
→ RESET MASTER (8.4 では RESET BINARY LOGS AND GTIDS)   ← GTID を空にする
→ super_read_only=ON
```

> **Note** `RESET MASTER` で GTID set を空にするのが重要ポイント。MOCO 本体は「`gtid_executed` が空」を「CLONE してよい空インスタンス」の判定に使う → [clustering-operations](clustering-operations.md)

### 作成される MySQL ユーザと権限

| ユーザ | 権限（要約） |
|---|---|
| `moco-admin` | `ALL WITH GRANT OPTION` + `GRANT PROXY`。controller の操作用 |
| `moco-agent` | BINLOG_ADMIN, CLONE_ADMIN, RELOAD, REPLICATION CLIENT, SELECT, SERVICE_CONNECTION_ADMIN, SYSTEM_VARIABLES_ADMIN |
| `moco-repl` | REPLICATION CLIENT, REPLICATION SLAVE |
| `moco-clone-donor` | BACKUP_ADMIN, SERVICE_CONNECTION_ADMIN |
| `moco-exporter` | PROCESS, REPLICATION CLIENT, SELECT |
| `moco-backup` | BACKUP_ADMIN, EVENT, RELOAD, SELECT, SHOW VIEW, TRIGGER, REPLICATION CLIENT/SLAVE, SERVICE_CONNECTION_ADMIN |
| `moco-readonly` | PROCESS, REPLICATION CLIENT/SLAVE, SELECT, SHOW DATABASES, SHOW VIEW |
| `moco-writable` | CREATE/ALTER/DROP/INSERT/UPDATE/DELETE 等 24 権限 `WITH GRANT OPTION`。ただし `mysql.*` への書き換え系 14 権限は **partial revoke** で剥奪 |

ホストはすべて `'%'`。パスワードは 8 つの環境変数（`ADMIN_PASSWORD` … `WRITABLE_PASSWORD`）から取得し、Secret の `envFrom` で注入される。

> **Warning** 既存ユーザには何もしない（`reset=false`）ため、**Secret のパスワードを変えても既存インスタンスには自動反映されない**。上書きされるのはクローン直後の `InitExternal`（donor のパスワードが混入するため `reset=true` で強制上書き）だけ。

## gRPC API — メソッドは Clone のみ

サービス `moco.Agent` のメソッドは `/moco.Agent/Clone` の 1 つだけ（`proto/agentrpc.proto`）。

1. 排他ロック（同時実行は `ResourceExhausted`）
2. **`Executed_Gtid_Set` が空でなければ `FailedPrecondition "recipient is not empty"`** — データのあるインスタンスを潰さないガード
3. `clone_valid_donor_list` を設定し、**タイムアウトを付けない UNIX ソケット接続**で `CLONE INSTANCE FROM ...` を実行
4. MySQL エラー 3707（クローン後の自動再起動で接続断）は**成功扱い**
5. mysqld の再起動を待って（既定上限 10 分）、`InitExternal` でパスワード上書き。gRPC がキャンセルされても `context.Background()` で完遂する

Clone は**レプリケーションを開始しない**。`START REPLICA` は MOCO 本体（configure）の責務。

### mTLS

`/grpc-cert` に `ca.crt` / `tls.crt` / `tls.key` が必要。`RequireAndVerifyClientCert` に加えて、クライアント証明書の **CN が文字列 `moco-controller` と完全一致**しないと拒否（`cert/cert.go#verifyConnection`）。cert-manager のローテーションには 1 時間ごとの再読込で追随。

## probe の実装

probe HTTP (:9081) は agent が提供するが、**mysqld コンテナの probe として設定される** → [pod-anatomy](pod-anatomy.md)。

| エンドポイント | 判定 |
|---|---|
| `/healthz` (startup / liveness) | admin ポートで `SELECT VERSION()` が通るかだけ |
| `/readyz` (readiness) | ① クローン進行中なら 503 → ② `read_only=false`（= primary）なら**即 200** → ③ レプリケーションスレッド停止/エラーなら 503 → ④ 遅延判定 |

遅延は `Seconds_Behind_Source` ではなく、performance_schema から取った**「受信済み最新トランザクションのコミット時刻 − 適用済み最新トランザクションのコミット時刻」**で計測する（`lag = queued − applied`）。`--max-delay`（`maxDelaySeconds`、既定 60s）以上なら 503。起動直後でまだトランザクションを受信していない場合は「遅延 0」と誤判定せず `--transaction-queueing-wait`（既定 1m）の間 503 を返す（`server/mysqld_health.go#MySQLDReady`）。

## ログローテーション

対象は **slow query log のみ**（`/var/log/mysql/mysql.slow`）。cron（既定 5 分ごと）で `mysql.slow → mysql.slow.0` に rename して `FLUSH LOCAL SLOW LOGS`。**保持は 1 世代のみ**。`logRotationSize` > 0 なら 1 秒ごとのサイズ監視でもローテーションが実行される（`server/rotate.go#RotateLog`）。

## MySQL への接続の使い分け

| 接続 | 用途 |
|---|---|
| TCP :33062 (admin port) | 常設プール（`moco-agent` ユーザ）。probe・ローテ用。admin 接続は専用スレッド処理のため `max_connections` 枯渇時でも probe が通る。ReadTimeout 30s |
| UNIX ソケット `/run/mysqld.sock` | 初期化（root → moco-admin）と CLONE。**タイムアウト無し**。TCP リスナー未起動の初期化フェーズでも使える |

## メトリクス（moco_instance_*）

全メトリクスの一覧表は [metrics](metrics.md) にある。ここでは実装上の注意のみ。

ラベルは `name`（クラスタ名）と `index`（Pod index）。`replication_delay_seconds`（readiness 判定時に更新）、`clone_count` / `clone_failure_count` / `clone_duration_seconds` / `clone_in_progress`、`log_rotation_*`。gRPC サーバメトリクス（`grpc_server_*`）も同じ `/metrics` (:8080) に出る。

> **Note** `replication_delay_seconds` は動的に登録/解除されるため、primary やトランザクション未受信のレプリカでは**メトリクス自体が存在しない**。`log_rotation_count` だけ `name`/`index` ラベルが付かない（ConstLabels の指定漏れ）→ [docs-discrepancies](docs-discrepancies.md)

## 関連

- [architecture](architecture.md) — controller との役割分担
- [clustering-operations](clustering-operations.md) — Clone が呼ばれる 2 つのタイミング
- [docs-discrepancies](docs-discrepancies.md) — moco-agent docs の食い違い
