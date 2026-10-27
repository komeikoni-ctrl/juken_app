// ============================================================
// 締切・日程リマインドの日次チェック（Vercel Cron 専用）
// ------------------------------------------------------------
// 毎日 JST 8:00（= 23:00 UTC）に Vercel Cron から呼ばれる。
// 確定日程を見て「3日前・前日・当日」に当たるものがあれば、
// Web Push で全購読へ通知する。同じイベント・同じタイミングの
// 通知は Firestore の送信ログで二重送信を防ぐ。
// 認可: Vercel Cron が付ける Authorization: Bearer <CRON_SECRET>
//       （手動実行は x-cron-secret ヘッダーでも可）。
// 手動テスト: ?test=1 を付けると日程に関係なくテスト通知を送る。
// ============================================================
const lib = require('./_pushlib');

// 確定日程（出願プランと確定事項に基づく。date は JST の暦日）
const EVENTS = [
  { id: 'doshisha-open',    date: '2026-12-21', label: '同志社大学 出願開始' },
  { id: 'kindai-open',      date: '2027-01-03', label: '近畿大学 出願開始' },
  { id: 'rits-open',        date: '2027-01-06', label: '立命館大学 出願開始' },
  { id: 'doshisha-close',   date: '2027-01-07', label: '同志社大学 出願締切（全方式）' },
  { id: 'kyote-close',      date: '2027-01-15', label: '共テ利用方式 出願締切（立命館・近畿）' },
  { id: 'kyotsu-1',         date: '2027-01-16', label: '共通テスト 1日目' },
  { id: 'kyotsu-2',         date: '2027-01-17', label: '共通テスト 2日目' },
  { id: 'rits-close',       date: '2027-01-22', label: '立命館大学 全学統一 出願締切' },
  { id: 'kindai-close',     date: '2027-01-23', label: '近畿大学 前期A 出願締切' },
  { id: 'result-kindai',    date: '2027-02-10', label: '近畿大学 前期A 合格発表' },
  { id: 'result-doshisha-econ', date: '2027-02-15', label: '同志社大学 経済 合格発表' },
  { id: 'result-rits',      date: '2027-02-17', label: '立命館大学 合格発表' },
  { id: 'result-doshisha-sho',  date: '2027-02-18', label: '同志社大学 商 合格発表' },
  { id: 'enroll-close',     date: '2027-03-01', label: '入学手続 一次締切' }
];
const NOTIFY_DIFFS = [3, 1, 0]; // 3日前・前日・当日に通知

// JST の今日を YYYY-MM-DD で返す
function todayJst() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}
function daysDiff(fromStr, toStr) {
  const a = Date.parse(fromStr + 'T00:00:00Z');
  const b = Date.parse(toStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}
const TIMING_LABEL = { 3: 'あと3日', 1: '明日', 0: '今日' };

module.exports = async (req, res) => {
  try {
    if (!lib.cronAuthorized(req)) return lib.sendJson(res, 401, { error: 'unauthorized' });

    const qs = new URL(req.url, 'https://x').searchParams;
    if (qs.get('test') === '1') {
      const r = await lib.sendPushToAll({
        title: '🔔 テスト通知',
        body: 'cron-notify の手動テストです。通知が届いていれば Push の経路は正常です。',
        url: '/', tag: 'juken-test-cron'
      });
      return lib.sendJson(res, 200, { ok: true, test: true, ...r });
    }

    const today = todayJst();
    const due = [];
    for (const ev of EVENTS) {
      const d = daysDiff(today, ev.date);
      if (NOTIFY_DIFFS.includes(d)) due.push({ ...ev, diff: d });
    }
    if (!due.length) return lib.sendJson(res, 200, { ok: true, date: today, due: [], sent: 0 });

    // 二重送信防止: 送信済みログ（{ "イベントid:diff": "送った日" }）
    const log = await lib.fsGetJson(lib.PUSH_STATE_DOC, 'notifyLog', {});
    const fresh = due.filter(ev => log[ev.id + ':' + ev.diff] !== today);
    if (!fresh.length) return lib.sendJson(res, 200, { ok: true, date: today, due: due.map(e => e.id), sent: 0, note: 'already sent today' });

    let sentTotal = 0;
    for (const ev of fresh) {
      const r = await lib.sendPushToAll({
        title: '📮 ' + TIMING_LABEL[ev.diff] + '：' + ev.label,
        body: ev.diff === 0 ? '本日です。忘れずに対応しましょう。' : '日程が近づいています。準備を確認しましょう。',
        url: '/', tag: 'juken-' + ev.id
      });
      sentTotal += r.sent;
      log[ev.id + ':' + ev.diff] = today;
    }
    try { await lib.fsSetField(lib.PUSH_STATE_DOC, 'notifyLog', JSON.stringify(log)); } catch (e) { /* ログ失敗でも通知は済んでいる */ }
    return lib.sendJson(res, 200, { ok: true, date: today, due: fresh.map(e => e.id + ':' + e.diff), sent: sentTotal });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 60 };
