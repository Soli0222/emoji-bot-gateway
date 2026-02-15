# Emoji Bot Gateway - 完成仕様書

## 1. 概要

**プロジェクト名:** Emoji Bot Gateway

**責務:**
Misskey Streaming APIを介してユーザーとの対話を行う常駐型アプリケーション。
ローカルユーザーからのメンションを受け付け、AIによる絵文字パラメータ生成・画像レンダリング・ユーザー確認・絵文字登録までを自動化する。

**アーキテクチャ特性:**

| 項目 | 内容 |
|------|------|
| Connection | WebSocket (Persistent Connection) |
| Process Model | Long-running Daemon (Node.js) |
| Scope | **Local Users Only** (他インスタンスからのメンションは無視) |

---

## 2. 技術スタック

| カテゴリ | 技術 |
|----------|------|
| Runtime | Node.js (TypeScript) |
| Misskey Interface | `misskey-js` (Stream class) |
| Web Framework | Hono (Health Check / Metrics用) |
| AI Model | OpenAI `gpt-5-mini-2025-08-07` |
| State Management | Valkey (v7.2+) / Redis互換 |
| Valkey Client | `ioredis` |
| Schema Validation | `zod` |
| Logger | `pino` |
| Package Manager | pnpm |

---

## 3. 機能一覧

### 3.1 メンション処理
- ローカルユーザーからのメンションのみを受け付け
- Botからのメンションは無視（無限ループ防止）
- テキストなしのメンションは無視

### 3.2 絵文字生成
- GPT-5-miniを使用したパラメータ自動生成
- 対応パラメータ:
  - テキスト（改行対応）
  - レイアウト（square/banner, 左/中央/右揃え）
  - スタイル（フォント、テキスト色、アウトライン、影）
  - モーション（none/shake/spin/bounce/gaming）
  - ショートコード

### 3.3 画像レンダリング
- Emoji Renderer (Service A) との連携
- フォントリストのキャッシュ機能
- PNG形式での画像生成

### 3.4 対話フロー
- 確認フェーズ（はい/いいえ）
- キャンセル時の再生成対応
- 曖昧な返答への誘導メッセージ

### 3.5 絵文字登録
- Misskey管理者API経由での自動登録
- Misskey Driveへの画像アップロード

### 3.6 運用機能
- ヘルスチェックエンドポイント (`/health`)
- メトリクスエンドポイント (`/metrics`)
- グレースフルシャットダウン対応

---

## 4. 処理フロー

```
┌─────────────────────────────────────────────────────────────────┐
│                        Initialization                            │
├─────────────────────────────────────────────────────────────────┤
│ 1. Botアカウント情報取得                                          │
│ 2. Service A からフォントリスト取得・キャッシュ                     │
│ 3. Misskey Streaming API へ接続 (main channel)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Phase 1: フィルタリング (mention event)             │
├─────────────────────────────────────────────────────────────────┤
│ 1. user.host が null 以外 → 無視 (リモートユーザー)                │
│ 2. user.isBot が true → 無視 (Bot)                               │
│ 3. text が null → 無視                                           │
│ 4. 重複チェック (Valkey) → 既処理なら無視                          │
│ 5. レート制限チェック → 超過なら無視                                │
│ 6. Valkey state 存在確認                                          │
│    → あり: Phase 3へ / なし: Phase 2へ                            │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│    Phase 2: 生成 & 提案      │   │     Phase 3: 確認・実行      │
├─────────────────────────────┤   ├─────────────────────────────┤
│ 1. フォントリスト取得         │   │ 1. ユーザー返答を解析         │
│ 2. LLM でパラメータ生成       │   │    - Yes: 絵文字登録 → 完了  │
│ 3. Service A で画像生成      │   │    - No: state削除 → 終了    │
│ 4. Misskey Driveへアップロード│   │      (新リクエストあれば再生成)│
│ 5. Valkey に state 保存      │   │    - Unknown: 誘導メッセージ  │
│ 6. 確認リプライ送信          │   │ 2. state 削除 (Yes/No時)     │
└─────────────────────────────┘   └─────────────────────────────┘
```

---

## 5. データストア設計 (Valkey)

### 5.1 キー設計

