// ============================================================
// PayPay CSV 取込の半自動化（第3弾 66 / Vercel Functions 専用）
// ------------------------------------------------------------
// アプリのお金タブから PayPay 取引履歴 CSV を受け取り、
//   mode=preview: パース結果と現在のスナップショットとの差分を返す（書かない）
//   mode=commit : データセットを live/paypayImport に保存する
// の2段階で取り込む。集計規則は あみの VM の money.py と同一:
//   ・「支払い」行（出金 > 0）だけを支払いとして数える
//   ・取引番号での重複除去は絶対にしない（ポイント獲得行と支払い行が
//     同一番号を共有し、除去すると支払いが欠落するため）
//   ・同じファイルの再取込は、ファイル内容の SHA-256 で検出して拒否する
// 取込んだ行は money.py（VM チェッカー）も読み、家計簿マージと
// PayPay 集計に合流させる（ファイルハッシュが VM 側ファイルと一致する
// データセットは二重に数えない）。
// 期間が現在のスナップショットの続き（拡張）の場合だけ、その場で
// live/money の paypay 欄も合算更新する。重なる期間の場合は集計の
// 二重計上を避けるため、次回チェッカー実行（2時間おき）での反映にする。
// ============================================================
const crypto = require('crypto');
const lib = require('./_pushlib');

const ALLOWED_ORIGINS = new Set([
  'https://juken-app-sigma.vercel.app',
  'https://komeikoni-ctrl.github.io'
]);
const VERCEL_ORIGIN_RE = /^https:\/\/juken-app(-[a-z0-9-]+)?\.vercel\.app$/;
const MAX_CSV_BYTES = 8 * 1024 * 1024;

function originAllowed(req) {
  const h = req.headers || {};
  const src = h.origin || h.referer || h.referrer || '';
  if (!src) return false;
  let origin;
  try { origin = new URL(src).origin; } catch (e) { return false; }
  return ALLOWED_ORIGINS.has(origin) || VERCEL_ORIGIN_RE.test(origin);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total <= limit) chunks.push(c); });
    req.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), total }));
    req.on('error', reject);
  });
}

// 引用符対応の簡易 CSV パーサ（PayPay のエクスポート形式に十分な範囲）
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length && r.some(v => String(v).trim() !== ''));
}

function amt(v) {
  const s = String(v == null ? '' : v).replace(/,/g, '').trim();
  if (!s || s === '-' || s === '−') return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// CSV テキスト → 正規化した行配列 [[date, content, out, in, merchant], ...]
// ヘッダーが想定と違う場合は例外（ importedAt 等の検証は呼び出し側）。
function parsePaypayCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSVに行がありません');
  const head = rows[0].map(v => String(v).trim());
  const idx = (name) => head.indexOf(name);
  const iDate = idx('取引日'), iContent = idx('取引内容'), iOut = idx('出金金額（円）'),
    iIn = idx('入金金額（円）'), iMerchant = idx('取引先');
  if (iDate < 0 || iContent < 0 || iOut < 0 || iMerchant < 0) throw new Error('PayPayの取引履歴CSVの形式ではありません（列が見つかりません）');
  const out = [];
  for (const r of rows.slice(1)) {
    const d = String(r[iDate] || '').slice(0, 10).replace(/\//g, '-');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    out.push([d, String(r[iContent] || '').trim(), amt(r[iOut]), iIn >= 0 ? amt(r[iIn]) : 0, String(r[iMerchant] || '').trim() || 'PayPay']);
  }
  if (!out.length) throw new Error('有効な取引行がありません');
  return out;
}

// money.py の aggregate_paypay と同じ規則で集計する（純粋関数）
// rows: [[date, content, out, in, merchant], ...]（複数データセットの合算も可）
function aggregatePaypay(rows) {
  const monthly = {}; const merchants = {}; let total = 0, count = 0;
  const dates = [];
  for (const r of rows || []) {
    const d = r[0];
    if (d) dates.push(d);
    if (r[1] !== '支払い') continue;
    const a = Number(r[2]) || 0;
    if (a <= 0) continue;
    const ym = String(d).slice(0, 7);
    const e = monthly[ym] || (monthly[ym] = [0, 0]); e[0] += a; e[1] += 1;
    const name = String(r[4] || '不明');
    const e2 = merchants[name] || (merchants[name] = [0, 0]); e2[0] += a; e2[1] += 1;
    total += a; count += 1;
  }
  if (!dates.length) return null;
  dates.sort();
  const monthsSorted = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const tops = Object.entries(merchants).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8);
  return {
    snapshotAsOf: dates[dates.length - 1],
    periodFrom: dates[0],
    periodTo: dates[dates.length - 1],
    totalPayments: total,
    paymentCount: count,
    monthlyPayments: monthsSorted.map(([k, v]) => ({ month: k, amount: v[0], count: v[1] })),
    topMerchants: tops.map(([k, v]) => ({ name: k, amount: v[0], count: v[1] }))
  };
}

