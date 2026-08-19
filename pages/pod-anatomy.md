---
tags: [internals]
sources:
  - moco@40f54d72:controllers/mysql_container.go
  - moco@40f54d72:pkg/constants/container.go
  - moco@40f54d72:docs/customize-system-container.md
last_updated: 2026-08-19
---

# Pod の解剖図

mysqld Pod がどう組み立てられるか。

```
initContainers:
  copy-moco-init    agent イメージ。 cp /moco-init /shared/moco-init
  moco-init         mysqld イメージ。データディレクトリ初期化 +
                    server_id / admin_address を /etc/mysql-conf.d に生成
  (ユーザ定義 initContainers)

containers:
  mysqld            ユーザ指定イメージ。--defaults-file=/etc/mysql/my.cnf
  agent             moco-agent。gRPC :9080 / metrics :8080
  slow-log          fluent-bit (disableSlowQueryLogContainer=false のとき)
  mysqld-exporter   spec.collectors 非空のとき (:9104)
  (ユーザ定義コンテナ)
```

`moco-init` が mysqld イメージで動くのは `mysqld --initialize-insecure` を実行するため。moco-agent のバイナリを mysqld イメージに焼き込まない設計（`controllers/mysql_container.go#makeV1InitContainer`）。

## mysqld コンテナの probe と終了処理

| 設定 | 値 | 備考 |
|---|---|---|
| startupProbe | `GET /healthz` :9081、period 10s × failureThreshold `max(startupWaitSeconds/10, 1)` | 既定 3600s → 最大 1 時間待つ。バージョンアップ時のデータ更新を見込んだ値 |
| livenessProbe | `GET /healthz` :9081 | 応答するのは **moco-agent**（同一 Pod の network namespace） |
| readinessProbe | `GET /readyz` :9081 | レプリカ遅延も判定 → [moco-agent](moco-agent.md) |
| preStop | `sleep 20` | Service のエンドポイント除去の伝播猶予。switchover タイムアウト（10s）はこの半分 |
| terminationGracePeriodSeconds | 300（未指定時） | |

> **Warning** probe が mysqld コンテナに設定されているため、**moco-agent が落ちると mysqld コンテナの liveness が失敗して mysqld が再起動される**。

## サイドカーのリソース既定値

| コンテナ | CPU (req=limit) | Memory (req=limit) |
|---|---|---|
| agent | 100m | 100Mi |
| copy-moco-init / moco-init | 100m | 512Mi |
| slow-log (fluent-bit) | 100m | 20Mi |
| mysqld-exporter | 200m | 100Mi |

`mysqld` 本体のリソースには既定値がなく、ユーザが `podTemplate` で指定する（limits のみ指定して Guaranteed QoS にするのが docs の推奨例）。サイドカーの resources / securityContext は `spec.podTemplate.overwriteContainers` で上書きできる。

securityContext は全コンテナに `runAsUser/runAsGroup=10000`、Pod に `fsGroup=10000` + `fsGroupChangePolicy=OnRootMismatch` が（未指定時のみ）設定される。`--disable-default-security-context` で無効化可（`pkg/constants/container.go`）。

> **Note** `docs/customize-system-container.md` には「runAsUser=1000」と書かれているが実装は **10000** → [docs-discrepancies](docs-discrepancies.md)

## Volume 構成

| volume | 実体 | マウント先 |
|---|---|---|
| `mysql-data` | PVC（volumeClaimTemplates で必須） | /var/lib/mysql |
| `mysql-conf` | my.cnf ConfigMap | /etc/mysql |
| `mysql-conf-d` | emptyDir（moco-init が書く） | /etc/mysql-conf.d |
| `my-cnf-secret` | Secret（ユーザ別 my.cnf: moco-admin, moco-readonly, …） | /mysql-credentials |
| `run` | emptyDir（UNIX ソケット共有: mysqld ↔ agent） | /run |
| `var-log` | emptyDir（slow log 共有: mysqld ↔ agent ↔ fluent-bit） | /var/log/mysql |
| `grpc-cert` | Secret（agent の mTLS サーバ証明書） | /grpc-cert (agent のみ) |
| `tmp` / `shared` | emptyDir | /tmp, /shared |

affinity 未指定時は hostname 分散の podAntiAffinity（weight 100 の preferred）が付く。

## 関連

- [mycnf](mycnf.md) — /etc/mysql/my.cnf の生成規則
- [moco-agent](moco-agent.md) — agent / moco-init の中身
- [custom-containers](custom-containers.md) — システムコンテナの上書きとカスタム mysqld イメージ
- [reconcile](reconcile.md) — StatefulSet を生成する側
