# tsukumijima/DPlayer からの変更点

## 1. 弾幕の改善

**対象ファイル:** `src/ts/danmaku.ts`, `src/css/player.scss`

- フルスクリーン時はフォントサイズの比率上限（1.0）を解除 → 画面サイズに合わせて大きく表示
- フルスクリーン解除時のリサイズでコメントをリセット（ちらつき防止）
- CSS: フルスクリーン時に弾幕コンテナのアスペクト比制約を解除

---

## 2. 字幕弾幕変換クラスの追加

**対象ファイル:** `src/ts/subtitle-danmaku.ts`

MKV・SRT・ASS 字幕を DPlayer の弾幕データに変換する `SubtitleDanmaku` クラスを新規追加。

---

## 3. Electron デスクトップアプリ対応

ブラウザなしで動く VLC ライクなスタンドアロンプレイヤー。

### `electron/main.js`（新規）

- `app://` カスタムプロトコルで全アセットを配信（HTTPS 不要）
- 動画はストリーミング配信（range request 対応・大ファイルでも RAM 消費なし）
- シングルインスタンス制御（同じファイルを複数ウィンドウで開かず既存ウィンドウで受け取る）
- F12 で DevTools を開閉

### `electron/preload.js`（新規）

IPC 経由でローカルファイルの読み込みをレンダラーに公開。

### `demo/local-player.html`（新規）

- ドラッグ＆ドロップ / ファイルピッカーでローカル動画を再生
- MKV 等の字幕トラックを ffmpeg.wasm で自動検出・抽出して弾幕として表示
- SRT・ASS・VTT の外部字幕ファイルにも対応
- Electron からコマンドライン引数で渡されたファイルを開く処理を追加

### `scripts/copy-ffmpeg-core.js`（新規）

`npm install` 後に ffmpeg.wasm 関連ファイルを `demo/` および `demo/vendor/` にコピーする。

---

## 4. ビルド設定の変更

**対象ファイル:** `webpack/dev.config.js`, `webpack/prod.config.js`, `package.json`

- `webpack/dev.config.js`: HTTPS 対応（開発サーバー用・SharedArrayBuffer に必要）、ffmpeg モジュール配信を追加
- `webpack/prod.config.js` および `dev.config.js`: Windows で `art-template-loader` がバックスラッシュのパスを生成する問題を `NormalModuleReplacementPlugin` で修正
- `package.json`:
  - `electron`, `electron-builder` を devDependencies に追加
  - `electron:start`（開発起動）、`electron:build`（Windows ポータブル exe 生成）スクリプトを追加
  - ビルドターゲット: ポータブル exe（インストール不要、`release/` に出力）

---

## 使い方

```bash
npm install

# 開発起動（ブラウザ）
npm run dev

# 開発起動（Electron）
npm run electron:start

# Windows 配布用ポータブル exe をビルド → release/ に生成
npm run electron:build
```
