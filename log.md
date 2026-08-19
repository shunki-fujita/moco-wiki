# Log

追記専用の操作記録。新しいエントリを先頭に足す。形式は [schema](CLAUDE.md) 参照。

## 2026-08-19 | schema | karpathy/llm-wiki パターンに再構成

静的 HTML サイト（10 ページ）から markdown wiki に移行。schema (CLAUDE.md) / sources.md / index.md / log.md を導入し、ページを概念単位の 15 ページに分割（clustering → states + operations、CRD → mysqlcluster + backuppolicy、reconcile → reconcile + rolling-update、pod → pod-anatomy + mycnf、docs-discrepancies を synthesis ページとして独立）。

## 2026-08-19 | ingest | moco@40f54d72 (main, v0.36.0) + moco-agent@a649f51 (main, v0.16.0) を初期取り込み

並列調査エージェント 8 本で両リポジトリを読み、全ページを新規作成。
特記事項:
- ローカル ~/moco は credential-rotation-crd ブランチ（main +83 コミット）だったため、main の worktree から取り込んだ。CredentialRotation CRD は main 未マージなので wiki に含めない
- docs とソースの食い違い 8 件を発見 → [docs-discrepancies](pages/docs-discrepancies.md)
