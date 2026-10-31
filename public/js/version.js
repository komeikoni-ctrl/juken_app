// アプリのバージョン。デプロイのたびにここを上げる（sw.js はこのファイルを読み込んで同じ値を使う）。
// Service Worker がこの値の変化を検知して「新しいバージョンがあります」バナーを出す。
const APP_VERSION = '2027.11.01-3';
const APP_BUILT_AT = '2026-11-01';
// cron-secret-rotation: 2026-10-27
