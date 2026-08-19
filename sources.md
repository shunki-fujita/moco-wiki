# Raw sources

この wiki の原資料。取り込み済みの commit を記録する。ここに載っていない情報源から wiki に書かないこと。

| リポジトリ | 取り込み済み commit | ブランチ | ローカルパス | 備考 |
|---|---|---|---|---|
| [cybozu-go/moco](https://github.com/cybozu-go/moco) | `40f54d72` (2026-08-12, v0.36.0) | main | `~/moco` | ローカル checkout は別ブランチのことがある。**必ず main の worktree か `git show main:` で読む** |
| [cybozu-go/moco-agent](https://github.com/cybozu-go/moco-agent) | `a649f51` (2026-04-09, v0.16.0) | main | `~/moco-agent` | |

## 取り込み対象外（意図的に含めない）

- moco の未マージブランチ（例: `credential-rotation-crd`）— main にマージされたら Ingest する
- upstream の GitHub Issues / PR 本文 — 必要になったら人間の判断で追加
