# Log

追記専用の操作記録。新しいエントリを先頭に足す。形式は [schema](CLAUDE.md) 参照。

## 2026-08-19 | query | 食い違い #10 を追加（生成 CRD doc の Required 誤表示）

ユーザ提供の [PR#903 レビューコメント](https://github.com/cybozu-go/moco/pull/903#discussion_r3810879340)をソースで検証し、[docs-discrepancies](pages/docs-discrepancies.md) に #10 として追記（`+optional` なのに json タグに `omitempty` が無く、生成 doc で Required=true になる 4 フィールド）。

## 2026-08-19 | query+lint | カバレッジ調査に基づき 5 ページ追加・7 ページ増補

「他に書くことは無いか」の調査から、ソースにあって wiki に無かった領域を追加。
- 新規: [dbop](pages/dbop.md)（SQL 操作層）、[metrics](pages/metrics.md)（全メトリクス一覧）、[security](pages/security.md)（synthesis: mTLS/パスワード/RBAC）、[custom-containers](pages/custom-containers.md)（イメージ差し替えと overwriteContainers）、[object-storage](pages/object-storage.md)（pkg/bucket）
- 増補: operations（Kubernetes Events 一覧、既知の問題、designdoc の設計経緯）、rolling-update（designdoc: PDB 無視事故が発端という経緯）、ほか 5 ページに相互リンク追加
- 食い違い #9 を発見（`moco_cluster_partition_update_retries_total` に name ラベルが無い）→ [docs-discrepancies](pages/docs-discrepancies.md)
- docs/designdoc/ 6 本を該当ページに反映。known_issues は解消済み 1 件のみで operations に一行記載

## 2026-08-19 | schema | karpathy/llm-wiki パターンに再構成

静的 HTML サイト（10 ページ）から markdown wiki に移行。schema (CLAUDE.md) / sources.md / index.md / log.md を導入し、ページを概念単位の 15 ページに分割（clustering → states + operations、CRD → mysqlcluster + backuppolicy、reconcile → reconcile + rolling-update、pod → pod-anatomy + mycnf、docs-discrepancies を synthesis ページとして独立）。

## 2026-08-19 | ingest | moco@40f54d72 (main, v0.36.0) + moco-agent@a649f51 (main, v0.16.0) を初期取り込み

並列調査エージェント 8 本で両リポジトリを読み、全ページを新規作成。
特記事項:
- ローカル ~/moco は credential-rotation-crd ブランチ（main +83 コミット）だったため、main の worktree から取り込んだ。CredentialRotation CRD は main 未マージなので wiki に含めない
- docs とソースの食い違い 8 件を発見 → [docs-discrepancies](pages/docs-discrepancies.md)
