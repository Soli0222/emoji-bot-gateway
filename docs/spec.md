# Service B: Emoji Bot Gateway - 詳細設計書 (v1.0)

## 1. 概要

**責務:**
Misskey Streaming APIを介してユーザーとの対話を行う常駐型アプリケーション。
自サーバー（Local）のユーザーからのメンションのみを受け付け、AIによる画像生成・ユーザー確認・絵文字登録までを自動化する。

**アーキテクチャ特性:**

* **Connection:** WebSocket (Persistent Connection)
* **Process Model:** Long-running Daemon (Node.js)
* **Scope:** **Local Users Only** (他インスタンスからのメンションは無視)

## 2. 技術スタック

* **Runtime:** Node.js (TypeScript)
* **Misskey Interface:** `misskey-js` (Stream class)
* **Web Framework (Ops):** Hono (Health Check / Metrics用)
* **AI Model:** **OpenAI `gpt-5-mini-2025-08-07**`
* **State Management:** **Valkey** (v7.2+)
* ライブラリ: `ioredis` (Valkey完全互換のためそのまま採用)
* 用途: 対話ステート管理 (TTL付きキー)



## 3. 処理フロー (Event Driven Workflow)

### Initialization

1. **Startup:**
* Service A (`/fonts`) からフォントリストを取得・キャッシュ。
* Valkey 接続確立。
* Misskey Streaming API (`wss://...`) へ接続 (`main` channel)。



### Phase 1: 受付 & フィルタリング (Event: `mention`)

2. **Event Trigger:**
* Stream -> `client.on('mention', payload)` 発火。


3. **Guard Clause (Filtering):**
* `payload.user.host` を検査。
* **`host` が `null` (ローカルユーザー) 以外の場合** → **即時return** (ログには "Ignored remote user" と記録)。
* これにより、他インスタンスからの無差別なBot利用や攻撃を無効化する。


4. **Context Check:**
* Valkeyを確認 (`GET state:{userId}`)。
* ステートが存在する場合 → **Phase 3 (確認フロー)** へ分岐。
* ステートがない場合 → **Phase 2 (生成フロー)** へ進む。



### Phase 2: 生成 & 提案 (Generation)

5. **AI Processing:**
* LLM (GPT-5-mini) へ入力。フォントリスト注入済みSchemaを使用。
* Output: JSONパラメータ。


6. **Rendering:**
* Service B -> Service A: JSON送信 → 画像バイナリ取得。


7. **Upload (Preview):**
* Service B -> Misskey Drive: 画像アップロード → `fileId` 取得。


8. **State Save:**
* Valkeyにステートを保存 (TTL: 10分)。
```json
key: "state:{userId}"
value: {
    "status": "confirming",
    "fileId": "9abcd...",
    "shortcode": "utsu_burnout",
    "replyToId": "noteId_of_user"
}

```




9. **Bot Reply:**
* 画像を添付し、「ショートコード `:utsu_burnout:` で登録しますか？（はい/いいえ）」と返信。



### Phase 3: 確認・実行 (Action)

10. **Evaluation:**
* ユーザーのリプライ内容を簡易判定（正規表現等）。
* **Yes ("はい", "OK", "お願い"):**
* Valkeyから `fileId`, `shortcode` を取得。
* Misskey API (`admin/emoji/add`) 実行。
* 成功時: 「登録しました！ :utsu_burnout:」とリプライ。
* Valkeyキー削除 (`DEL state:{userId}`)。


* **No ("いいえ", "ダメ", "作り直して"):**
* Bot: 「承知しました。作り直します。」
* Valkeyキー削除。
* **Phase 2へ再突入**（リトライ処理）。


* **Ignore:**
* 明確なYes/Noが含まれない雑談等は定型文で誘導。





## 4. データストア設計 (Valkey)

Redis互換のため、既存の知見をそのまま流用します。

* **Prefix Strategy:** `bot:emoji:` をプレフィックスとし、他システムとの衝突を防ぐ。
* **Key Design:**
* `bot:emoji:state:{userId}` (Hash or String-JSON)
* TTL: 600 (10分) - ユーザーが離席したら自動で会話状態を破棄するため。





## 5. エラーハンドリング & 運用

* **Bot Account Restriction:**
* Botアカウント自体がサイレンスや凍結をされないよう、短時間の連続リプライ制限（Rate Limitのセルフ制御）を実装する（ValkeyのToken Bucket等を利用）。


* **Streaming Reconnection:**
* 切断時は `Fibonacci Backoff` 等で再接続を試行。



## 6. ディレクトリ構成

```text
service-b/
├── src/
│   ├── main.ts            # Entrypoint
│   ├── streaming.ts       # WebSocket Handler (Host check logic here)
│   ├── logic/
│   │   ├── filter.ts      # User filtering logic (isLocalUser)
│   │   ├── generator.ts   # AI & Rendering orchestration
│   │   └── registrar.ts   # Confirmation & Registration
│   ├── services/
│   │   ├── valkey.ts      # Valkey Client (ioredis wrapper)
│   │   ├── llm.ts
│   │   ├── renderer.ts
│   │   └── misskey.ts
│   └── config.ts
├── Dockerfile
└── package.json

```
