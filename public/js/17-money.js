// ============================================================
// お金タブ — マネーフォワード ME の残高・証券・支出と PayPay の履歴を表示する
// データは Firestore の live/money ドキュメント（チェッカーが2時間おきに書き込み、
// アプリは読むだけ）。状態 S や jukenAppData2027 には絶対に載せない（同期対象外）。
// キャッシュは専用キー jukenMoney2027 だけに置く。
// どの取得が失敗しても例外を外に出さず、アプリ本体の起動・描画は止めない。
// ============================================================

const MONEY_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/money';
const MONEY_CACHE_KEY = 'jukenMoney2027';
const MONEY_MAX_AGE_MS = 30 * 60 * 1000; // アプリ内キャッシュの鮮度（中継側の更新は2時間おき）

const MoneyFeed = {
  cache: {
    read: () => {
      try {
        const o = JSON.parse(localStorage.getItem(MONEY_CACHE_KEY) || 'null');
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
      } catch (e) { return null; }
    },
    write: (entry) => {
      try { localStorage.setItem(MONEY_CACHE_KEY, JSON.stringify(entry)); }
      catch (e) { console.warn('[money] キャッシュ保存に失敗', e); }
    }
  },

  // Firestore REST のドキュメント → お金データ。形が違えば null（推測で補わない）
  _parseDoc: (raw) => {
    try {
      const s = raw?.fields?.money?.stringValue;
      if (!s) return null;
      const d = JSON.parse(s);
      if (!d || typeof d !== 'object' || typeof d.total !== 'number') return null;
      if (!Array.isArray(d.categories) || !Array.isArray(d.holdings)) return null;
      return d;
    } catch (e) { return null; }
  },

  _fetch: async () => {
    const raw = (typeof LiveFeed !== 'undefined' && LiveFeed.fetchJson)
      ? await LiveFeed.fetchJson(MONEY_DOC_URL)
      : null;
    if (raw == null) {
      try {
        const res = await fetch(MONEY_DOC_URL, { cache: 'no-store' });
        if (!res.ok) return null;
        return MoneyFeed._parseDoc(await res.json());
      } catch (e) { return null; }
    }
    return MoneyFeed._parseDoc(raw);
  },

  _inflight: null,
  // キャッシュが新しければそれを返し裏で再取得。古ければ取得を待ち、失敗時は古いキャッシュを返す
  get: async () => {
    const entry = MoneyFeed.cache.read();
    if (entry && Date.now() - (entry.fetchedAt || 0) < MONEY_MAX_AGE_MS) {
      MoneyFeed._refresh();
      return entry.data || null;
    }
    const fresh = await MoneyFeed._refresh();
    if (fresh != null) return fresh;
    return entry ? (entry.data || null) : null;
  },
  _refresh: () => {
    if (MoneyFeed._inflight) return MoneyFeed._inflight;
    const p = (async () => {
      try {
        const data = await MoneyFeed._fetch();
        if (data == null) return null;
        MoneyFeed.cache.write({ data, fetchedAt: Date.now() });
        return data;
      } catch (e) { return null; }
      finally { MoneyFeed._inflight = null; }
    })();
    MoneyFeed._inflight = p;
    return p;
  },

  // ---- 集計（テストから呼べる純粋関数） ----
  // 証券（預金以外の保有）を機関ごとにまとめる
  securities: (data) => {
    const list = (data?.holdings || []).filter(h => h && h.asset_category !== '普通預金');
    const total = list.reduce((s, h) => s + (Number(h.current_value) || 0), 0);
    return { list, total };
  },
  // 指定月（'YYYY-MM'）の集計。無ければ最新の月を返す。どちらも無ければ null
  monthSummary: (data, ym) => {
    const list = Array.isArray(data?.summaries) ? data.summaries : [];
    if (!list.length) return null;
    return list.find(s => s.month === ym) || list[list.length - 1];
  },
  sumValues: (arr) => (Array.isArray(arr) ? arr : []).reduce((s, x) => s + (Number(x?.value_in_jpy) || 0), 0),
  pct: (part, total) => (total > 0 ? Math.round((Number(part) || 0) / total * 100) : 0)
};

