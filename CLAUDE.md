# TaskAnalyzer — 日次活動ログ要約 & LINE通知

## 概要
毎営業日17:00にローカルの活動ログ（ファイル操作・ブラウザ履歴・会議）を収集し、拡張子分析ベースで要約を作成、人間レビュー後にLINE通知するシステム。

## 技術スタック
- ランタイム: Node.js（npx実行、グローバルインストール不要）
- LINE通知: LINE Bot MCP Server (`@line/line-bot-mcp-server`)
- ブラウザ履歴: Chrome SQLite DB 直接読み取り
- スケジュール: Claude Code scheduled tasks

## フェーズ構成
- Phase 1: ファイル収集＋拡張子分類＋ドラフト生成（ローカル完結）
- Phase 2: ブラウザ履歴収集＋会議検出＋統合要約
- Phase 3: LINE通知＋監査ログ

## ファイル構成
```
TaskAnalyzer/
├── CLAUDE.md          # 本ファイル（設計・決定事項）
├── PROGRESS.md        # 作業ログ
├── docs/              # 手順書・調査結果
│   └── setup-line-mcp.md
├── src/               # ソースコード（Phase 1〜）
└── output/            # 生成された要約・ログ
```

## Supabase（プロジェクト: NAGANO / jkacguhaabaqtrjaahgl）
- `activity_scans`: 日次スキャン実行記録（日付、件数、要約テキスト、レビュー状態）
- `file_logs`: ファイル操作ログ（scan_id参照、名前、パス、拡張子、カテゴリ、サイズ、更新時刻）
- `browser_logs`: ブラウザ履歴ログ（scan_id参照、ブラウザ名、URL、タイトル、サイトタグ、閲覧時刻）
- LINE送信記録: `line_sent_at`, `line_message_id`, `line_status` (activity_scansに追加)
- RLS有効。データ投入はClaude Code MCP経由で実行。

## 決定事項
- 2026-06-24: プロジェクト開始。Node.js ベースで構築。
- 2026-06-24: ログデータはSupabase（NAGANOプロジェクト）に保存。分析はログ蓄積後に詳細設計。
- 2026-06-24: ブラウザはChrome/Edge/Brave 3つを対象。