| キーパターン | 用途 | TTL |
|-------------|------|-----|
| `bot:emoji:state:{userId}` | 対話ステート (JSON) | 600秒 (10分) |
| `bot:emoji:ratelimit:{userId}` | レート制限 (Sorted Set) | 動的 |
| `bot:emoji:processed:{noteId}` | 重複排除 | 300秒 (5分) |

### 5.2 ステート構造

```typescript
interface ConversationState {
  status: 'confirming';
  fileId: string;       // Misskey Drive ファイルID
  shortcode: string;    // 提案したショートコード
  replyToId: string;    // 元のノートID
  originalText: string; // ユーザーの元リクエスト
}
```

### 5.3 レート制限

- **アルゴリズム:** Sliding Window (Sorted Set)
- **デフォルト:** 10リクエスト / 60秒

---

## 6. AI パラメータ生成

### 6.1 入力

```typescript
interface LLMInput {
  userMessage: string;  // ユーザーのリクエスト内容
  fontList: string[];   // 利用可能なフォントID一覧
}
```

### 6.2 出力スキーマ

```typescript
interface EmojiParams {
  text: string;
  layout: {
    mode: 'square' | 'banner' | null;
    alignment: 'left' | 'center' | 'right' | null;
  } | null;
  style: {
    fontId: string;
    textColor: string;            // Hex形式 (#RRGGBB)
    outlineColor: string | null;
    outlineWidth: number | null;  // 0-20
    shadow: boolean | null;
  };
  motion: {
    type: 'none' | 'shake' | 'spin' | 'bounce' | 'gaming' | null;
    intensity: 'low' | 'medium' | 'high' | null;
  } | null;
  shortcode: string;  // 英小文字、数字、アンダースコアのみ
}
```

---

## 7. 外部サービス連携

### 7.1 Emoji Renderer (Service A)

| エンドポイント | メソッド | 用途 |
|----------------|----------|------|
| `/fonts` | GET | フォント一覧取得 |
| `/generate` | POST | 画像生成 |

### 7.2 Misskey API

| エンドポイント | 用途 |
|----------------|------|
| `i` | Botアカウント情報取得 |
| `drive/files/create` | 画像アップロード |
| `notes/create` | ノート投稿 |
| `admin/emoji/add` | 絵文字登録 |

### 7.3 OpenAI API

| API | 用途 |
|-----|------|
| `responses.parse` | Structured Output による絵文字パラメータ生成 |

---

## 8. 再接続戦略

**アルゴリズム:** Fibonacci Backoff

```
試行回数: 1 → 遅延: 1秒
試行回数: 2 → 遅延: 1秒
試行回数: 3 → 遅延: 2秒
試行回数: 4 → 遅延: 3秒
試行回数: 5 → 遅延: 5秒
...
最大遅延: 60秒
```

---

## 9. ユーザー返答解析

### 9.1 肯定パターン (Yes)

- テキスト: `はい`, `yes`, `ok`, `おk`, `おけ`, `お願い`, `登録`, `いいよ`, `いいね`, `それで`, `頼む`, `よろしく`
- 絵文字: 👍, ⭕, ✅, 🙆

### 9.2 否定パターン (No)

- テキスト: `いいえ`, `no`, `ダメ`, `だめ`, `やめ`, `キャンセル`, `cancel`, `作り直`, `やり直`, `違う`, `ちがう`, `却下`
- 絵文字: 👎, ❌, 🙅, ✖

### 9.3 不明パターン (Unknown)

上記に該当しない場合 → 誘導メッセージを送信

---

## 10. 環境変数

