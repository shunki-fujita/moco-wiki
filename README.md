# moco-wiki

[cybozu-go/moco](https://github.com/cybozu-go/moco) と [cybozu-go/moco-agent](https://github.com/cybozu-go/moco-agent) のソースコード（main ブランチ）を LLM が読んで生成・保守する wiki。
[karpathy/llm-wiki パターン](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)に従う。

**入口: [index.md](index.md)**（全ページの目録）

## 構造

| ファイル | 役割 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Schema — ページ規約と Ingest / Query / Lint のワークフロー。エージェントはここから読む |
| [sources.md](sources.md) | Raw sources — 取り込み済みリポジトリと commit の登録簿 |
| [index.md](index.md) | 全ページの目録（一行要約付き） |
| [log.md](log.md) | 追記専用の操作記録 |
| `pages/*.md` | wiki 本体。1 ページ 1 概念、frontmatter 付き |

## 閲覧

GitHub 上でそのまま読む（mermaid 図もレンダリングされる）。Obsidian で `~/moco-wiki` を vault として開いてもよい。

## 更新

Claude Code をこのディレクトリで起動して依頼する。CLAUDE.md が schema として自動で読み込まれる。

```
# 例
「moco の main が進んだので Ingest して」
「switchover と failover の違いを教えて」   # Query
「Lint して」
```
