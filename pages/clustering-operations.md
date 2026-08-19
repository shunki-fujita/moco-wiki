---
tags: [internals]
sources:
  - moco@40f54d72:clustering/operations.go
  - moco@40f54d72:pkg/dbop/replication.go
  - moco@40f54d72:pkg/dbop/gtid.go
last_updated: 2026-08-19
---

# switchover / failover / configure

[クラスタ状態](clustering-states.md)に応じて ClusterManager が実行する操作の実装詳細。

## switchover — 計画的な primary 交代

primary Pod に `deletionTimestamp` が付く（ローリングアップデート等）か、`moco.cybozu.com/demote: true` アノテーションが付くとトリガー。候補は「正常なレプリカのうち**最小 ordinal**」。

1. primary を `super_read_only=1` に。**10 秒**（preStop 20 秒の半分）で終わらなければ接続を KILL して待ち直す
2. 100ms 後にもう一度接続を KILL
3. 候補レプリカが primary の GTID に追いつくのを最大 **50 秒**待つ（`WaitForGTID`）
4. `status.currentPrimaryIndex` を更新（次サイクルの configure で新 primary が書き込み可能になる）。demote アノテーションを削除

根拠: `clustering/operations.go#switchover`

## failover — 障害時の primary 昇格

1. **全レプリカの IO_THREAD を停止** — 旧 primary が semi-sync ACK を得られなくなり書き込み不能になる（split-brain 防止）
2. errant でないレプリカから `GTID_SUBSET` の包含比較で**最も GTID が進んだもの**を選出（`FindTopRunner`）。`Retrieved_Gtid_Set` と `Executed_Gtid_Set` の**和集合**で比較する（failover 直後で Retrieved が空のケースに備える）
3. Retrieved_Gtid_Set の適用完了を最大 50 秒待ち、`currentPrimaryIndex` を更新

> **Note** switchover は「最小 ordinal」、failover は「最も進んだ GTID」と**選出基準が異なる**。failover は DecideState が選んだ候補を `FindTopRunner` の結果で上書きする（`operations.go#failover`, `pkg/dbop/gtid.go#FindTopRunner`）。

## configure — Degraded / Incomplete からの復旧

冪等な復旧処理。実行順:

1. 役割が変わった Pod（errant 含む）から `moco.cybozu.com/role` ラベルを剥がす — ユーザトラフィックを Service から外す
2. 300ms（`MOCO_ROLE_WAIT_DURATION` で変更可）待って、該当インスタンスの接続を KILL
3. primary の設定: semi-sync primary を有効化。intermediate primary の場合は `super_read_only` のまま外部ソースへ**非** semi-sync でレプリケーション開始
4. 各レプリカを構成（下記）
5. 役割ラベルを付け直す（errant には付けない）
6. primary を書き込み可能に（`read_only=0`）、Event `Writable` を発行

### configureReplica の要点

- **CLONE の実行条件**: レプリカの `gtid_executed` が空 ∧ primary の `gtid_executed` が非空 ∧ `ReplicaStatus` が nil、の 3 条件 AND。[moco-agent](moco-agent.md) 経由で primary から `CLONE INSTANCE` し、再起動を最大 60 秒待つ
- **binlog 欠損の防御**: `GTID_SUBTRACT(primary の gtid_purged, レプリカの gtid_executed)` が非空なら「必要な binlog が primary に無い」としてエラーで中断
- errant レプリカは IO_THREAD を止めるだけで再開しない（隔離）
- `ConfigureReplica`（レプリケーション再設定）の条件: ReplicaStatus が nil / IO 停止中 / SourceHost 不一致 / semi-sync 設定不一致 のいずれか

根拠: `clustering/operations.go#configure`, `#configureReplica`, `#configurePrimary`

## semi-sync 設定

| 設定 | 値 |
|---|---|
| `rpl_semi_sync_master_timeout` | **24 時間**（86400000 ms）— 非同期への劣化を事実上禁止 |
| `rpl_semi_sync_master_wait_for_slave_count` | `replicas / 2`（5 台なら 2）。`replicas=1` では semi-sync 設定なし |
| レプリケーション構文 | GTID ベース（`SOURCE_AUTO_POSITION=1`）。MySQL 8.4 は `CHANGE REPLICATION SOURCE TO`、8.0 は `CHANGE MASTER TO` に自動切替 |
| intermediate primary の外部レプリケーション | **非同期**（semi-sync ではない） |

根拠: `pkg/dbop/replication.go`

## errant transaction

- **検出**: primary 上で `GTID_SUBTRACT(replicaGTID, primaryGTID)` を評価し、差分に primary 以外の UUID があれば errant。**primary 自身の UUID の差分は無視**（高負荷時にレプリカの gtid_executed が一時的に先行することがあるため）。primary ダウン中は `status.errantReplicaList` から復元（`clustering/status.go#containErrantTransactions`）
- **扱い**: レプリケーション停止のまま隔離。role ラベルを剥がして Service から外し、failover 候補からも除外
- **復旧**: ユーザが PVC + Pod を削除して再初期化（CLONE で作り直される）→ [operations](operations.md)

## 落とし穴

- switchover のタイムアウトは 10 秒固定（preStop 20 秒 ÷ 2）。超えると failover 経路に落ちうる
- `PreventPodDeletion` が立っている間は switchover が保留される

## 関連

- [clustering-states](clustering-states.md) — どの状態でどの操作が走るか
- [dbop](dbop.md) — ここで使う SQL 操作の実装（FindTopRunner / KillConnections 等）
- [rolling-update](rolling-update.md) — switchover がローリングアップデートに組み込まれる仕組み
