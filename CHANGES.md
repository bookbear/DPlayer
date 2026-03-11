# 変更点まとめ

オリジナルリポジトリ (tsukumijima/DPlayer) からの変更内容。

---

## 新規追加ファイル

### `src/ts/subtitle-danmaku.ts`
動画に埋め込まれた字幕を DPlayer の弾幕 (`Dan[]`) に変換する TypeScript ユーティリティ。

- `parseSRT(text, color, type)` — SRT 形式をパース
- `parseASS(text, type)` — ASS/SSA 形式をパース（スタイルの色を反映）
- `parseVTT(text, color, type)` — WebVTT 形式をパース

---

### `demo/local-player.html`
ローカル動画ファイルを再生し、埋め込み字幕を弾幕として流すデモページ。

**機能:**
- 動画ファイルをクリックまたはドラッグ＆ドロップで選択・再生
- ffmpeg.wasm でファイルに埋め込まれた字幕トラックを自動検出・抽出
- 抽出した字幕を DPlayer の弾幕として表示
- 複数字幕トラックがある場合はボタンで切り替え可能
- 弾幕の流れ方（右→左 / 上固定 / 下固定）と色を変更可能

**パフォーマンス最適化:**
- 字幕トラック検出はファイル先頭 5MB のみ読み込む（高速）
- 字幕抽出時のフルファイル読み込みは初回のみ（同じファイルで 2 回目以降はキャッシュ）

**対応動画フォーマット:**
- MP4 (H.264), WebM (VP9) — ブラウザネイティブ再生
- MKV (H.264) — ブラウザネイティブ再生
- MKV (H.265/HEVC) — Chrome 107+ (Windows/macOS) でハードウェアデコード対応。Windows は「HEVC Video Extensions」が必要な場合あり

**アクセス URL:** `https://<サーバーIP>:8082/local-player.html`

---

### `demo/ffmpeg-core.js` / `demo/ffmpeg-core.wasm`
`@ffmpeg/core@0.12.10` の ESM ビルドを `node_modules` からコピーしたもの。
CDN から取得するとクロスオリジン Worker の問題が発生するため、same-origin で配信するために demo フォルダに配置。

```bash
# 再生成コマンド（パッケージ再インストール後）
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js demo/
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm demo/
```

---

### `webpack/dev-cert.pem` / `webpack/dev-key.pem`
開発用の自己署名 TLS 証明書と秘密鍵。
SharedArrayBuffer には secure context (HTTPS) が必要なため生成。

```bash
# 再生成コマンド（有効期限: 10年）
openssl req -x509 -newkey rsa:2048 \
  -keyout webpack/dev-key.pem -out webpack/dev-cert.pem \
  -days 3650 -nodes \
  -subj '/CN=local-dplayer' \
  -addext 'subjectAltName=IP:192.168.134.141,IP:127.0.0.1,DNS:localhost'
```

---

## 変更ファイル

### `src/css/player.scss`

| 変更点 | 内容 |
|--------|------|
| フルスクリーン時に `.dplayer-danmaku` の `aspect-ratio` を解除 | `danmaku.scss` で `aspect-ratio: 16/9` が設定されているため、フルスクリーンで弾幕エリアが映像の16:9領域に制限されていた。フルスクリーン時は画面全体に流れるよう `aspect-ratio: unset` を追加 |

---

### `src/ts/danmaku.ts`

| 変更点 | 内容 |
|--------|------|
| フルスクリーン時の文字サイズ上限を解除 | `draw()` 内の `ratio >= 1` キャップをフルスクリーン時に適用しないよう変更。画面幅に比例して文字サイズが拡大され、通常時と同じ行数比率で画面全体にコメントが流れる |
| `resize()` でコメントをクリア | ウィンドウリサイズ・フルスクリーン切り替え時に文字サイズが変わるため、配置済みコメントとトンネル情報をリセット。サイズ変化前後でコメントが重なるのを防ぐ |

---

### `webpack/dev.config.js`

| 変更点 | 内容 |
|--------|------|
| `host: '0.0.0.0'` 追加 | LAN 上の他の PC からアクセス可能にする |
| `server: { type: 'https' }` 追加 | SharedArrayBuffer に必要な secure context を有効化 |
| `static` を配列に変更 | `@ffmpeg/ffmpeg` と `@ffmpeg/util` の ESM を same-origin で配信 (`/ffmpeg/`, `/ffmpeg-util/`) |
| COOP/COEP ヘッダー追加 | `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy: credentialless` |

---

### `package.json` / `package-lock.json`

追加した devDependencies:

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| `@ffmpeg/ffmpeg` | ^0.12.15 | ブラウザ内 ffmpeg API |
| `@ffmpeg/util` | ^0.12.2 | fetchFile などのユーティリティ |
| `@ffmpeg/core` | ^0.12.10 | ffmpeg-core.wasm 本体 |

---

## 起動方法

```bash
npm run dev
# → https://localhost:8082/local-player.html       (このPC)
# → https://192.168.134.141:8082/local-player.html (LAN上の他のPC)
```

初回アクセス時はブラウザの自己署名証明書警告が出るため、
「詳細設定」→「アクセスする（安全ではありません）」で続行する。
