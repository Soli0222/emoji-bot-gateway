# Emoji Bot Gateway

Misskey Streaming APIを介してユーザーとの対話を行う常駐型アプリケーション。
AIによる画像生成・ユーザー確認・絵文字登録までを自動化します。

## 機能

- ローカルユーザーからのメンションのみを受け付け
- GPT-5-miniを使用した絵文字パラメータの自動生成
- Service A (Renderer) を使用した画像生成
- Valkey (Redis互換) による対話ステート管理
- Fibonacci Backoffによる自動再接続

## 必要条件

- Node.js 20+
- Valkey 7.2+ (または Redis 7+)
- Service A (レンダリングサービス) が稼働していること
- Misskey管理者権限を持つBotアカウント

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
# .envファイルを編集して必要な値を設定
```

### 3. ビルド

```bash
pnpm run build
```

### 4. 起動

```bash
pnpm start
```

## Docker を使用した起動

```bash
# 環境変数を設定
cp .env.example .env
# .envファイルを編集

# Docker Compose で起動
docker compose up -d
```

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `MISSKEY_HOST` | Misskeyインスタンスのホスト名 | (必須) |
| `MISSKEY_TOKEN` | 管理者権限を持つAPIトークン | (必須) |
| `RENDERER_BASE_URL` | Service AのURL | (必須) |
| `VALKEY_HOST` | Valkeyホスト | `localhost` |
| `VALKEY_PORT` | Valkeyポート | `6379` |
| `VALKEY_PASSWORD` | Valkeyパスワード | (なし) |
| `OPENAI_API_KEY` | OpenAI APIキー | (必須) |
| `OPENAI_MODEL` | 使用するモデル | `gpt-5-mini-2025-08-07` |
| `PORT` | HTTPサーバーポート | `3000` |
| `LOG_LEVEL` | ログレベル | `info` |
| `RATE_LIMIT_MAX_REQUESTS` | レート制限（リクエスト数） | `10` |
| `RATE_LIMIT_WINDOW_SECONDS` | レート制限ウィンドウ（秒） | `60` |
| `STATE_TTL_SECONDS` | 対話ステートのTTL（秒） | `600` |

## API エンドポイント

### GET /health

ヘルスチェックエンドポイント

```json
{
  "status": "healthy",
  "timestamp": "2026-02-03T12:00:00.000Z",
  "checks": {
    "valkey": "ok"
  }
}
```

### GET /metrics

Prometheus形式のメトリクス

## 開発

```bash
# 開発モード（ホットリロード）
pnpm dev

# 型チェック
pnpm typecheck

# リント
pnpm lint
```

## ディレクトリ構成

```
src/
├── main.ts            # エントリポイント
├── streaming.ts       # WebSocketハンドラ
├── config.ts          # 設定
├── logger.ts          # ロガー
├── logic/
│   ├── filter.ts      # ユーザーフィルタリング
│   ├── generator.ts   # AI & レンダリング
│   └── registrar.ts   # 確認 & 登録
└── services/
    ├── valkey.ts      # Valkeyクライアント
    ├── llm.ts         # OpenAI連携
    ├── renderer.ts    # Service A連携
    └── misskey.ts     # Misskey API連携
```

## ライセンス

MIT
