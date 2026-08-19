---
tags: [user-guide]
sources:
  - moco@40f54d72:docs/custom-mysqld.md
  - moco@40f54d72:docs/customize-system-container.md
  - moco@40f54d72:docs/designdoc/allow_customize_containers.md
  - moco@40f54d72:api/v1beta2/mysqlcluster_types.go
last_updated: 2026-08-19
---

# コンテナのカスタマイズ

mysqld Pod のコンテナを変える方法は 3 通り: ① mysqld イメージ自体の差し替え、② システムコンテナの `overwriteContainers` による上書き、③ `podTemplate` へのユーザコンテナ追加。Pod の全体像は [pod-anatomy](pod-anatomy.md) を参照。

## ① mysqld イメージの差し替え

ビルド済みイメージは `ghcr.io/cybozu-go/moco/mysql`（Dockerfile は `containers/mysql/<version>/`、リリース手順は [development](development.md)）。自前ビルドする場合の必須条件（`docs/custom-mysqld.md`）:

- `ENTRYPOINT` は `["mysqld"]`
- `USER` は `10000:10000`
- **PATH 上に `sleep` コマンドが存在すること**（preStop フックが `sleep 20` を実行するため → [pod-anatomy](pod-anatomy.md)）

一番簡単なのは公式 Dockerfile のコピー & 編集。ソースビルドの手順例（Ubuntu 24.04、`-DWITH_NUMA=1 -DWITH_TCMALLOC=1`）も docs にある。semi-sync / clone プラグインは MySQL 標準同梱なのでイメージ側の追加作業は不要（有効化は [moco-agent](moco-agent.md) の初期化が行う）。

## ② overwriteContainers — システムコンテナの上書き

MOCO が自動追加するコンテナの **resources と securityContext だけ**を上書きできる（v1beta2 のみ）。

```yaml
spec:
  podTemplate:
    spec:
      containers:
      - name: mysqld
        image: ghcr.io/cybozu-go/moco/mysql:8.4.8
    overwriteContainers:
    - name: agent
      resources:
        requests:
          cpu: 50m
    - name: moco-init
      securityContext:
        capabilities:
          add: ["SYS_NICE"]
```

指定できる名前は enum で 5 つに固定: `agent` / `copy-moco-init` / `moco-init` / `slow-log` / `mysqld-exporter`（`api/v1beta2/mysqlcluster_types.go#OverwriteableContainerName`）。それ以外は API 検証エラー。各コンテナの既定リソース値は [pod-anatomy](pod-anatomy.md) にまとめてある。

### 設計経緯（designdoc）

`docs/designdoc/allow_customize_containers.md` より:

- 発端は「agent 等のリソースを調整したい」という issue #235
- `command` など**運用が破綻しうるフィールドは意図的に開放しない**方針。フィールドは要望ベースで追加され、当初は resources のみ → 現在は securityContext も可
- resources に**マージロジックは無い**（暗黙の値設定を避けるため、指定した requests/limits がそのまま置き換わる）
- コンテナ別に型を分ける案は、API とコンテナの密結合を嫌って却下。initContainer とコンテナの区別もしない

> **Note** `docs/customize-system-container.md` は securityContext の既定値を「runAsUser=1000」と書いているが実装は 10000 → [docs-discrepancies](docs-discrepancies.md) #1

## ③ ユーザコンテナの追加

`podTemplate.spec` には mysqld 以外に任意の initContainers / containers を足せる。ただし予約済みコンテナ名・ポート・volume 名は webhook で拒否される（[crd-mysqlcluster](crd-mysqlcluster.md) の webhook 検証一覧）。slow-log サイドカーを自前のログ収集に置き換えたい場合は `disableSlowQueryLogContainer: true` + 自前コンテナ、fluent-bit の設定だけ変えたい場合は `slowQueryLogConfigTmpl` を使う。

## 関連

- [pod-anatomy](pod-anatomy.md) — システムコンテナ一覧と既定値
- [crd-mysqlcluster](crd-mysqlcluster.md) — podTemplate の検証規則
- [development](development.md) — 公式コンテナイメージのリリースフロー
