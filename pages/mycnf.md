---
tags: [internals]
sources:
  - moco@40f54d72:pkg/mycnf/generator.go
  - moco@40f54d72:controllers/mysqlcluster_controller.go
  - moco@40f54d72:docs/usage.md
last_updated: 2026-08-19
---

# my.cnf の生成

my.cnf は「MOCO の強制設定」「デフォルト値」「ユーザ ConfigMap」の 3 層をマージして生成される。優先順位は **強制設定 > ユーザ設定 > デフォルト**（`pkg/mycnf/generator.go#Generate`）。

## ユーザが上書きできない設定（ConstMycnf）

```ini
port=3306  socket=/run/mysqld.sock  datadir=/var/lib/mysql/data
admin_port=33062  mysqlx_port=33060
enforce_gtid_consistency=ON  gtid_mode=ON  binlog_format=ROW
log_replica_updates=ON  relay_log_recovery=OFF
read_only=ON  super_read_only=ON  skip_replica_start=ON
skip_name_resolve=ON  secure_file_priv=NULL
slow_query_log_file=/var/log/mysql/mysql.slow
loose_replication_optimize_for_static_plugin_config=ON
loose_replication_sender_observe_commit_only=OFF
```

- 起動時は常に read-only。primary 化は [clustering](clustering-operations.md) の仕事
- `loose_replication_sender_observe_commit_only=OFF` は ON だとクラッシュ復帰した replica がレプリケーションを再開できないため（issue #325）

さらに `log_bin` / `log_error` / `skip_log_bin` / `disable_log_bin` はユーザ設定から**強制削除**される。

## 主なデフォルト値（ユーザ上書き可）

| 設定 | 値 | 意図 |
|---|---|---|
| `innodb_buffer_pool_size` | メモリの **70%**（自動計算） | **requests.memory 優先**（limits より）。両方未設定なら下限の 128MiB（`generator.go#calcBufferSize`） |
| `character_set_server` / `collation_server` | utf8mb4 / utf8mb4_unicode_ci | |
| `default_time_zone` | +0:00 | |
| `transaction_isolation` | READ-COMMITTED | |
| `max_connections` | 100000 | |
| `slow_query_log` / `long_query_time` | ON / 2 | `log_slow_extra=ON` も |
| `loose_binlog_transaction_compression` | ON | binlog を 1/3 程度に圧縮 |
| `disabled_storage_engines` | MyISAM | InnoDB のみ |
| `innodb_flush_method` ほか | O_DIRECT, flush_neighbors=0 等 | SSD 前提のチューニング |
| `innodb_undo_log_truncate` | OFF | bug#104573: super_read_only の replica で常に失敗するため |

## ユーザ ConfigMap とのマージ規則

1. キー名は `-` → `_` に正規化される（`thread-cache-size` と書いてもよい）
2. **`loose_` prefix の有無は同一キー**として扱われる — `innodb_numa_interleave: OFF` と書くと既定の `loose_innodb_numa_interleave: ON` が置き換わる
3. 未知のキーは検証されずそのまま出力される（typo に注意）
4. 複数回指定が必要なオプション（`performance-schema-instrument` 等）は特殊キー `_include` に生テキストで書く。**中身は無検査**なので `log_bin` 等を壊すこともできてしまう（`docs/usage.md` に警告あり）
5. 末尾に必ず `!includedir /etc/mysql-conf.d` が付き、moco-init が生成した `server_id` / `admin_address` を読み込む
6. 出力はキー順ソートで決定的（reproducible）

```yaml
# 使い方: ConfigMap を作って spec.mysqlConfigMapName で参照
apiVersion: v1
kind: ConfigMap
metadata:
  name: mycnf
data:
  long_query_time: "5"
  innodb_buffer_pool_size: "10G"
```

## ConfigMap のライフサイクル

生成した my.cnf 本文の FNV-1a 32bit ハッシュを名前にした ConfigMap（`moco-<name>.<hash>`）が作られる。内容が変わると**別名の ConfigMap が作られ**、StatefulSet の参照が変わって mysqld のローリング再起動が走る。古い世代は `--mysql-configmap-history-limit`（既定 10）まで保持（`controllers/mysqlcluster_controller.go#reconcileV1MyCnf`）。

> **Note** 設定変更 = mysqld 再起動、と覚えておくこと。

## 関連

- [pod-anatomy](pod-anatomy.md) — my.cnf がマウントされる場所
- [crd-mysqlcluster](crd-mysqlcluster.md) — `mysqlConfigMapName` フィールド
