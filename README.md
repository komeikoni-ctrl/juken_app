# 受験管理アプリ 2027

大学受験（2027年度入試）のための個人用の学習・出願管理アプリ。スマホのホーム画面に置いて使うWebアプリ（PWA）。

- 公開URL: https://juken-app-sigma.vercel.app/ （Vercel。公開先はここだけ）
  - 旧URL（GitHub Pages の `komeikoni-ctrl.github.io/juken_app/` と Firebase Hosting の `juken2027-63058.web.app`）は、Vercel 版へ案内する転送ページになっている（`pages-redirect/`）
- データの保存: Firebase Firestore（端末どうしで同期）
- AI: Google Gemini API（キーは各端末のブラウザ内にだけ保存し、同期もコードへの記載もしない）

## 主な機能

| タブ | できること |
|---|---|
| ホーム | 今日の学習時間、入試カウントダウン、今日のタスク |
| タイマー | ストップウォッチ／ポモドーロ／カウントダウンで学習時間を記録 |
| カレンダー | 予定・繰り返し予定、iPhoneのカレンダーへの書き出し |
| 志望校 | 私大一般入試の合格ラインチェック、過去問の記録、共通テストのシミュレーター |
| 出願 | 共通テストの手続き、同志社・立命館・近大の出願プラン、受験日の重複チェック |
| 分析 | 学習時間のグラフ、模試の偏差値・得点の推移、苦手分野 |
| 駿台 | 時間割、宿題、ノートのスキャン検索、模試の成績 |
| AIコーチ | 相談チャット、今日のプラン、類題の作成、手元の教材に聞く |

## ファイルの構成

ビルドの手順はない。`public/` の中身がそのまま公開される。

```
public/
  index.html        画面（全タブ）
  sw.js             Service Worker（オフライン対応・更新の通知）
  js/version.js     バージョン（公開のたびに上げる）
  js/00-core.js     日付・共通の道具
  js/01-state.js    データの形（初期値）
  js/02-db.js       Firestore との同期
  js/03-ai.js       Gemini の呼び出し・使えるモデルの一覧
  js/04-coach.js    AIに渡す情報の組み立て、全画面の再描画
  js/05-chat.js     相談チャット
  js/06-home.js     ホーム
  js/07-timer-calendar.js  タイマー・カレンダー・志望校
  js/08-analytics.js       分析のグラフ
  js/09-misc.js     タブ切り替え・設定
  js/10-apply.js    出願管理
  js/12-textbooks.js 教材の検索（本文は Firestore から読む）
  js/13-exam-plan.js 2027年度の出願プラン（大学公式で確認した日程・配点）
  js/14-kyotsu.js   共通テストの手続き
  js/15-past-exams.js 私大一般の合格ラインチェックと過去問の記録
  js/11-boot.js     起動処理とセルフテスト（最後に読み込む）
api/                Vercel のサーバー機能（AI中継・定期処理・通知など）
pages-redirect/     旧URL（GitHub Pages / Firebase Hosting）用の転送ページ
tools/              教材PDFから本文を取り出してクラウドに上げる Python スクリプト
```

JSは `index.html` の `<script>` の順に読み込まれる。新しいJSを足したら `index.html` と `sw.js` の `PRECACHE` の両方に書く。

## 動作確認と公開

- **main に push すると Vercel に自動で公開される**（`public/` が公開され、`api/` がサーバー機能になる）。
- GitHub Actions（`.github/workflows/pages.yml`）は、push のたびに JSの構文・公開してはいけないファイル・`index.html` と `sw.js` の読み込み一覧をチェックし、GitHub Pages には転送ページ（`pages-redirect/`）だけを公開する。
- Firebase Hosting を転送ページに切り替えるとき（1回だけ）: `firebase deploy --only hosting --config firebase.redirect.json`
- 変更したら `public/js/version.js` の `APP_VERSION` を上げる（スマホに「新しいバージョンがあります」と出す合図。上げないと古い版が残る）。
- 新しいJSを足したら、`index.html` の `<script>` と `sw.js` の `PRECACHE` の両方に書く。
- ローカルでは必ず `http://localhost:5000/?sandbox=1` で開く（本番とは別のテスト用データに読み書きする）。
- 設定タブの「セルフチェック」（`SelfTest.run()`）が全件通ることを確かめる。

## このリポジトリに入れていないもの

- `textbook-data/` … 塾・学校・参考書のテキストの本文。著作物なので GitHub には置かない。
