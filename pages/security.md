---
tags: [synthesis]
sources:
  - moco@40f54d72:docs/security.md
  - moco@40f54d72:SECURITY.md
  - moco@40f54d72:controllers/certificate.go
  - moco@40f54d72:pkg/cert/cert.go
  - moco@40f54d72:pkg/password/password.go
  - moco@40f54d72:config/rbac/
last_updated: 2026-08-19
---

# セキュリティ横断ガイド

[architecture](architecture.md)・[moco-agent](moco-agent.md)・[reconcile](reconcile.md) に散らばる認証・認可・秘密情報の話を 1 枚にまとめた synthesis ページ。

## 信頼の起点は cert-manager

インストール時に moco-system へ CA となる Issuer `moco-grpc-issuer` と、controller のクライアント証明書（CN=`moco-controller`）の Certificate が作られる。**cert-manager が必須依存**なのはこのため + admission webhook 証明書のため（`docs/security.md`）。

## gRPC mTLS の証明書チェーン

controller → agent の gRPC（Clone 依頼、[architecture](architecture.md) 参照）を守る仕組み:

1. controller がクラスタごとに Certificate `moco-agent-<ns>.<name>` を **moco-system に**作る。dnsNames は `*.<headless-svc>.<ns>.svc` のワイルドカード、usages は server auth（`controllers/certificate_tmpl.yaml`）
2. cert-manager が発行した Secret を、controller がクラスタ namespace へ `moco-<name>-grpc` としてコピーする（agent Pod は moco-system の Secret を読めないため。`controllers/certificate.go#reconcileV1GRPCSecret`）
3. agent はこれをサーバ証明書として使い、クライアント証明書を CA で検証したうえで **CN が `moco-controller` と完全一致**することも確認する（[moco-agent](moco-agent.md)）
4. 両側とも証明書ファイルを **1 時間ごとに再読込**して cert-manager のローテーションに追随する（`pkg/cert/cert.go#Reloader`、agent 側は `cert/cert.go`）

> **Note** Certificate リソースは「無ければ作る」だけで**既存の内容は更新しない**（`certificate.go#reconcileV1Certificate` は Get が成功したら即 return）。dnsNames 等を変えたい場合は Certificate を手で消して再作成させる必要がある。

## MySQL パスワードの生成と保管

- 生成: `crypto/rand` の 16 バイトを hex 化した 32 文字。ユーザ 8 種それぞれ独立に生成（`pkg/password/password.go#NewMySQLPassword`）
- Secret は 3 形態（[crd-mysqlcluster](crd-mysqlcluster.md) の命名規則参照）:

| Secret | 置き場所 | 中身 |
|---|---|---|
| `mysql-<ns>.<name>` | moco-system | 原本。`ADMIN_PASSWORD` 等 8 キー。`moco.cybozu.com/secret-version: "1"` アノテーションでフォーマット管理 |
| `moco-<name>` | クラスタ ns | 原本のコピー。agent へ envFrom で注入 |
| `moco-my-cnf-<name>` | クラスタ ns | **my.cnf 形式** 5 ユーザ分（admin / exporter / backup / readonly / writable）。Pod の `/mysql-credentials` にマウントされ、`kubectl moco mysql` が `--defaults-extra-file` で使う |

> **Warning** Secret を書き換えても既存 mysqld のユーザには自動反映されない（agent は初期化済みインスタンスに何もしない → [moco-agent](moco-agent.md)）。パスワードローテーション機能は main には未マージ（[sources](../sources.md) の取り込み対象外に記載の `credential-rotation-crd` ブランチ）。

## mysqld への通信は TLS ではない

controller ⇔ mysqld (33062)、アプリ ⇔ mysqld (3306) はともに平文 MySQL プロトコル。ただし認証は `caching_sha2_password` なので**パスワード自体はネットワークに平文で流れない**。`docs/security.md` も "not (yet) over TLS" と明言している。盗聴からデータを守りたい場合はネットワーク層（CNI の暗号化等）が必要。

## RBAC

- **controller の ClusterRole**（`config/rbac/role.yaml`、kubebuilder マーカーから生成）: core（configmaps / secrets / serviceaccounts / services / pods / PVC / events）、apps（statefulsets）、batch（cronjobs / jobs）、policy（PDB）、cert-manager.io（certificates）、moco.cybozu.com の CRUD。namespace を跨いで Secret を読み書きできる点が最も強い権限
- **バックアップ / リストア Job 用 Role**: controller がクラスタごとに `moco-backup-<name>` / `moco-restore-<name>` の Role/RoleBinding を生成する。権限は最小: `mysqlclusters(/status)` の get/update、`pods` の get/list/watch、`events` の create/update/patch のみ（`controllers/mysqlcluster_controller.go` の PolicyRule 定義）。JobConfig の `serviceAccountName` はユーザが用意する
- 利用者向けに `mysqlcluster-editor/viewer`・`backuppolicy-editor/viewer` の ClusterRole 雛形が同梱される（`config/rbac/`）

## コンテナのセキュリティ既定値

全コンテナ `runAsUser/runAsGroup=10000`、Pod に `fsGroup=10000`（未指定時のみ、`--disable-default-security-context` で無効化可）→ [pod-anatomy](pod-anatomy.md)。moco-agent は scratch ベースイメージでシェルすら無い（[moco-agent](moco-agent.md)）。

## MySQL ユーザの権限分離

システムユーザ 6 種 + エンドユーザ 2 種の権限一覧は [moco-agent](moco-agent.md) を参照。設計上の要点:

- `moco-writable` にも `mysql.*` への書き換えは **partial revoke** で禁止（MOCO の管理ユーザを壊せない）
- mysqld-exporter・backup 等は用途ごとに専用ユーザで最小権限
- switchover 時にアプリ接続を KILL する際、システムユーザは除外リストで守られる（[dbop](dbop.md)）

## 脆弱性報告のポリシー（SECURITY.md）

- 報告は GitHub の **private vulnerability reporting のみ**。公開 Issue / PR での報告は不可
- セキュリティ修正は**最新リリースのみ**に提供される
- スキャナ出力だけの報告（依存ライブラリの CVE 等）は、MOCO の文脈で悪用可能なことを示さない限り受け付けない

## 関連

- [architecture](architecture.md) — 通信経路の全体図
- [moco-agent](moco-agent.md) — ユーザ 8 種の権限と mTLS 検証の実装
- [pod-anatomy](pod-anatomy.md) — securityContext の既定値
