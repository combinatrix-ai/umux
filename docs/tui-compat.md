# umux × 有名TUIアプリ操作可否メモ（Codex調べ）

目的: 「umux 経由でTUIを起動してキー送信・画面キャプチャができ、基本操作(ヘルプ表示/移動/終了)が成立するか」を、代表的な“有名どころ”で実機確認する。

## 検証環境

- 検証日: 2026-02-04
- OS: Ubuntu 24.04.3 LTS
- Kernel: Linux 6.14.0-1018-oracle (aarch64)
- umux: `0.0.1`

## 検証のやり方（共通）

- `umux spawn` でTUIを起動（`--cols/--rows`で固定サイズ）
- `umux send` でキー送信（`--key` / 通常文字）
- `umux wait --block-until-idle` や `--block-until-exit` を組み合わせる
- `umux capture --format text` で画面を取り、UI変化（ヘルプ表示・カーソル移動など）を確認

再現用スクリプト: `umux/examples/compat/tui-compat-smoke.sh`

## 調査結果（操作できたこと）

### htop `3.3.0`

- できたこと: 起動、`F1`でHelp表示、`Down`で移動、`q`で終了
- 使った操作例:
  - `umux spawn -n codex-htop htop --cols 120 --rows 40 --block-until-screen-match "htop" --timeout 5000`
  - `umux send --key F1` → `umux capture`（Help表示を確認）
  - `umux send --key Down`
  - `umux send q` → `--block-until-exit`

### btop `1.3.0`

- できたこと: 起動、`?`でhelp表示、`Esc`でhelpを閉じる、`q`で終了
- メモ: help表示中は `q` が「helpを閉じる」側に効くことがあるため、`Esc`→`q` が安定。

### glances `3.4.0.3`（psutil `5.9.8`）

- できたこと: 起動、`h`でHelp表示、`q`でヘルプを閉じる→`q`で終了（または`Ctrl-C`）

### ncdu `1.19`

- できたこと: 起動、`?`でhelp表示、`q`でhelpを閉じる→`q`で終了
- メモ: 小さいディレクトリを対象にすると安定（例: `/tmp`配下の小さめの作業ディレクトリ）。

### ranger `1.9.3`

- できたこと: 起動、`j`で選択行移動、`?`で右ペインの表示が変わる（file type classification等）、`q`で終了

### GNU Midnight Commander (mc) `4.8.30`

- できたこと: 起動、`F1`でHelp表示、`Esc`で戻る、`F10`で終了（環境によっては確認が出るので`Enter`）

### nnn `4.9`

- できたこと: 起動、`j`で移動、`q`で終了
- メモ: `--block-until-idle` がタイムアウトすることがあったので、必要なら `umux wait --block-until-idle ... || true` のように「ベストエフォート」で扱うと安定。

### vifm `0.12`

- できたこと: 起動、`j`で移動、`:`→`q`→`Enter`（`:q<Enter>`）で終了
- メモ: help表示は環境差が出やすいので、まずは「移動＋終了」を最小確認にした。

### lazygit `0.58.1`

- できたこと: 起動、`?`でKeybindings表示、`q`で終了（確認が出る場合は`Enter`）
- メモ: 初回起動時はメッセージpopupが出ることがあるため、`Enter`で閉じてから `?` が確実。
- 起動例: `lazygit -p /path/to/repo`

### tig `2.5.8`

- できたこと: 起動、`h`でヘルプ(Quick reference)表示、`q`でヘルプを閉じる→`q`で終了（または`Ctrl-C`）