const MoneyView = {
  yen: (n) => {
    const v = Number(n) || 0;
    return (v < 0 ? '-¥' : '¥') + Math.abs(v).toLocaleString('ja-JP');
  },
  ymLabel: (ym) => {
    const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    return m ? `${m[1]}年${Number(m[2])}月` : String(ym || '');
  },
  bar: (pct, color) => `<div style="height:6px;border-radius:3px;background:var(--border);overflow:hidden;margin-top:4px"><div style="height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${color || 'var(--accent)'};border-radius:3px"></div></div>`,
  row: (title, sub, amount, pct, color) => `
    <div class="row" style="align-items:flex-start">
      <div class="row-title" style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(title)}</div>
        ${sub ? `<div class="muted" style="font-size:11px">${esc(sub)}</div>` : ''}
        ${pct != null ? MoneyView.bar(pct, color) : ''}
      </div>
      <div style="text-align:right;flex:none;margin-left:10px">
        <div style="font-size:14px;font-weight:800">${MoneyView.yen(amount)}</div>
        ${pct != null ? `<div class="muted" style="font-size:11px">${pct}%</div>` : ''}
      </div>
    </div>`
};

// お金ページの描画。showPage('money') から呼ばれる。force=true でキャッシュを待たず再取得する
async function renderMoney(force) {
  const root = document.getElementById('money-root');
  const upd = document.getElementById('money-updated');
  if (!root) return;
  const cached = MoneyFeed.cache.read();
  if (!root.dataset.rendered) {
    root.innerHTML = cached?.data
      ? MoneyView.html(cached.data)
      : '<div class="card"><div class="empty">お金のデータを読み込み中…</div></div>';
  }
  const data = force ? (await MoneyFeed._refresh()) || (cached?.data || null) : await MoneyFeed.get();
  if (!data) {
    if (!cached?.data) root.innerHTML = '<div class="card"><div class="empty">お金のデータを取得できませんでした。通信環境を確認して、もう一度お金タブを開いてください。</div></div>';
    return;
  }
  root.innerHTML = MoneyView.html(data);
  root.dataset.rendered = '1';
  if (upd) {
    const t = data.updatedAt ? new Date(data.updatedAt) : null;
    upd.textContent = t && !isNaN(t)
      ? `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 時点（マネーフォワード ME・2時間おき自動更新）`
      : 'マネーフォワード ME・2時間おき自動更新';
  }
}

