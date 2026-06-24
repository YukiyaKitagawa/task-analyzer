# LINE Bot MCP サーバー セットアップ手順

## 前提
- LINE公式アカウント（無料で作成可能）
- Node.js がインストール済み

## 手順

### 1. LINE公式アカウントを作成
1. [LINE Developers](https://developers.line.biz/ja/) にアクセス
2. LINEアカウントでログイン
3. 「プロバイダー」→「作成」→ 任意の名前（例: `ActivityLog`）
4. 「Messaging API」チャネルを作成
   - チャネル名: 任意（例: `活動ログ通知`）
   - 説明: 任意
   - 他はデフォルトでOK

### 2. Channel Access Token を取得
1. 作成したチャネルの設定画面を開く
2. 「Messaging API」タブへ移動
3. 一番下の「Channel access token (long-lived)」→「Issue」をクリック
4. 表示されたトークンをコピー

### 3. 自分のユーザーIDを取得
1. 同じチャネル設定画面の「Basic settings」タブ
2. 「Your user ID」をコピー（U から始まる文字列）

### 4. LINE公式アカウントを友だち追加
1. 「Messaging API」タブにある QR コードをスマホで読み取り
2. 友だち追加する（これをしないとメッセージが届きません）

### 5. Claude Code に MCP サーバーを追加
以下のコマンドを Claude Code のチャットで依頼してください:
「LINE Bot MCP サーバーを設定して」と伝えれば設定します。

### 6. 動作確認
Claude Code から「LINEにテストメッセージを送って」と依頼 → スマホに届けば成功

## アンインストール
Claude Code の MCP 設定から `line-bot` を削除するだけ。グローバル環境は汚れません。

## 参考
- [LINE Bot MCP Server (GitHub)](https://github.com/line/line-bot-mcp-server)
- [LINE Developers ドキュメント](https://developers.line.biz/ja/docs/messaging-api/)
