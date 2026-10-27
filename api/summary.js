// ============================================================
// ウィジェット用 中間データ API（GET /api/summary）
// ------------------------------------------------------------
// iOS ショートカットやウィジェットから叩けるよう、CORS を許可し
// JSON で「次の締切と残り日数・共テまでの日数・入試情報の未読・
// 健全性・AI利用量サマリー」を返す。金額などセンシティブな情報は
// 含めない（お金系を出す場合は将来トークン付きで拡張する想定）。
// 認証なしで読めるのは live/* の公開読み取りと同じ範囲まで。
// ============================================================
const lib = require('./_pushlib');
const gen = require('./_genlib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'GET') return lib.sendJson(res, 405, { error: 'method not allowed' });
  try {
    const today = lib.todayJst();
    const upcoming = gen.upcomingEvents(today, 3);
    const kyotsuDays = gen.daysDiff(today, '2027-01-16');

    const [updates, sokuho, health, usage, briefing, alerts] = await Promise.all([
      lib.fsGetJson(lib.WATCH_DOC, 'updates', []).catch(() => []),
      lib.fsGetJson(lib.WATCH_DOC, 'sokuho', null).catch(() => null),
      lib.fsGetJson(lib.HEALTH_DOC, 'health', null).catch(() => null),
      lib.fsGetJson(lib.AI_USAGE_DOC, 'usage', null).catch(() => null),
      lib.fsGetJson('live/briefing', 'data', null).catch(() => null),
      lib.fsGetJson('live/alerts', 'data', null).catch(() => null)
    ]);

    const unreadUpdates = (Array.isArray(updates) ? updates : []).filter(u => u && !u.read);
    const ym = today.slice(0, 7);
    const aiMonth = usage ? { month: ym, ...gen.monthUsageTotals(usage, ym), costYen: gen.monthUsageCostYen(usage, ym) } : null;
    const unreadAlerts = (alerts && Array.isArray(alerts.alerts)) ? alerts.alerts.filter(a => a && !a.read).length : 0;

    return lib.sendJson(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      today,
      nextDeadline: upcoming[0] || null,
      upcomingDeadlines: upcoming,
      kyotsu: { date: '2027-01-16', daysLeft: kyotsuDays },
      admWatch: {
        unread: unreadUpdates.length,
        latest: unreadUpdates.length ? { uni: unreadUpdates[0].uni, at: unreadUpdates[0].at, url: unreadUpdates[0].url } : null
      },
      sokuho: sokuho || { status: 'pending', note: '志願者速報ページは未出現（入試ページのリンク出現を監視中）' },
      alerts: { unread: unreadAlerts },
      health: health ? { ok: !!health.ok, checkedAt: health.checkedAt || null, issueCount: (health.issues || []).length } : null,
      aiUsage: aiMonth,
      briefing: { date: today, available: !!(briefing && briefing.days && briefing.days[today]) }
    });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 30 };
