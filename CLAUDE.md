# DPlayer - Electron ローカル動画プレイヤー

## プロジェクト概要

[tsukumijima/DPlayer](https://github.com/tsukumijima/DPlayer) のフォーク。
ブラウザ不要で動作する **VLCライクなスタンドアロン動画プレイヤー** を Electron で実装している。

- ローカル動画ファイル（MKV/MP4/AVI等）をドラッグ＆ドロップで再生
- MKV等に埋め込まれた字幕トラックを **弾幕** として表示
- 字幕抽出はシステムまたは同梱の **native ffmpeg** で行う（ffmpeg.wasm は削除済み）

## リポジトリ運用

- **開発リポジトリ**: `/home/sf/work/DPlayer`（または Windows に移したもの）
- **プッシュ先**: `bookbear` リモート → `git@github.com:bookbear/DPlayer.git`
  ```
  git push bookbear master
  ```
- `origin` は tsukumijima/DPlayer（上流）

## ビルド・起動

```bash
npm install
npm run electron:start   # dev ビルド + Electron 起動
npm run electron:build   # Windows zip パッケージ生成 → release/
npm run dev              # webpack dev server（ブラウザ確認用）
```

## アーキテクチャ

### Electron
| ファイル | 役割 |
|---|---|
| `electron/main.js` | メインプロセス。`app://` カスタムスキーム、動画ストリーミング、ffmpeg spawn |
| `electron/preload.js` | contextBridge で renderer に API を露出 |
| `demo/local-player.html` | UI 本体（ドロップゾーン・字幕トラック選択・DPlayer 初期化） |
| `dist/DPlayer.min.js` | webpack でビルドされた DPlayer ライブラリ本体 |

### 動画再生
- `app://localhost/media?path=<絶対パス>` で range request 対応ストリーミング
- Electron のサンドボックスで `File.arrayBuffer()` が失敗するため、D&D も `webUtils.getPathForFile()` でパスを取得して IPC 経由で扱う

### 字幕抽出（native ffmpeg）
```
renderer (local-player.html)
  └─ electronAPI.detectSubtitles(filePath)   ← IPC
  └─ electronAPI.extractSubtitle({...})      ← IPC + 進捗イベント
       ↓
main.js: child_process.spawn('ffmpeg', [...])
```
- ffmpeg のパス解決順: `FFMPEG_PATH` 環境変数 → アプリと同ディレクトリの `ffmpeg.exe` → PATH
- 抽出結果は `trackCache` にキャッシュ（同じトラックの再クリックで再抽出しない）
- 新ファイル読み込み時に `cancelFFmpeg()` IPC で前の ffmpeg を kill（フリーズ防止）
- ffmpeg プロセスは `PRIORITY_BELOW_NORMAL` で起動（動画再生への I/O 競合を低減）

### UI の変更点（tsukumijima/DPlayer からの差分）
- コメント入力欄を削除、代わりに **弾幕 ON/OFF トグルボタン** に変更
- ボタンと歯車パネルのトグルを連動（`comment.syncUI()` / `setting.ts`）
- フルスクリーン時に弾幕を画面全体に流す（`aspect-ratio: unset`）

## electron-builder 設定
- `asar: false`、ターゲット: `win zip`（インストール不要のポータブル配布）
- 同梱ファイル: `electron/`、`dist/DPlayer.min.js`、`demo/local-player.html`
- ffmpeg.wasm は **削除済み**（native ffmpeg を使用）

## 注意事項
- `@ffmpeg/ffmpeg` は Node.js 環境で動作しない（`ffmpeg.wasm does not support nodejs` エラー）→ native ffmpeg を使う理由
- `electron/preload.js` が過去に `.gitignore` の `pre*` パターンにマッチして追跡されなかった問題は修正済み（`pre[^l]*` に変更）
- Windows で `npm run dev` する場合、ffmpeg.wasm 関連コードは削除済みのため HTTPS/SharedArrayBuffer 設定は不要
