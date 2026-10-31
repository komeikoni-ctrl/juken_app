// ============================================================
// 第2弾（定期生成系）の共有ライブラリ（Vercel Functions 専用）
// ------------------------------------------------------------
// ・Firestore REST の値（{stringValue:...} 形式）を通常の JS 値へ戻す
// ・プロフィール / サブコレクション / live/money の読み取り
// ・Gemini のサーバー側生成（GEMINI_API_KEY、利用量も記録）
// ・締切イベント（cron-notify と同じ確定日程）と残り日数
// ・AI 単価表（アプリ側 03-ai.js の AI_PRICES と揃える）
// ============================================================
const lib = require('./_pushlib');

// ---------- Firestore REST 値の復元 ----------
function fsUnwrap(v) {
  if (v == null || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsUnwrap);
  if ('mapValue' in v) {
    const out = {};
    const f = v.mapValue.fields || {};
    for (const k of Object.keys(f)) out[k] = fsUnwrap(f[k]);
    return out;
  }
  return null;
}
function fsDocToObj(doc) {
  if (!doc || !doc.fields) return null;
  const out = {};
  for (const k of Object.keys(doc.fields)) out[k] = fsUnwrap(doc.fields[k]);
  out.__updateTime = doc.updateTime || null;
  return out;
}

// プロフィール本体を通常オブジェクトで読む
async function getProfile() {
  const doc = await lib.fsGetDoc(lib.PROFILE_DOC);
  return fsDocToObj(doc);
}

// サブコレクションを全件（上限まで）読む。通常オブジェクトの配列で返す
async function listCollection(path, maxDocs) {
  const out = [];
  let pageToken = '';
  const cap = maxDocs || 300;
  while (out.length < cap) {
    const url = `${lib.FS_BASE}/${path}?pageSize=100${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) break;
    if (!res.ok) throw new Error('firestore list failed: ' + res.status);
    const j = await res.json();
    for (const d of (j.documents || [])) out.push(fsDocToObj(d));
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  return out.slice(0, cap);
}

// live/money の中身（JSON 文字列フィールド money）をオブジェクトで読む
async function getMoney() {
  return await lib.fsGetJson(lib.MONEY_DOC, 'money', null);
}

// ---------- 日付ユーティリティ（JST） ----------
function jstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
function dateStrJst(d) { return d.toISOString().slice(0, 10); }
function daysDiff(fromStr, toStr) {
  return Math.round((Date.parse(toStr + 'T00:00:00Z') - Date.parse(fromStr + 'T00:00:00Z')) / 86400000);
}
// ISO 週キー（YYYY-Www）。JST の日付文字列から計算する
function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // その週の木曜
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

// ---------- 学習記録（dailyLogs サブコレクション） ----------
// ドキュメント名が日付（YYYY-MM-DD）、中身は {total, subjects:{科目:分}}。
// プロフィール本体の todayMinutes / streak はアプリが更新しなくなった古い値なので使わない。
// { 'YYYY-MM-DD': {total, subjects} } の形で返す。
async function listDailyLogs(maxDocs) {
  const out = {};
  const cap = maxDocs || 2000;
  let pageToken = '';
  let n = 0;
  while (n < cap) {
    const url = `${lib.FS_BASE}/${lib.PROFILE_DOC}/dailyLogs?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) break;
    if (!res.ok) throw new Error('firestore list failed: ' + res.status);
    const j = await res.json();
    for (const d of (j.documents || [])) {
      n++;
      const id = String(d.name || '').split('/').pop();
      if (/^\d{4}-\d{2}-\d{2}$/.test(id)) out[id] = fsDocToObj(d);
    }
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
}

function addDaysStr(dateStr, n) {
  return dateStrJst(new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000));
}

