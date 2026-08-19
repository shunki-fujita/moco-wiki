---
tags: [development]
sources:
  - moco@40f54d72:DEVELOP.md
  - moco@40f54d72:e2e/README.md
  - moco@40f54d72:RELEASE.md
  - moco@40f54d72:charts/moco/
  - moco@40f54d72:docs/setup.md
last_updated: 2026-08-19
---

# 開発・テスト・デプロイ

ツールは aqua で管理され、全コミットに DCO の `Signed-off-by` が必要。

## インストール

**cert-manager が必須**（admission webhook 用証明書 + controller ↔ agent の gRPC mTLS 用 CA）。

```console
# 方法 A: 生マニフェスト
kubectl apply -f https://github.com/cybozu-go/moco/releases/latest/download/moco.yaml

# 方法 B: Helm
helm repo add moco https://cybozu-go.github.io/moco/
helm install --create-namespace --namespace moco-system moco moco/moco
```

Helm の主要 values: `replicaCount`(2), `crds.enabled`(true; uninstall しても `resource-policy: keep` で CRD は残る), `monitoring.enabled`(PodMonitor ×3), `agent.image.tag` / `fluentbit.image.tag` / `mysqldExporter.image.tag`, `extraArgs`。**チャートは本体と独立にバージョニング**される（chart 0.26.0 / app 0.36.0）。

## テストの 4 層

| 層 | コマンド | 内容 |
|---|---|---|
| 単体 | `make test` | MySQL/K8s 非依存。`go test -race ./pkg/...` + vet + gofmt |
| MySQL 依存 | `make test-dbop` / `make test-bkop` | Docker で実 MySQL を立てて pkg/dbop・pkg/bkop を検証。`MYSQL_VERSION` で切替。bkop は mysqlsh が必要（`make setup`） |
| envtest | `make envtest` | clustering / controllers / api / backup の 4 サブターゲット。`MOCO_CHECK_INTERVAL=100ms` 等で高速化。`FOCUS=...` で ginkgo focus |
| E2E | `cd e2e && make start && make test` | kind + cert-manager + MinIO / fake-gcs-server / Azurite。`ginkgo --procs 5 --timeout 90m` |

```console
cd e2e
make start                 # kind クラスタ + イメージビルド/ロード + MOCO デプロイ
make test                  # 本体 (RUN_E2E=1)
make test-upgrade          # 8.0.28 → 8.4 のアップグレードテスト
make start AGENT_DIR=path  # 未リリースの moco-agent を組み込んでテスト
make logs && make stop
```

E2E スイート: lifecycle / replication / failover / switchover / stop / offline / partition / pvc / prevent_delete / backup (S3, TLS, GCS, Azure) / upgrade。

## コード生成

`make manifests`（CRD/RBAC/webhook → kustomize → Helm の `templates/generated/` まで再生成）、`make generate`（deepcopy）、`make apidoc`（`docs/crd_*.md`）。CI は `make check-generate` で生成物の差分をエラーにする。

## リリースフロー

| 対象 | 手順 |
|---|---|
| MOCO 本体 | `version.go` + `kustomization.yaml` 更新 + CHANGELOG → PR → merge → `v<X.Y.Z>` タグ push で CI 発火 |
| Helm チャート | 本体と独立。`Chart.yaml` / `values.yaml` の tag を更新 → `chart-v<ver>` タグ push |
| コンテナ (mysql / fluent-bit / mysqld_exporter) | `containers/<name>/<ver>/TAG` を編集して main にマージ。**TAG を変えないと Dockerfile を変えてもリリースされない**。タグは `<upstream 版>.<イメージ版>`（例 8.4.8.1） |
| moco-agent | 別リポジトリでリリース → moco 側で `go get github.com/cybozu-go/moco-agent@latest`（`--agent-image` 既定値は go.mod から解決） |

## サポートバージョン（CI マトリクス）

MySQL: 8.0.28 / 8.0.43 / 8.0.44 / 8.0.45 / 8.4.4 / 8.4.8（LTS のみ。Innovation release は未テスト）。Kubernetes: 1.33 / 1.34 / 1.35。k8s 1.35 では v1.35.4 以降か `MaxUnavailableStatefulSet` feature gate の無効化が必要（kubernetes#137409）。

## 関連

- [docs-discrepancies](docs-discrepancies.md) — upstream への PR 候補
- [moco-overview](moco-overview.md) — リポジトリ地図