| 変数名 | 説明 | 必須 | デフォルト |
|--------|------|------|-----------|
| `MISSKEY_HOST` | Misskeyインスタンスのホスト名 | ✅ | - |
| `MISSKEY_TOKEN` | 管理者権限を持つAPIトークン | ✅ | - |
| `RENDERER_BASE_URL` | Emoji RendererのURL | ✅ | - |
| `OPENAI_API_KEY` | OpenAI APIキー | ✅ | - |
| `OPENAI_MODEL` | 使用するモデル | ❌ | `gpt-5-mini-2025-08-07` |
| `VALKEY_HOST` | Valkeyホスト | ❌ | `localhost` |
| `VALKEY_PORT` | Valkeyポート | ❌ | `6379` |
| `VALKEY_PASSWORD` | Valkeyパスワード | ❌ | - |
| `PORT` | HTTPサーバーポート | ❌ | `3000` |
| `LOG_LEVEL` | ログレベル | ❌ | `info` |
| `RATE_LIMIT_MAX_REQUESTS` | レート制限（リクエスト数） | ❌ | `10` |
| `RATE_LIMIT_WINDOW_SECONDS` | レート制限ウィンドウ（秒） | ❌ | `60` |
| `STATE_TTL_SECONDS` | 対話ステートのTTL（秒） | ❌ | `600` |

---

## 11. API エンドポイント

### GET /health

ヘルスチェック

**レスポンス:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-04T12:00:00.000Z",
  "checks": {
    "valkey": "ok"
  }
}
```

| ステータス | HTTPコード |
|-----------|-----------|
| healthy | 200 |
| degraded | 503 |

### GET /metrics

Prometheus形式のメトリクス

```
# HELP emoji_bot_up Service availability
# TYPE emoji_bot_up gauge
emoji_bot_up 1
```

---

## 12. ディレクトリ構成

```
emoji-bot-gateway/
├── src/
│   ├── main.ts            # エントリーポイント (Hono HTTPサーバー + 初期化)
│   ├── config.ts          # 環境変数スキーマ (Zod)
│   ├── logger.ts          # Pino ロガー設定
│   ├── streaming.ts       # WebSocket ハンドラ + 再接続ロジック
│   ├── logic/
│   │   ├── filter.ts      # ユーザーフィルタリング (isLocalUser等)
│   │   ├── generator.ts   # AI生成 & 提案フロー
│   │   └── registrar.ts   # 確認 & 登録フロー
│   └── services/
│       ├── valkey.ts      # Valkey クライアント (ioredis)
│       ├── llm.ts         # OpenAI API クライアント
│       ├── renderer.ts    # Emoji Renderer 連携
│       └── misskey.ts     # Misskey API クライアント
├── docs/
│   ├── spec.md            # 設計書
│   └── result.md          # 完成仕様書 (このファイル)
├── Dockerfile
├── compose.yaml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── eslint.config.js
```

---

## 13. メッセージテンプレート

### 13.1 提案メッセージ

```
絵文字を作成しました！

📝 テキスト: {text}
🔤 フォント: {fontId}
🎨 色: {textColor}
🎬 アニメーション: {motion.type}  ← モーションがある場合のみ
🏷️ ショートコード: `:{shortcode}:`

この絵文字を登録しますか？（はい/いいえ）
```

### 13.2 登録成功メッセージ

```
絵文字を登録しました！ :{shortcode}: でお使いいただけます！
```

### 13.3 キャンセルメッセージ

```
承知しました。キャンセルしますね。新しいリクエストをお待ちしています！
```

### 13.4 誘導メッセージ

```
「はい」または「いいえ」でお答えください。登録する場合は「はい」、作り直す場合は「いいえ」と返信してください。
```

### 13.5 エラーメッセージ

```
申し訳ありません、絵文字の生成中にエラーが発生しました。もう一度お試しください。
```

```
絵文字の登録中にエラーが発生しました。ショートコードが既に使用されている可能性があります。
```

---

## 14. セキュリティ対策

1. **ローカルユーザー限定:** 他インスタンスからのメンションを無視
2. **Bot無視:** Bot同士の無限ループを防止
3. **レート制限:** Token Bucket によるリクエスト制限
4. **重複排除:** 同一ノートの二重処理を防止
5. **ステートTTL:** 10分で自動破棄

---

## 15. 起動方法

### 開発環境

```bash
pnpm install
pnpm dev
```

### 本番環境

```bash
pnpm build
pnpm start
```

### Docker

```bash
docker compose up -d
```

---

## 16. テスト

```bash
# 全テスト実行
pnpm test

# カバレッジ付き
pnpm test:coverage
```

---

## 17. 今後の拡張案

- [ ] カテゴリ指定機能
- [ ] エイリアス設定
- [ ] 編集・削除機能
- [ ] 利用統計ダッシュボード
- [ ] 複数言語対応