// 日別ログから「昨日の分数・連続日数・累計・最後に記録した日・直近7日」を出す（純粋関数）。
// 連続日数はアプリの calcStreak と同じく、今日の記録が無ければ昨日から遡って数える。
function studyStats(logs, today) {
  const L = (logs && typeof logs === 'object') ? logs : {};
  const mins = (d) => { const v = Number(L[d] && L[d].total); return Number.isFinite(v) && v > 0 ? Math.round(v) : 0; };
  const yesterday = addDaysStr(today, -1);
  let totalMinutes = 0;
  let lastStudyDate = null;
  for (const d of Object.keys(L)) {
    const v = mins(d);
    if (!v) continue;
    totalMinutes += v;
    if (d <= today && (!lastStudyDate || d > lastStudyDate)) lastStudyDate = d;
  }
  let streak = 0;
  let cur = mins(today) > 0 ? today : yesterday;
  for (let i = 0; i < 730 && mins(cur) > 0; i++) { streak++; cur = addDaysStr(cur, -1); }
  let last7Minutes = 0;
  const subj = {};
  for (let i = 1; i <= 7; i++) {
    const d = addDaysStr(today, -i);
    last7Minutes += mins(d);
    const sb = L[d] && L[d].subjects;
    if (sb && typeof sb === 'object') {
      for (const k of Object.keys(sb)) { const v = Number(sb[k]) || 0; if (v > 0) subj[k] = (subj[k] || 0) + v; }
    }
  }
  const last7Subjects = Object.entries(subj).map(([subject, minutes]) => ({ subject, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes);
  return {
    today, yesterday,
    todayMinutes: mins(today),
    yesterdayMinutes: mins(yesterday),
    streak, totalMinutes, lastStudyDate,
    daysSinceLast: lastStudyDate ? daysDiff(lastStudyDate, today) : null,
    last7Minutes, last7Subjects
  };
}

// ---------- 締切イベント（api/cron-notify.js の EVENTS と同一の確定日程） ----------
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
  { id: 'enroll-close',     date: '2027-03-01', label: '入学手続 一次締切（立命館・同志社）' }
];
function upcomingEvents(today, limit) {
  return EVENTS
    .map(e => ({ ...e, daysLeft: daysDiff(today, e.date) }))
    .filter(e => e.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, limit || 3);
}

// ---------- AI 単価（03-ai.js の AI_PRICES と同一）と概算 ----------
const AI_PRICES = {
  'gemini-4-argon':       [{ until: '2026-11-30', input: 2.00, output: 10.00 }, { until: null, input: 4.00, output: 20.00 }],
  'gemini-3.8-flash':     [{ until: '2026-12-31', input: 0.75, output: 3.75 }, { until: null, input: 1.50, output: 7.50 }],
  'gemini-3.6-flash':     [{ until: null, input: 0.75, output: 3.75 }],
  'gemini-3.5-flash-lite': [{ until: null, input: 0.10, output: 0.40 }],
  'gemini-3.1-pro-preview': [{ until: null, input: 2.00, output: 12.00 }],
  'gemini-2.5-flash':     [{ until: null, input: 0.30, output: 2.50 }]
};
const AI_USD_JPY = 155;
function estimateYen(model, inTok, outTok, dateStr) {
  const tiers = AI_PRICES[model] || AI_PRICES['gemini-3.8-flash'];
  let p = tiers[tiers.length - 1];
  for (const t of tiers) { if (!t.until || (dateStr || '') <= t.until) { p = t; break; } }
  return ((Number(inTok) || 0) * p.input + (Number(outTok) || 0) * p.output) / 1000000 * AI_USD_JPY;
}

// live/aiUsage の月次集計（アプリ側 AiUsageUI._monthTotals と同じ形に合計する）
function monthUsageTotals(usage, ym) {
  const out = { calls: 0, in: 0, out: 0, byModel: {} };
  const days = (usage && usage.days) || {};
  for (const day of Object.keys(days)) {
    if (!day.startsWith(ym)) continue;
    for (const m of Object.keys(days[day] || {})) {
      const v = days[day][m] || {};
      const b = out.byModel[m] || { calls: 0, in: 0, out: 0 };
      b.calls += v.calls || 0; b.in += v.in || 0; b.out += v.out || 0;
      out.byModel[m] = b;
      out.calls += v.calls || 0; out.in += v.in || 0; out.out += v.out || 0;
    }
  }
  return out;
}
function monthUsageCostYen(usage, ym) {
  const t = monthUsageTotals(usage, ym);
  let yen = 0;
  for (const m of Object.keys(t.byModel)) yen += estimateYen(m, t.byModel[m].in, t.byModel[m].out, ym + '-15');
  return Math.round(yen);
}
// 直近 n 日分（JST の日付文字列リスト）の利用量合計
function recentUsageTotals(usage, dayStrs) {
  const out = { calls: 0, in: 0, out: 0 };
  const days = (usage && usage.days) || {};
  for (const d of dayStrs) {
    for (const m of Object.keys(days[d] || {})) {
      const v = days[d][m] || {};
      out.calls += v.calls || 0; out.in += v.in || 0; out.out += v.out || 0;
    }
  }
  return out;
}

// ---------- Gemini サーバー側生成 ----------
// 利用量は中継（api/gemini.js）と同じ流儀で live/aiUsage に加算する
async function recordUsageQuiet(model, usage) {
  if (!usage) return;
  try {
    const inTok = Number(usage.promptTokenCount || 0);
    const outTok = Number(usage.candidatesTokenCount || 0) + Number(usage.thoughtsTokenCount || 0);
    const doc = await lib.fsGetJson(lib.AI_USAGE_DOC, 'usage', { days: {} });
    if (!doc.days || typeof doc.days !== 'object') doc.days = {};
    const day = lib.todayJst();
    if (!doc.days[day]) doc.days[day] = {};
    const cur = doc.days[day][model] || { calls: 0, in: 0, out: 0 };
    cur.calls += 1; cur.in += inTok; cur.out += outTok;
    doc.days[day][model] = cur;
    const keys = Object.keys(doc.days).sort();
    while (keys.length > 62) delete doc.days[keys.shift()];
    doc.updatedAt = new Date().toISOString();
    await lib.fsSetJson(lib.AI_USAGE_DOC, 'usage', doc);
  } catch (e) { /* 集計の失敗は生成に影響させない */ }
}

// 短文生成してテキストを返す。失敗時は例外。
// fetchImpl を差し替えればローカル検証（中継経由など）でも同じコードを使える。
async function geminiGenerate(prompt, opts) {
  const o = opts || {};
  const model = o.model || 'gemini-3.8-flash';
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey && !o.fetchImpl) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: o.maxOutputTokens || 1024, temperature: o.temperature != null ? o.temperature : 0.7 }
  };
  const doFetch = o.fetchImpl || fetch;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('gemini generate failed: ' + res.status);
  const j = await res.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('').trim();
  if (j?.usageMetadata) await recordUsageQuiet(model, j.usageMetadata);
  if (!text) throw new Error('gemini returned empty text');
  return text;
}

module.exports = {
  fsUnwrap, fsDocToObj, getProfile, listCollection, getMoney,
  jstNow, dateStrJst, daysDiff, isoWeekKey, addDaysStr,
  listDailyLogs, studyStats,
  EVENTS, upcomingEvents,
  estimateYen, monthUsageTotals, monthUsageCostYen, recentUsageTotals,
  geminiGenerate, recordUsageQuiet
};
