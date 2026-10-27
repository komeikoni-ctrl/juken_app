// ============================================================
// 月末家計レポートの自動生成（Vercel Cron 専用）
// ------------------------------------------------------------
// 毎月1日 JST 9:00（= 0:00 UTC）に Vercel Cron から呼ばれ、
// 前月の live/money から集計して live/householdReport に保存する。
// 集計は summaries（MFの月別カテゴリ集計）と kakeibo（明細）から
// 作り、Gemini の短いコメントを付ける。
// 手動実行: ?month=YYYY-MM で任意の月を生成できる（Cron 認可が前提）。
// 保存形式: live/householdReport の data = { reports: { 'YYYY-MM':
//   { month, generatedAt, expenseTotal, incomeTotal, byCategory,
//     prevDiff, prevPct, top, comment } } }
// ============================================================
const lib = require('./_pushlib');
const gen = require('./_genlib');

const REPORT_DOC = 'live/householdReport';

// live/money の中身から対象月のレポート材料を集計する（純粋関数）
function aggregateHousehold(money, ym) {
  if (!money) return null;
  const summaries = Array.isArray(money.summaries) ? money.summaries : [];
  const cur = summaries.find(s => s && s.month === ym);
  if (!cur) return null;
  const [y, mo] = ym.split('-').map(Number);
  const prevDate = new Date(Date.UTC(y, mo - 2, 1));
  const prevYm = prevDate.toISOString().slice(0, 7);
  const prev = summaries.find(s => s && s.month === prevYm);
  const sum = (arr) => (Array.isArray(arr) ? arr : []).reduce((a, e) => a + (Number(e?.value_in_jpy) || 0), 0);
  const expenseTotal = sum(cur.expenses);
  const incomeTotal = sum(cur.income);
  const prevExpense = prev ? sum(prev.expenses) : null;
  const byCategory = (cur.expenses || [])
    .map(e => ({ name: e.category_name, amount: Number(e.value_in_jpy) || 0 }))
    .sort((a, b) => b.amount - a.amount);
  // 大きな支出トップ3は家計簿明細から（対象月・支出のみ）
  const txs = (money.kakeibo && money.kakeibo.months && Array.isArray(money.kakeibo.months[ym])) ? money.kakeibo.months[ym] : [];
  const top = txs.filter(t => t && t.io === 'out')
    .slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
    .slice(0, 3)
    .map(t => ({ date: t.date, title: t.title, amount: Number(t.amount) || 0 }));
  return {
    month: ym,
    expenseTotal, incomeTotal,
    byCategory,
    prevMonth: prev ? prevYm : null,
    prevExpense,
    prevDiff: prevExpense != null ? expenseTotal - prevExpense : null,
    prevPct: (prevExpense != null && prevExpense > 0) ? Math.round((expenseTotal - prevExpense) / prevExpense * 100) : null,
    top,
    totalAssets: Number(money.total) || 0
  };
}

function householdPrompt(a) {
  const lines = [];
  lines.push('あなたは家計を見守るアシスタントです。月次家計レポートへの短いコメントを日本語で書いてください。');
  lines.push('条件: 2〜3文・150字以内。説教や過度な節約の押し付けは禁止。数字は材料のものだけを使う。');
  lines.push(`対象月: ${a.month}`);
  lines.push(`支出合計: ${a.expenseTotal}円 / 収入合計: ${a.incomeTotal}円 / 現在の総資産: ${a.totalAssets}円`);
  if (a.prevDiff != null) lines.push(`前月比: ${a.prevDiff >= 0 ? '+' : ''}${a.prevDiff}円（${a.prevPct != null ? (a.prevPct >= 0 ? '+' : '') + a.prevPct + '%' : ''}）`);
  lines.push('カテゴリ別支出: ' + a.byCategory.slice(0, 5).map(c => `${c.name} ${c.amount}円`).join(' / '));
  if (a.top && a.top.length) lines.push('大きな支出: ' + a.top.map(t => `${t.title} ${t.amount}円`).join(' / '));
  return lines.join('\n');
}

async function runHousehold(ym, generate) {
  const money = await gen.getMoney();
  const agg = aggregateHousehold(money, ym);
  if (!agg) return { skipped: true, reason: 'no summary for ' + ym };
  let comment = '';
  try { comment = await generate(householdPrompt(agg), { maxOutputTokens: 1536 }); } // 思考トークン分も見込んで広めに
  catch (e) { comment = ''; } // コメントが取れなくても集計だけは保存する
  const report = { ...agg, comment, generatedAt: new Date().toISOString() };
  const doc = await lib.fsGetJson(REPORT_DOC, 'data', { reports: {} });
  if (!doc.reports || typeof doc.reports !== 'object') doc.reports = {};
  doc.reports[ym] = report;
  doc.latest = ym;
  await lib.fsSetJson(REPORT_DOC, 'data', doc);
  return { month: ym, expenseTotal: agg.expenseTotal, commentChars: comment.length };
}

function prevMonthStr(today) {
  const [y, mo] = today.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
}

module.exports = async (req, res) => {
  try {
    if (!lib.cronAuthorized(req)) return lib.sendJson(res, 401, { error: 'unauthorized' });
    const qs = new URL(req.url, 'https://x').searchParams;
    const today = lib.todayJst();
    const ym = qs.get('month') || prevMonthStr(today);
    const generate = (prompt, o) => gen.geminiGenerate(prompt, o);
    const result = await runHousehold(ym, generate);
    return lib.sendJson(res, 200, { ok: true, date: today, ...result });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 60 };
module.exports.helpers = { aggregateHousehold, householdPrompt, runHousehold, prevMonthStr, REPORT_DOC };
