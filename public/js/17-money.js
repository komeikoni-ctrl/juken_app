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
  pct: (part, total) => (total > 0 ? Math.round((Number(part) || 0) / total * 100) : 0),

  // ---- 家計簿（明細） ----
  // データのある月（'YYYY-MM'）を新しい順に返す
  kakeiboMonths: (data) => {
    const months = data?.kakeibo?.months;
    if (!months || typeof months !== 'object') return [];
    return Object.keys(months).filter(ym => Array.isArray(months[ym]) && months[ym].length).sort().reverse();
  },
  kakeiboList: (data, ym) => {
    const list = data?.kakeibo?.months?.[ym];
    return Array.isArray(list) ? list : [];
  },
  // 月の明細から支出・入金合計とカテゴリ別（支出のみ）内訳を作る
  kakeiboTotals: (list) => {
    let out = 0, inn = 0;
    const by = {};
    (Array.isArray(list) ? list : []).forEach(x => {
      const a = Number(x?.amount) || 0;
      if (x?.io === 'in') { inn += a; return; }
      out += a;
      const c = x?.cat || 'その他';
      by[c] = (by[c] || 0) + a;
    });
    const cats = Object.entries(by).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    return { out, inn, cats };
  }
};

// お金ページの再描画（キャッシュから）。サブタブ・家計簿の選択状態はメモリ上の変数だけが持ち、
// ここでは現在の状態のまま描き直す（データ再取得や再描画でタブ・月が勝手に初期状態へ戻らないように）。
const rerenderMoneyRoot = () => {
  const root = document.getElementById('money-root');
  const entry = MoneyFeed.cache.read();
  if (!root || !entry?.data) return;
  const tabsEl = document.getElementById('money-tabs');
  if (tabsEl) tabsEl.innerHTML = MoneyView.tabsHtml();
  root.innerHTML = MoneyView.html(entry.data);
  root.dataset.rendered = '1';
};

// サブタブの表示状態（メモリ上だけ。S・同期データ・localStorageには載せない）
const MoneyTab = {
  current: 'home',
  TABS: [
    { id: 'home', label: 'ホーム' },
    { id: 'accounts', label: '口座' },
    { id: 'securities', label: '証券' },
    { id: 'expenses', label: '支出' },
    { id: 'paypay', label: 'PayPay' },
    { id: 'kakeibo', label: '家計簿' }
  ],
  set: (id) => {
    if (!MoneyTab.TABS.some(t => t.id === id)) return;
    MoneyTab.current = id;
    rerenderMoneyRoot();
  }
};

// 家計簿の表示状態（メモリ上だけ。Sや同期データには載せない）
const MoneyKb = {
  ym: null,       // 選択中の月。null なら最新の月
  showAll: false, // 明細を全件出すか（初期は直近30件）
  setYm: (ym) => { MoneyKb.ym = ym; MoneyKb.showAll = false; MoneyKb.rerender(); },
  toggleAll: () => { MoneyKb.showAll = !MoneyKb.showAll; MoneyKb.rerender(); },
  rerender: () => rerenderMoneyRoot()
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
  const tabsEl = document.getElementById('money-tabs');
  if (tabsEl) tabsEl.innerHTML = MoneyView.tabsHtml();
  if (upd) {
    const t = data.updatedAt ? new Date(data.updatedAt) : null;
    upd.textContent = t && !isNaN(t)
      ? `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 時点（マネーフォワード ME・2時間おき自動更新）`
      : 'マネーフォワード ME・2時間おき自動更新';
  }
}

// サブタブバー。「更新」ボタンの行の下・最初のカードの上（index.html の #money-tabs）に出す
MoneyView.tabsHtml = () => {
  const cur = MoneyTab.current;
  const btn = (t) => `<button type="button" onclick="MoneyTab.set('${t.id}')" style="flex:none;padding:6px 14px;border-radius:999px;border:1px solid var(--border);font:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;${t.id === cur ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'background:transparent;color:var(--muted)'}">${t.label}</button>`;
  return `<div style="display:flex;gap:6px;overflow-x:auto;padding:2px 2px 4px;-webkit-overflow-scrolling:touch">${MoneyTab.TABS.map(btn).join('')}</div>`;
};

