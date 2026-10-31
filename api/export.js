// ============================================================
// サーバー生成エクスポート（第3弾 38 / Vercel Functions 専用）
// ------------------------------------------------------------
// お金タブからの POST で、Firestore live/money 等をもとに
//   kind=kakeibo-csv : 家計簿の全明細 CSV（Excel で開ける BOM 付き）
//   kind=report-html : 月次家計レポートの印刷用 HTML
//                      （ブラウザの印刷 → PDF 保存に対応）
// を生成する。金額データを含むため、自サイト Origin からの
// POST のみ許可する（error-log.js と同じ判定）。
// PDF ライブラリは依存が重いため、印刷用 HTML 方式を採用
// （レポートの見た目はブラウザ印刷の方が崩れにくい）。
// ============================================================
const lib = require('./_pushlib');
const gen = require('./_genlib');

const ALLOWED_ORIGINS = new Set([
  'https://juken-app-sigma.vercel.app'
]);
const VERCEL_ORIGIN_RE = /^https:\/\/juken-app(-[a-z0-9-]+)?\.vercel\.app$/;

function originAllowed(req) {
  const h = req.headers || {};
  const src = h.origin || h.referer || h.referrer || '';
  if (!src) return false;
  let origin;
  try { origin = new URL(src).origin; } catch (e) { return false; }
  return ALLOWED_ORIGINS.has(origin) || VERCEL_ORIGIN_RE.test(origin);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total <= 16 * 1024) chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const yen = (n) => '¥' + (Number(n) || 0).toLocaleString('ja-JP');

// kakeibo.months（{YYYY-MM: [row,...]}）→ CSV 文字列（純粋関数）
function kakeiboCsv(money) {
  const months = (money && money.kakeibo && money.kakeibo.months) || {};
  const lines = [['日付', '内容', 'カテゴリ', '出所', '区分', '金額（円）'].join(',')];
  for (const ym of Object.keys(months).sort()) {
    for (const r of (months[ym] || [])) {
      lines.push([r.date || '', csvCell(r.title || ''), csvCell(r.cat || ''), csvCell(r.src || ''), r.io === 'in' ? '収入' : '支出', Number(r.amount) || 0].join(','));
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// レポート表示用のデータを作る。live/householdReport に生成済みが
// あればそれを使い、無ければ live/money の summaries から最新月を組む。
function reportModel(household, money, ymWanted) {
  const reports = (household && household.reports) || {};
  const keys = Object.keys(reports).sort();
  if (keys.length) {
    const ym = (ymWanted && reports[ymWanted]) ? ymWanted : keys[keys.length - 1];
    return { ym, report: reports[ym], generated: true };
  }
  const summaries = Array.isArray(money?.summaries) ? money.summaries : [];
  if (!summaries.length) return null;
  const s = summaries[summaries.length - 1];
  const ym = s.month || '';
  const cats = (s.categories || []).map(c => ({ name: c.name, amount: Math.abs(Number(c.expense) || Number(c.amount) || 0) }))
    .filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);
  return {
    ym,
    generated: false,
    report: {
      expenseTotal: cats.reduce((a, c) => a + c.amount, 0),
      incomeTotal: Number(s.income) || 0,
      totalAssets: Number(money?.total) || 0,
      byCategory: cats,
      top: [],
      comment: ''
    }
  };
}

function reportHtml(model) {
  const r = model.report;
  const ym = model.ym;
  const title = `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月 家計レポート`;
  const cats = (r.byCategory || []).map(c =>
    `<tr><td>${escHtml(c.name)}</td><td class="num">${yen(c.amount)}</td><td class="num">${r.expenseTotal ? Math.round(c.amount / r.expenseTotal * 100) : 0}%</td></tr>`).join('');
  const top = (r.top || []).map(t =>
    `<tr><td>${escHtml(t.date || '')}</td><td>${escHtml(t.title || '')}</td><td class="num">${yen(t.amount)}</td></tr>`).join('');
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  body{font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;color:#222;margin:32px;line-height:1.7}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#666;font-size:12px;margin-bottom:20px}
  .total{font-size:30px;font-weight:800} table{border-collapse:collapse;width:100%;margin:12px 0 24px}
  td,th{border-bottom:1px solid #ddd;padding:6px 8px;font-size:13px;text-align:left} .num{text-align:right;white-space:nowrap}
  .comment{background:#f6f6f3;border-radius:8px;padding:12px 14px;font-size:13px;white-space:pre-wrap}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>📊 ${escHtml(title)}</h1>
<div class="sub">受験管理アプリ2027 のお金タブから生成（${model.generated ? '月次レポート自動生成の保存分' : 'マネーフォワード集計からの簡易生成'}）</div>
<div class="total">${yen(r.expenseTotal)}</div>
<div>支出合計${r.prevDiff != null ? `（前月比 ${r.prevDiff >= 0 ? '+' : ''}${yen(r.prevDiff)}${r.prevPct != null ? ` / ${r.prevPct > 0 ? '+' : ''}${r.prevPct}%` : ''}）` : ''} ／ 収入 ${yen(r.incomeTotal)} ／ 総資産 ${yen(r.totalAssets)}</div>
<h2 style="font-size:16px;margin-top:24px">カテゴリ別</h2>
<table><tr><th>カテゴリ</th><th class="num">金額</th><th class="num">割合</th></tr>${cats || '<tr><td colspan="3">データがありません</td></tr>'}</table>
${top ? `<h2 style="font-size:16px">大きな支出</h2><table><tr><th>日付</th><th>内容</th><th class="num">金額</th></tr>${top}</table>` : ''}
${r.comment ? `<h2 style="font-size:16px">コメント</h2><div class="comment">${escHtml(r.comment)}</div>` : ''}
</body></html>`;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return lib.sendJson(res, 405, { error: 'POST only' });
    if (!originAllowed(req)) return lib.sendJson(res, 403, { error: 'origin not allowed' });
    let raw = await readBody(req).catch(() => '');
    if (!raw && req.body) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return lib.sendJson(res, 400, { error: 'invalid JSON' }); }
    const kind = String(body.kind || '');

    if (kind === 'kakeibo-csv') {
      const money = await gen.getMoney();
      if (!money) return lib.sendJson(res, 404, { error: 'money data not found' });
      const csv = kakeiboCsv(money);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="kakeibo.csv"');
      return res.end(csv);
    }
    if (kind === 'report-html') {
      const [household, money] = await Promise.all([
        lib.fsGetJson('live/householdReport', 'data', null).catch(() => null),
        gen.getMoney().catch(() => null)
      ]);
      const model = reportModel(household, money, body.ym ? String(body.ym) : null);
      if (!model) return lib.sendJson(res, 404, { error: 'report data not found' });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(reportHtml(model));
    }
    return lib.sendJson(res, 400, { error: 'unknown kind' });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 30 };
module.exports.helpers = { kakeiboCsv, reportModel, reportHtml, originAllowed };
