# umux × AI CLI（codex / claude / gemini）操作可否メモ（Codex調べ）

目的: `umux` 経由で **起動 → 1往復会話 → 終了** が成立するかを実機確認する。

## 検証環境

- 検証日: 2026-02-04
- OS: Ubuntu 24.04.3 LTS / aarch64
- umux: `0.0.1`
- codex: `codex-cli 0.94.0`
- claude: `2.1.29 (Claude Code)`
- gemini: `0.26.0`

再現用スクリプト: `umux/examples/compat/ai-cli-compat-smoke.sh`

## 調査結果（できたこと）

### codex (Codex CLI) `0.94.0`

- できたこと:
  - 起動（インタラクティブUI）
  - 送信（1往復会話）: 入力→送信キー→応答表示
  - 終了: `Ctrl-D`（効かない場合は `Ctrl-C` ×2）
- 操作メモ:
  - Slashコマンド一覧は **`/` を「入力欄にタイプする」**と候補が出る（`/` + Enter では出ない）。
  - `umux send "text" --enter` だと入力が“速すぎて”送信されないことがあり、**`text`送信 → `--block-until-idle` → `Enter`** が安定。
  - ネットワーク許可が絡む環境では `/permissions` → **Full Access** にすると詰まりにくい（候補から選択）。
- 例（安定パターン）:
  - `umux send "Reply with reverse of YZZYX only."`
  - `umux wait --block-until-idle 200 ...`
  - `umux send --key Enter`
  - `umux wait --block-until-screen-match "XYZZY" ...`

### claude (Claude Code) `2.1.29`

- できたこと:
  - 起動（インタラクティブUI）
  - 1往復会話: `Reply with reverse of YZZYX only.` → `XYZZY` を確認
  - 終了: `/exit` → プロセス終了を確認

### gemini (Gemini CLI) `0.26.0`

- できたこと:
  - 起動 → 会話 → 終了
- 操作メモ:
  - `gemini` 単体起動より、`gemini -i "<prompt>"`（prompt-interactive）で「最初の1回を実行してから対話継続」にすると安定。
  - 終了は `/exit` を試し、戻ったら `exit` でシェルを終了。