// セクションごとの描画（サブタブで切り分ける単位）。各セクションの中身は従来の全表示と同一
MoneyView.sections = (data) => {
  const total = Number(data.total) || 0;
  const cats = Array.isArray(data.categories) ? data.categories : [];
  const sec = MoneyFeed.securities(data);
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ms = MoneyFeed.monthSummary(data, curYm);
  const expTotal = ms ? MoneyFeed.sumValues(ms.expenses) : 0;
  const incTotal = ms ? MoneyFeed.sumValues(ms.income) : 0;
  const out = {};

  // ① 総資産
  out.total = `<div class="card" style="background:linear-gradient(145deg, rgba(10,132,255,.10), rgba(255,255,255,.05));border:1px solid rgba(10,132,255,.20)!important">
    <div class="card-hdr"><span class="card-hdr-title">💰 総資産</span><span class="badge bb" style="font-size:10px">マネーフォワード ME</span></div>
    <div style="font-size:34px;font-weight:900;letter-spacing:-1px">${MoneyView.yen(total)}</div>
    <div class="g${Math.min(3, Math.max(2, cats.length))}" style="margin-top:10px">${cats.map(c => `
      <div class="stat"><div class="stat-v" style="font-size:19px">${MoneyView.yen(c.amount)}</div><div class="stat-l">${esc(c.name)}（${MoneyFeed.pct(c.amount, total)}%）</div></div>`).join('')}
    </div>
  </div>`;

  // 口座別残高
  const accounts = [];
  cats.forEach(c => (c.accounts || []).forEach(a => accounts.push({ name: a.name, amount: a.amount, cat: c.name })));
  out.accounts = accounts.length
    ? `<div class="card"><div class="card-hdr"><span class="card-hdr-title">🏦 口座・資産ごと</span></div>` +
      accounts.map(a => MoneyView.row(a.name, a.cat, a.amount, MoneyFeed.pct(a.amount, total))).join('') + `</div>`
    : '';

  // ② 証券（楽天証券の保有銘柄）
  const inst = [...new Set(sec.list.map(x => x.institution_name).filter(Boolean))].join('・');
  out.securities = sec.list.length
    ? `<div class="card"><div class="card-hdr"><span class="card-hdr-title">📈 証券・投資信託</span>${inst ? `<span class="badge bb" style="font-size:10px">${esc(inst)}</span>` : ''}</div>` +
      sec.list.slice().sort((a, b) => (b.current_value || 0) - (a.current_value || 0))
        .map(x => MoneyView.row(x.name, x.asset_category || '', x.current_value, MoneyFeed.pct(x.current_value, sec.total), 'var(--a3)')).join('') +
      `<div class="row"><div class="row-title" style="font-size:12px;font-weight:700">合計</div><div style="font-size:14px;font-weight:800">${MoneyView.yen(sec.total)}</div></div></div>`
    : '';

  // ③ 今月の支出（カテゴリ別）
  const exps = ms ? (ms.expenses || []).slice().sort((a, b) => (b.value_in_jpy || 0) - (a.value_in_jpy || 0)) : [];
  out.expenses = ms
    ? `<div class="card"><div class="card-hdr"><span class="card-hdr-title">🧾 ${esc(MoneyView.ymLabel(ms.month))}の支出</span><span class="muted" style="font-size:11px">収入 ${MoneyView.yen(incTotal)}</span></div>
      <div style="font-size:22px;font-weight:900;margin-bottom:6px">${MoneyView.yen(expTotal)}</div>` +
      (exps.length ? exps.map(e => MoneyView.row(e.category_name, '', e.value_in_jpy, MoneyFeed.pct(e.value_in_jpy, expTotal), 'var(--a2)')).join('')
                    : '<div class="empty">この月の支出はまだありません</div>') +
      `<div class="muted" style="font-size:11px;margin-top:8px">銀行・証券の連携分（マネーフォワード ME のカテゴリ集計）。PayPay払いは下の PayPay 欄を見てください。</div></div>`
    : '';

  // ④ 家計簿（月別の明細）
  const kbMonths = MoneyFeed.kakeiboMonths(data);
  const selYm = (MoneyKb.ym && kbMonths.includes(MoneyKb.ym)) ? MoneyKb.ym : kbMonths[0];
  const list = MoneyFeed.kakeiboList(data, selYm);
  const tot = MoneyFeed.kakeiboTotals(list);
  const shown = MoneyKb.showAll ? list : list.slice(0, 30);
  const chips = kbMonths.map(ym =>
    `<button type="button" onclick="MoneyKb.setYm('${ym}')" style="padding:5px 12px;border-radius:999px;border:1px solid var(--border);font:inherit;font-size:12px;font-weight:700;cursor:pointer;${ym === selYm ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'background:transparent;color:var(--muted)'}">${esc(MoneyView.ymLabel(ym))}</button>`).join('');
  const rowHtml = (x) => {
    const isIn = x.io === 'in';
    const d = String(x.date || '');
    const md = /^\d{4}-(\d{2})-(\d{2})$/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d;
    return `<div class="row" style="align-items:flex-start">
      <div class="muted" style="font-size:11px;flex:none;width:34px;padding-top:2px">${esc(md)}</div>
      <div class="row-title" style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.title || '')}</div>
        <div class="muted" style="font-size:11px">${esc(x.cat || 'その他')}${x.src ? ` ・ ${esc(x.src)}` : ''}</div>
      </div>
      <div style="text-align:right;flex:none;margin-left:8px;font-size:13px;font-weight:800;color:${isIn ? 'var(--a3)' : 'inherit'}">${isIn ? '+' : '-'}${MoneyView.yen(x.amount).replace('-', '')}</div>
    </div>`;
  };
  out.kakeibo = kbMonths.length
    ? `<div class="card"><div class="card-hdr"><span class="card-hdr-title">📒 家計簿</span><span class="muted" style="font-size:11px">${list.length}件</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chips}</div>
      <div class="g2" style="margin-bottom:6px">
        <div class="stat"><div class="stat-v" style="font-size:19px">${MoneyView.yen(tot.out)}</div><div class="stat-l">支出</div></div>
        <div class="stat"><div class="stat-v" style="font-size:19px;color:var(--a3)">${MoneyView.yen(tot.inn)}</div><div class="stat-l">入金</div></div>
      </div>` +
      (tot.cats.length ? tot.cats.slice(0, 6).map(c => MoneyView.row(c.name, '', c.amount, MoneyFeed.pct(c.amount, tot.out), 'var(--a2)')).join('') : '') +
      `<div style="font-size:12px;font-weight:700;margin:12px 0 2px">明細（新しい順）</div>` +
      (shown.length ? shown.map(rowHtml).join('') : '<div class="empty">この月の明細はまだありません</div>') +
      (list.length > 30 ? `<button type="button" class="btn ghost" style="width:100%;margin-top:8px" onclick="MoneyKb.toggleAll()">${MoneyKb.showAll ? '直近30件だけ見る' : `ぜんぶ見る（${list.length}件）`}</button>` : '') +
      `<div class="muted" style="font-size:11px;margin-top:8px">銀行（楽天銀行・PayPay銀行）の明細と PayPay の支払い・送金を合わせたものです。PayPayへのチャージは、二重に数えないため明細に入れていません。</div></div>`
    : '';

  // ⑤ PayPay（CSVスナップショット）
  const pp = data.paypay;
  const ppMonths = (pp && Array.isArray(pp.monthlyPayments)) ? pp.monthlyPayments.slice(-6) : [];
  const ppMax = ppMonths.length ? Math.max(...ppMonths.map(m => m.amount), 1) : 1;
  out.paypay = ppMonths.length
    ? `<div class="card"><div class="card-hdr"><span class="card-hdr-title">📱 PayPay の支払い</span><span class="badge" style="font-size:10px">CSVスナップショット</span></div>` +
      ppMonths.map(m => MoneyView.row(MoneyView.ymLabel(m.month), `${m.count}件`, m.amount, Math.round(m.amount / ppMax * 100), 'var(--pur)')).join('') +
      `<div style="font-size:12px;font-weight:700;margin:12px 0 4px">よく使う店（全期間）</div>` +
      (pp.topMerchants || []).map(t => MoneyView.row(t.name, `${t.count}件`, t.amount, null)).join('') +
      `<div class="muted" style="font-size:11px;margin-top:8px">対象期間 ${esc(pp.periodFrom || '')} 〜 ${esc(pp.periodTo || '')}・全期間の支払い合計 ${MoneyView.yen(pp.totalPayments)}（${pp.paymentCount}件）。PayPayは自動連携が無いため、この欄は取引履歴CSVを取り込んだ時点のスナップショットです（自動更新されません）。</div></div>`
    : '';

  return out;
};

// サブタブに応じた全体描画。tab を省略すると現在のタブ（MoneyTab.current）で描くので、
// データ再取得・再描画のたびにホームへ戻ることはない。
// ホームは従来通り全セクションをこの順で並べる: 総資産→口座・資産ごと→証券→今月の支出→家計簿→PayPay
MoneyView.html = (data, tab) => {
  const s = MoneyView.sections(data);
  const cur = MoneyTab.TABS.some(t => t.id === tab) ? tab : MoneyTab.current;
  const order = {
    home: ['total', 'accounts', 'securities', 'expenses', 'kakeibo', 'paypay'],
    accounts: ['total', 'accounts'],
    securities: ['securities'],
    expenses: ['expenses'],
    paypay: ['paypay'],
    kakeibo: ['kakeibo']
  }[cur] || ['total', 'accounts', 'securities', 'expenses', 'kakeibo', 'paypay'];
  const body = order.map(k => s[k]).join('');
  return body || '<div class="card"><div class="empty">データがまだありません</div></div>';
};