// 2つの集計（既存＋新規）を月・店単位で合算する（期間が重ならない前提でのみ使う）
function mergeAggregates(a, b) {
  if (!a) return b;
  if (!b) return a;
  const monthly = {}; const merchants = {};
  for (const src of [a, b]) {
    for (const m of (src.monthlyPayments || [])) {
      const e = monthly[m.month] || (monthly[m.month] = [0, 0]); e[0] += m.amount; e[1] += m.count;
    }
    for (const t of (src.topMerchants || [])) {
      const e = merchants[t.name] || (merchants[t.name] = [0, 0]); e[0] += t.amount; e[1] += t.count;
    }
  }
  const monthsSorted = Object.entries(monthly).sort((x, y) => x[0].localeCompare(y[0])).slice(-12);
  const tops = Object.entries(merchants).sort((x, y) => y[1][0] - x[1][0]).slice(0, 8);
  return {
    snapshotAsOf: [a.snapshotAsOf, b.snapshotAsOf].sort().slice(-1)[0],
    periodFrom: [a.periodFrom, b.periodFrom].sort()[0],
    periodTo: [a.periodTo, b.periodTo].sort().slice(-1)[0],
    totalPayments: (a.totalPayments || 0) + (b.totalPayments || 0),
    paymentCount: (a.paymentCount || 0) + (b.paymentCount || 0),
    monthlyPayments: monthsSorted.map(([k, v]) => ({ month: k, amount: v[0], count: v[1] })),
    topMerchants: tops.map(([k, v]) => ({ name: k, amount: v[0], count: v[1] }))
  };
}

function jstIsoNow() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00');
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return lib.sendJson(res, 405, { error: 'POST only' });
    if (!originAllowed(req)) return lib.sendJson(res, 403, { error: 'origin not allowed' });
    const { text: raw, total } = await readBody(req, MAX_CSV_BYTES).catch(() => ({ text: '', total: 0 }));
    if (total > MAX_CSV_BYTES) return lib.sendJson(res, 413, { error: 'CSVが大きすぎます' });
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return lib.sendJson(res, 400, { error: 'invalid JSON' }); }
    const mode = body.mode === 'commit' ? 'commit' : 'preview';
    const csv = String(body.csv || '');
    if (!csv) return lib.sendJson(res, 400, { error: 'csv is required' });
    const hash = crypto.createHash('sha256').update(csv, 'utf8').digest('hex');
    if (body.hash && body.hash !== hash) return lib.sendJson(res, 400, { error: 'hash mismatch' });

    let rows;
    try { rows = parsePaypayCsv(csv); } catch (e) { return lib.sendJson(res, 400, { error: String(e.message || e) }); }
    const agg = aggregatePaypay(rows);
    if (!agg) return lib.sendJson(res, 400, { error: '集計できる行がありません' });

    const store = await lib.fsGetJson(lib.PAYPAY_IMPORT_DOC, 'data', { datasets: [] });
    const datasets = Array.isArray(store.datasets) ? store.datasets : [];
    const already = datasets.some(d => d && d.hash === hash);

    const money = await lib.fsGetJson(lib.MONEY_DOC, 'money', null).catch(() => null);
    const before = money?.paypay || null;
    // 現在のスナップショットの期間より後から始まる CSV は「拡張」として即時合算できる
    const isExtension = !!(before && agg.periodFrom > before.periodTo);
    const after = isExtension ? mergeAggregates(before, agg) : null;

    const preview = {
      ok: true, mode, alreadyImported: already, rows: rows.length,
      payments: { count: agg.paymentCount, total: agg.totalPayments },
      periodFrom: agg.periodFrom, periodTo: agg.periodTo,
      before: before ? { paymentCount: before.paymentCount, totalPayments: before.totalPayments, periodFrom: before.periodFrom, periodTo: before.periodTo } : null,
      mergeMode: isExtension ? 'extension' : (before ? 'overlap' : 'fresh'),
      afterPreview: after ? { paymentCount: after.paymentCount, totalPayments: after.totalPayments, periodFrom: after.periodFrom, periodTo: after.periodTo } : null
    };
    if (mode === 'preview' || already) return lib.sendJson(res, 200, preview);

    // commit: データセットを保存（行は money.py が読む正規化形式）
    datasets.push({ hash, fileName: String(body.fileName || 'paypay.csv').slice(0, 120), importedAt: new Date().toISOString(), rows });
    await lib.fsSetJson(lib.PAYPAY_IMPORT_DOC, 'data', { datasets, updatedAt: new Date().toISOString() });

    let moneyUpdated = false;
    if (isExtension && money) {
      money.paypay = { ...after, snapshotAsOf: lib.todayJst() };
      money.updatedAt = jstIsoNow();
      await lib.fsSetJson(lib.MONEY_DOC, 'money', money);
      moneyUpdated = true;
    }
    return lib.sendJson(res, 200, { ...preview, committed: true, moneyUpdated });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 30 };
module.exports.helpers = { parseCsv, parsePaypayCsv, aggregatePaypay, mergeAggregates, originAllowed };