MoneyView.html = (data) => {
  const total = Number(data.total) || 0;
  const cats = Array.isArray(data.categories) ? data.categories : [];
  const sec = MoneyFeed.securities(data);
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ms = MoneyFeed.monthSummary(data, curYm);
  const expTotal = ms ? MoneyFeed.sumValues(ms.expenses) : 0;
  const incTotal = ms ? MoneyFeed.sumValues(ms.income) : 0;

  let h = '';

  // ① 総資産
  h += `<div class="card" style="background:linear-gradient(145deg, rgba(10,132,255,.10), rgba(255,255,255,.05));border:1px solid rgba(10,132,255,.20)!important">
    <div class="card-hdr"><span class="card-hdr-title">💰 総資産</span><span class="badge bb" style="font-size:10px">マネーフォワード ME</span></div>
    <div style="font-size:34px;font-weight:900;letter-spacing:-1px">${MoneyView.yen(total)}</div>
    <div class="g${Math.min(3, Math.max(2, cats.length))}" style="margin-top:10px">${cats.map(c => `
      <div class="stat"><div class="stat-v" style="font-size:19px">${MoneyView.yen(c.amount)}</div><div class="stat-l">${esc(c.name)}（${MoneyFeed.pct(c.amount, total)}%）</div></div>`).join('')}
    </div>
  </div>`;

  // 口座別残高
  const accounts = [];
  cats.forEach(c => (c.accounts || []).forEach(a => accounts.push({ name: a.name, amount: a.amount, cat: c.name })));
  if (accounts.length) {
    h += `<div class="card"><div class="card-hdr"><span class="card-hdr-title">🏦 口座・資産ごと</span></div>` +
      accounts.map(a => MoneyView.row(a.name, a.cat, a.amount, MoneyFeed.pct(a.amount, total))).join('') + `</div>`;
  }

  // ② 証券（楽天証券の保有銘柄）
  if (sec.list.length) {
    const inst = [...new Set(sec.list.map(x => x.institution_name).filter(Boolean))].join('・');
    h += `<div class="card"><div class="card-hdr"><span class="card-hdr-title">📈 証券・投資信託</span>${inst ? `<span class="badge bb" style="font-size:10px">${esc(inst)}</span>` : ''}</div>` +
      sec.list.slice().sort((a, b) => (b.current_value || 0) - (a.current_value || 0))
        .map(x => MoneyView.row(x.name, x.asset_category || '', x.current_value, MoneyFeed.pct(x.current_value, sec.total), 'var(--a3)')).join('') +
      `<div class="row"><div class="row-title" style="font-size:12px;font-weight:700">合計</div><div style="font-size:14px;font-weight:800">${MoneyView.yen(sec.total)}</div></div></div>`;
  }

  // ③ 今月の支出（カテゴリ別）
  if (ms) {
    const exps = (ms.expenses || []).slice().sort((a, b) => (b.value_in_jpy || 0) - (a.value_in_jpy || 0));
    h += `<div class="card"><div class="card-hdr"><span class="card-hdr-title">🧾 ${esc(MoneyView.ymLabel(ms.month))}の支出</span><span class="muted" style="font-size:11px">収入 ${MoneyView.yen(incTotal)}</span></div>
      <div style="font-size:22px;font-weight:900;margin-bottom:6px">${MoneyView.yen(expTotal)}</div>` +
      (exps.length ? exps.map(e => MoneyView.row(e.category_name, '', e.value_in_jpy, MoneyFeed.pct(e.value_in_jpy, expTotal), 'var(--a2)')).join('')
                    : '<div class="empty">この月の支出はまだありません</div>') +
      `<div class="muted" style="font-size:11px;margin-top:8px">銀行・証券の連携分（マネーフォワード ME のカテゴリ集計）。PayPay払いは下の PayPay 欄を見てください。</div></div>`;
  }

  // ④ PayPay（CSVスナップショット）
  const pp = data.paypay;
  if (pp && Array.isArray(pp.monthlyPayments) && pp.monthlyPayments.length) {
    const months = pp.monthlyPayments.slice(-6);
    const max = Math.max(...months.map(m => m.amount), 1);
    h += `<div class="card"><div class="card-hdr"><span class="card-hdr-title">📱 PayPay の支払い</span><span class="badge" style="font-size:10px">CSVスナップショット</span></div>` +
      months.map(m => MoneyView.row(MoneyView.ymLabel(m.month), `${m.count}件`, m.amount, Math.round(m.amount / max * 100), 'var(--pur)')).join('') +
      `<div style="font-size:12px;font-weight:700;margin:12px 0 4px">よく使う店（全期間）</div>` +
      (pp.topMerchants || []).map(t => MoneyView.row(t.name, `${t.count}件`, t.amount, null)).join('') +
      `<div class="muted" style="font-size:11px;margin-top:8px">対象期間 ${esc(pp.periodFrom || '')} 〜 ${esc(pp.periodTo || '')}・全期間の支払い合計 ${MoneyView.yen(pp.totalPayments)}（${pp.paymentCount}件）。PayPayは自動連携が無いため、この欄は取引履歴CSVを取り込んだ時点のスナップショットです（自動更新されません）。</div></div>`;
  }

  return h;
};
