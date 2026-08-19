# moco-wiki

[cybozu-go/moco](https://github.com/cybozu-go/moco) と [cybozu-go/moco-agent](https://github.com/cybozu-go/moco-agent) のソースコード（main ブランチ）を LLM が読んで生成した内部構造 wiki。

- 生成元: moco @ 40f54d72 (v0.36.0) / moco-agent @ a649f51 (v0.16.0)
- 生成日: 2026-08-19

## 構成

ビルド不要の静的 HTML。`index.html` がトップページ。図は hand-authored SVG と mermaid（CDN から読み込み）で描画。

## ローカルで見る

```console
$ python3 -m http.server -d . 8000
# → http://localhost:8000
```

## GitHub Pages で公開する

1. push する
2. リポジトリの Settings → Pages → Source を `Deploy from a branch`、Branch を `main` / `/ (root)` に設定

`.nojekyll` を置いてあるので Jekyll 処理はスキップされる。
