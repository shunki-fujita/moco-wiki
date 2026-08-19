# moco-wiki — Schema

この wiki は [karpathy/llm-wiki パターン](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) に従う。
このファイルが Schema 層であり、wiki を操作するエージェントは必ずここから読むこと。

## 3 層構造

| 層 | 実体 | 管理者 |
|---|---|---|
| Raw sources | upstream リポジトリ (commit 固定)。[sources.md](sources.md) に登録 | 人間（どの commit を取り込むか決める） |
| Wiki | `pages/*.md` + [index.md](index.md) + [log.md](log.md) | LLM が完全管理 |
| Schema | この CLAUDE.md | 人間と LLM で共進化 |

原則: **raw sources は書き換えない。wiki は LLM が自由に書き換える。schema の変更は人間に提案して合意を取る。**

## ページ規約

- ファイル名は kebab-case、**1 ページ 1 概念**。ページ本文は日本語
- 全ページに YAML frontmatter を付ける:

```yaml
---
tags: [internals, clustering]        # index の分類に使う。user-guide / internals / operations / development / synthesis
sources:                             # このページの根拠となった raw source
  - moco@40f54d72:clustering/
last_updated: 2026-08-19
---
```

- 事実には根拠を付ける: `` `clustering/status.go#DecideState` `` のように ファイル#関数 形式（行番号は commit が進むとずれるので使わない）
- ページ間は相対リンク `[クラスタリング](clustering-states.md)` で相互参照する。関連ページは本文末尾の「## 関連」に列挙
- ソースと公式 docs の食い違いを見つけたら [docs-discrepancies.md](pages/docs-discrepancies.md) に追記する（消さない。解消されたら「解消済み」と印を付ける）
- ページの削除より更新を優先。廃止する場合は index.md と被リンクを必ず掃除する

## 操作

### Ingest — 新しいソースの取り込み

対象リポジトリの main が進んだとき:

1. `git log <旧commit>..<新commit>` と `git diff --stat` で変更領域を把握する
2. 変更領域に対応するページを特定し（index.md の一行要約を手がかりに）、**差分だけ読んで**該当ページを更新する。新概念は新ページに切り出す
3. 更新した全ページの frontmatter（`sources` の commit と `last_updated`）を更新する
4. [sources.md](sources.md) の commit を進め、README.md 先頭のバージョンバッジ（shields.io、バージョンと commit を表示）も更新する
5. [log.md](log.md) に追記する（形式は下記）
6. index.md の一行要約が古くなっていたら直す

### Query — 質問への回答

1. index.md → 該当ページの順で読み、wiki 内の知識で答える。足りなければ raw sources を読み、**わかったことをページに反映してから**答える
2. 複数ページを合成した価値ある回答（比較・調査結果など）は `pages/` に synthesis ページとして保存し、log.md に記録する。使い捨ての回答は保存しない

### Lint — 健全性チェック

定期的に、または大きな Ingest の後に:

1. ページ間の矛盾（同じ事実の食い違う記述）を探して修正する
2. 孤立ページ（index.md 以外からリンクされていないページ）を見つけ、関連ページからリンクを張る
3. frontmatter の `sources` の commit が sources.md より古いページ = 未検証ページとして再検証する
4. 結果を log.md に記録する

## log.md の形式

追記専用。先頭に新しいエントリを足す:

```markdown
## 2026-08-19 | ingest | moco@40f54d72 + moco-agent@a649f51 を初期取り込み
影響ページ: 全 15 ページ新規作成
```

## このリポジトリでのお願い

- コミットメッセージに Co-Authored-By 等の AI 帰属表記を付けない
- 公開先は GitHub（リポジトリの markdown レンダリングで閲覧。mermaid はそのまま描画される）
