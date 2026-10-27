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
  // 月別サマリのある月（'YYYY-MM'）を新しい順に返す（支出セクションの月切替用）
  summaryMonths: (data) => {
    const list = Array.isArray(data?.summaries) ? data.summaries : [];
    return [...new Set(list.map(s => s?.month).filter(Boolean))].sort().reverse();
  },
  sumValues: (arr) => (Array.isArray(arr) ? arr : []).reduce((s, x) => s + (Number(x?.value_in_jpy) || 0), 0),
  pct: (part, total) => (total > 0 ? Math.round((Number(part) || 0) / total * 100) : 0),

  // ---- 家計簿（明細） ----
  // データのある月（'YYYY-MM'）を新しい順に返す。明細が要約に置き換わった月
  // （kakeibo.monthlySummary にだけある月）も含める
  kakeiboMonths: (data) => {
    const months = data?.kakeibo?.months;
    const detailed = (months && typeof months === 'object')
      ? Object.keys(months).filter(ym => Array.isArray(months[ym]) && months[ym].length) : [];
    const summed = (data?.kakeibo?.monthlySummary && typeof data.kakeibo.monthlySummary === 'object')
      ? Object.keys(data.kakeibo.monthlySummary) : [];
    return [...new Set([...detailed, ...summed])].sort().reverse();
  },
  // 要約だけの月の集計 {count,out,in,cats:[{name,amount}]}。明細がある月は null
  kakeiboMonthSummary: (data, ym) => data?.kakeibo?.monthlySummary?.[ym] || null,
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
  },
  // 支出の前月比: 月別サマリから選択月の前暦月の合計を取り、差額と増減率を返す。
  // 前月のサマリが無い月は null（表示しない）
  prevMonthCompare: (data, ym) => {
    const list = Array.isArray(data?.summaries) ? data.summaries : [];
    const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const prevDate = new Date(Number(m[1]), Number(m[2]) - 2, 1);
    const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prev = list.find(x => x.month === prevYm);
    const cur = list.find(x => x.month === ym);
    if (!prev || !cur) return null;
    const prevTotal = MoneyFeed.sumValues(prev.expenses);
    const curTotal = MoneyFeed.sumValues(cur.expenses);
    const diff = curTotal - prevTotal;
    const pct = prevTotal > 0 ? Math.round(diff / prevTotal * 100) : null;
    return { prevYm, prevTotal, curTotal, diff, pct };
  },
  // 家計簿の検索（タイトル部分一致・大小文字区別なし）と出所フィルタ
  kakeiboFilter: (list, query, src) => {
    const q = String(query || '').trim().toLowerCase();
    return (Array.isArray(list) ? list : []).filter(x => {
      if (src && src !== 'all' && x?.src !== src) return false;
      if (q && !String(x?.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
  },
  // データに実在する出所の一覧（出現順）。フィルタの select に出す候補
  kakeiboSources: (list) => {
    const seen = [];
    (Array.isArray(list) ? list : []).forEach(x => { if (x?.src && !seen.includes(x.src)) seen.push(x.src); });
    return seen;
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
  MoneyUi.syncBtn();
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
    { id: 'kakeibo', label: '家計簿' },
    { id: 'subs', label: 'サブスク' },
    { id: 'report', label: '月次レポート' }
  ],
  set: (id) => {
    if (!MoneyTab.TABS.some(t => t.id === id)) return;
    MoneyTab.current = id;
    rerenderMoneyRoot();
  }
};

// 支出セクションの表示状態（メモリ上だけ。Sや同期データには載せない）
const MoneyExp = {
  ym: null,       // 選択中の月。null なら今月（無ければ最新の月）
  _months: [],    // 直近の描画で使った月一覧（新しい順）。‹ › ボタンの移動先を決めるために持つ
  setYm: (ym) => { MoneyExp.ym = ym; rerenderMoneyRoot(); },
  // d=-1: 前の月（古い方） / d=+1: 次の月（新しい方）。カレンダーの chMonth と同じ向き。
  // 月一覧は新しい順なので、古い月は添字+1・新しい月は添字-1。端では動かない
  stepYm: (d) => {
    const months = MoneyExp._months || [];
    if (months.length < 2) return;
    const now = new Date();
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cur = (MoneyExp.ym && months.includes(MoneyExp.ym)) ? MoneyExp.ym
      : (months.includes(curYm) ? curYm : months[0]);
    const target = months[months.indexOf(cur) - d];
    if (target && target !== cur) MoneyExp.setYm(target);
  }
};

// 家計簿の表示状態（メモリ上だけ。Sや同期データには載せない）
const MoneyKb = {
  ym: null,       // 選択中の月。null なら最新の月
  showAll: false, // 明細を全件出すか（初期は直近30件）
  query: '',      // 検索文字列（タイトル部分一致）
  src: 'all',     // 出所フィルタ（'all' か実在する出所名）
  setQuery: (v) => {
    MoneyKb.query = String(v || '');
    rerenderMoneyRoot();
    // 再描画で入力欄が作り直されるので、フォーカスとカーソル位置を戻す
    const el = document.getElementById('kb-search');
    if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
  },
  setSrc: (v) => { MoneyKb.src = String(v || 'all'); rerenderMoneyRoot(); },
  clearFilter: () => { MoneyKb.query = ''; MoneyKb.src = 'all'; rerenderMoneyRoot(); },
  _months: [],    // 直近の描画で使った月一覧（新しい順）。‹ › ボタンの移動先を決めるために持つ
  setYm: (ym) => { MoneyKb.ym = ym; MoneyKb.showAll = false; MoneyKb.rerender(); },
  // d=-1: 前の月（古い方） / d=+1: 次の月（新しい方）
  stepYm: (d) => {
    const months = MoneyKb._months || [];
    if (months.length < 2) return;
    const cur = (MoneyKb.ym && months.includes(MoneyKb.ym)) ? MoneyKb.ym : months[0];
    const target = months[months.indexOf(cur) - d];
    if (target && target !== cur) MoneyKb.setYm(target);
  },
  toggleAll: () => { MoneyKb.showAll = !MoneyKb.showAll; MoneyKb.rerender(); },
  rerender: () => rerenderMoneyRoot()
};

// 金額の表示/非表示（端末ローカルのUI設定だけ。S・Firestore・同期には絶対に載せない）。
// マスクは描画時に MoneyView.yen を通すことで一元化する（全セクションが yen 経由）。
const MONEY_UI_KEY = 'jukenMoneyUi';
const MoneyUi = {
  masked: (() => { try { return JSON.parse(localStorage.getItem(MONEY_UI_KEY) || '{}')?.masked === true; } catch (e) { return false; } })(),
  toggle: () => {
    MoneyUi.masked = !MoneyUi.masked;
    try { localStorage.setItem(MONEY_UI_KEY, JSON.stringify({ masked: MoneyUi.masked })); } catch (e) {}
    MoneyUi.syncBtn();
    rerenderMoneyRoot();
  },
  syncBtn: () => {
    const b = document.getElementById('money-mask-btn');
    if (!b) return;
    b.textContent = MoneyUi.masked ? '🙈 金額オフ' : '👁 金額オン';
    b.setAttribute('aria-pressed', MoneyUi.masked ? 'true' : 'false');
    b.title = MoneyUi.masked ? '金額は隠れています。押すと表示します' : '金額を表示中です。押すと隠します';
  }
};

const MoneyView = {
  yen: (n) => {
    if (typeof MoneyUi !== 'undefined' && MoneyUi.masked) return '¥•••';
    const v = Number(n) || 0;
    return (v < 0 ? '-¥' : '¥') + Math.abs(v).toLocaleString('ja-JP');
  },
  // 符号つき金額（前月比用）。マスク時は符号も出さない
  signedYen: (n) => {
    if (typeof MoneyUi !== 'undefined' && MoneyUi.masked) return '¥•••';
    const v = Number(n) || 0;
    return (v > 0 ? '+' : v < 0 ? '-' : '') + '¥' + Math.abs(v).toLocaleString('ja-JP');
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
  MoneySubs.ensureSeed();
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
  MoneyUi.syncBtn();
  if (upd) {
    const t = data.updatedAt ? new Date(data.updatedAt) : null;
    upd.textContent = t && !isNaN(t)
      ? `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 時点（マネーフォワード ME・2時間おき自動更新）`
      : 'マネーフォワード ME・2時間おき自動更新';
  }
}

// ページ内切替ボタンの標準パターン（07-timer-calendar.js の模試表タブと同じ
// .btn btn-sm + アクティブは btn-p / 非アクティブは btn-s）。アプリ共通のボタン
// デザインに乗るので、通常・ダーク・ポップの全スタイルで見た目が揃う。
MoneyView.chipBtn = (label, onclick, active) =>
  `<button type="button" class="btn btn-sm ${active ? 'btn-p' : 'btn-s'}" onclick="${onclick}" style="font-size:12px;padding:6px 14px">${esc(label)}</button>`;
MoneyView.chipRow = (inner) =>
  `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${inner}</div>`;

// 月移動バー（支出・家計簿で共用する1行の部品）: [‹] [月のプルダウン] [›]
// 月チップを全月並べると縦に長くなるため置き換えた。プルダウンはデータのある月を
// 新しい順に並べ、遠くの月へも一発で飛べる。‹ › は隣の月へ移動し、端では disabled。
// handler は状態オブジェクトの名前（'MoneyExp' / 'MoneyKb'）で、どちらも
// setYm(ym) / stepYm(d) を持つ。見た目は .btn btn-sm btn-s とフォーム select の標準形。
MoneyView.monthBar = (months, current, handler) => {
  if (!Array.isArray(months) || months.length < 2) return '';
  const idx = months.indexOf(current);
  const prevDisabled = (idx < 0 || idx >= months.length - 1) ? ' disabled' : ''; // 古い方に月が無い
  const nextDisabled = idx <= 0 ? ' disabled' : '';                              // 新しい方に月が無い
  const opts = months.map(ym =>
    `<option value="${ym}"${ym === current ? ' selected' : ''}>${esc(MoneyView.ymLabel(ym))}</option>`).join('');
  return `<div class="money-monthbar" style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
    <button type="button" class="btn btn-sm btn-s" onclick="${handler}.stepYm(-1)" aria-label="前の月"${prevDisabled} style="font-size:13px;padding:6px 13px">‹</button>
    <select onchange="${handler}.setYm(this.value)" aria-label="月を選ぶ" style="flex:1;min-width:0;width:auto;margin:0;padding:6px 10px;font-size:13px">${opts}</select>
    <button type="button" class="btn btn-sm btn-s" onclick="${handler}.stepYm(1)" aria-label="次の月"${nextDisabled} style="font-size:13px;padding:6px 13px">›</button>
  </div>`;
};

// サブタブバー。「更新」ボタンの行の下・最初のカードの上（index.html の #money-tabs）に出す。
// 見た目はセグメントコントロール（連結した一体型の切替）: トラックの描画は CSS の .seg-row が担い、
// ボタン自体は従来どおり .btn btn-sm（アクティブ btn-p / 非アクティブ btn-s）のままにする。
MoneyView.tabsHtml = () => {
  const cur = MoneyTab.current;
  const btn = (t) => MoneyView.chipBtn(t.label, `MoneyTab.set('${t.id}')`, t.id === cur);
  return `<div class="seg-row" role="tablist">${MoneyTab.TABS.map(btn).join('')}</div>`;
};


// ============================================================
// サブスク管理（お金ページのサブタブ）
// マスタデータは同期データ S.moneySubs（プロフィール側）に持つ。live/money（表示専用の
// ライブデータ）とは混ぜない。形: { seeded:true, items:[{id,name,amount,cycle,nextDate,memo}] }
// cycle は 'month'（月額）か 'year'（年額）。nextDate は 'YYYY-MM-DD' か ''（不明）。
// ============================================================
const MoneySubs = {
  seedItems: () => ([
    { id: generateId(), name: 'Muse Power', amount: 3499, cycle: 'month', nextDate: '', memo: '' },
    { id: generateId(), name: 'Claude Pro', amount: 3000, cycle: 'month', nextDate: '', memo: '約3,000円' },
    { id: generateId(), name: 'Google AI Pro', amount: 2900, cycle: 'month', nextDate: '', memo: '2026-11-21から Google AI Plus ¥1,450/月に変更予定' }
  ]),
  // S.moneySubs が未定義（null）のときだけ1回だけ初期投入する。投入済みの印（seeded）を
  // 同じデータ内に持つので、項目を全部削除しても初期データが復活することはない
  ensureSeed: (persist = true) => {
    if (typeof S === 'undefined' || S.moneySubs != null) return false;
    S.moneySubs = { seeded: true, items: MoneySubs.seedItems() };
    if (persist) MoneySubs.persist();
    return true;
  },
  items: () => (typeof S !== 'undefined' && S.moneySubs && Array.isArray(S.moneySubs.items)) ? S.moneySubs.items : [],
  persist: () => {
    try { if (typeof lsSave === 'function') lsSave(); } catch (e) {}
    try { if (typeof DbService !== 'undefined' && DbService.setMainProfile) DbService.setMainProfile(); } catch (e) {}
  },
  _normalize: (item) => ({
    name: String(item?.name || '').trim(),
    amount: Math.max(0, Math.round(Number(item?.amount) || 0)),
    cycle: item?.cycle === 'year' ? 'year' : 'month',
    nextDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.nextDate || '')) ? String(item.nextDate) : '',
    memo: String(item?.memo || '')
  }),
  add: (item, persist = true) => {
    MoneySubs.ensureSeed(false);
    if (!S.moneySubs || typeof S.moneySubs !== 'object') S.moneySubs = { seeded: true, items: [] };
    if (!Array.isArray(S.moneySubs.items)) S.moneySubs.items = [];
    const it = { id: generateId(), ...MoneySubs._normalize(item) };
    S.moneySubs.items.push(it);
    if (persist) MoneySubs.persist();
    return it;
  },
  update: (id, item, persist = true) => {
    const it = MoneySubs.items().find(x => x.id === id);
    if (!it) return false;
    Object.assign(it, MoneySubs._normalize(item));
    if (persist) MoneySubs.persist();
    return true;
  },
  remove: (id, persist = true) => {
    if (!S.moneySubs || !Array.isArray(S.moneySubs.items)) return false;
    const before = S.moneySubs.items.length;
    S.moneySubs.items = S.moneySubs.items.filter(x => x.id !== id);
    if (persist) MoneySubs.persist();
    return S.moneySubs.items.length !== before;
  },
  // 月額換算・年額換算の合計
  totals: (items) => {
    let monthly = 0, yearly = 0;
    (Array.isArray(items) ? items : []).forEach(x => {
      const a = Number(x?.amount) || 0;
      if (x?.cycle === 'year') { monthly += a / 12; yearly += a; }
      else { monthly += a; yearly += a * 12; }
    });
    return { monthlyEq: Math.round(monthly), yearlyEq: Math.round(yearly) };
  },
  // ---- フォーム（モーダル mo-sub） ----
  editingId: null,
  _fill: (item) => {
    document.getElementById('sub-name').value = item?.name || '';
    document.getElementById('sub-amount').value = item?.amount ?? '';
    document.getElementById('sub-cycle').value = item?.cycle === 'year' ? 'year' : 'month';
    document.getElementById('sub-next').value = item?.nextDate || '';
    document.getElementById('sub-memo').value = item?.memo || '';
    document.getElementById('sub-form-title').textContent = MoneySubs.editingId ? '✏️ サブスクを編集' : '➕ サブスクを追加';
  },
  openNew: (prefill) => { MoneySubs.editingId = null; MoneySubs._fill(prefill || null); showMo('mo-sub'); },
  openEdit: (id) => {
    const it = MoneySubs.items().find(x => x.id === id);
    if (!it) return;
    MoneySubs.editingId = id;
    MoneySubs._fill(it);
    showMo('mo-sub');
  },
  saveFromForm: () => {
    const item = {
      name: document.getElementById('sub-name').value,
      amount: document.getElementById('sub-amount').value,
      cycle: document.getElementById('sub-cycle').value,
      nextDate: document.getElementById('sub-next').value,
      memo: document.getElementById('sub-memo').value
    };
    if (!item.name.trim() || !(Number(item.amount) > 0)) { showToast('名前と金額（0より大きい額）を入力してください', 'error'); return; }
    if (MoneySubs.editingId) MoneySubs.update(MoneySubs.editingId, item);
    else MoneySubs.add(item);
    MoneySubs.editingId = null;
    closeMo('mo-sub');
    rerenderMoneyRoot();
    showToast('サブスクを保存しました');
  },
  askRemove: (id) => {
    const it = MoneySubs.items().find(x => x.id === id);
    if (!it) return;
    showConfirm('サブスクを削除', `「${it.name}」を削除しますか？`, '削除する', () => { MoneySubs.remove(id); rerenderMoneyRoot(); });
  }
};

// セクションごとの描画（サブタブで切り分ける単位）。各セクションの中身は従来の全表示と同一
MoneyView.sections = (data) => {
  const total = Number(data.total) || 0;
  const cats = Array.isArray(data.categories) ? data.categories : [];
  const sec = MoneyFeed.securities(data);
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // 支出セクションの選択月（MoneyExp.ym が月別サマリにあればそれ、無ければ今月→最新月）
  const sumMonths = MoneyFeed.summaryMonths(data);
  MoneyExp._months = sumMonths;
  const selExpYm = (MoneyExp.ym && sumMonths.includes(MoneyExp.ym)) ? MoneyExp.ym : curYm;
  const ms = MoneyFeed.monthSummary(data, selExpYm);
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

  // ③ 支出（カテゴリ別・月切替つき）
  const exps = ms ? (ms.expenses || []).slice().sort((a, b) => (b.value_in_jpy || 0) - (a.value_in_jpy || 0)) : [];
  const expBar = ms ? MoneyView.monthBar(sumMonths, ms.month, 'MoneyExp') : '';
  out.expenses = ms
    ? `<div class="card"><div class="card-hdr"><span class="card-hdr-title">🧾 ${esc(MoneyView.ymLabel(ms.month))}の支出</span><span class="muted" style="font-size:11px">収入 ${MoneyView.yen(incTotal)}</span></div>
      ${expBar}<div style="font-size:22px;font-weight:900;margin-bottom:6px">${MoneyView.yen(expTotal)}${(() => { const c = MoneyFeed.prevMonthCompare(data, ms.month); return c ? ` <span class="muted" style="font-size:12px;font-weight:600">前月比 ${MoneyView.signedYen(c.diff)}${c.pct != null ? `（${c.pct > 0 ? '+' : ''}${c.pct}%）` : ''}</span>` : ''; })()}</div>` +
      (exps.length ? exps.map(e => MoneyView.row(e.category_name, '', e.value_in_jpy, MoneyFeed.pct(e.value_in_jpy, expTotal), 'var(--a2)')).join('')
                    : '<div class="empty">この月の支出はまだありません</div>') +
      `<div class="muted" style="font-size:11px;margin-top:8px">銀行・証券の連携分（マネーフォワード ME のカテゴリ集計）。PayPay払いは下の PayPay 欄を見てください。</div></div>`
    : '';

  // ④ 家計簿（月別の明細）
  const kbMonths = MoneyFeed.kakeiboMonths(data);
  MoneyKb._months = kbMonths;
  const selYm = (MoneyKb.ym && kbMonths.includes(MoneyKb.ym)) ? MoneyKb.ym : kbMonths[0];
  const list = MoneyFeed.kakeiboList(data, selYm);
  // 明細が要約に置き換わった月は、合計とカテゴリ別だけを表示する
  const kbSum = list.length ? null : MoneyFeed.kakeiboMonthSummary(data, selYm);
  // 検索・出所フィルタ（明細のある月だけ）。件数・合計・カテゴリはフィルタ後に追従する
  const filtering = list.length > 0 && (MoneyKb.query.trim() !== '' || (MoneyKb.src && MoneyKb.src !== 'all'));
  const viewList = filtering ? MoneyFeed.kakeiboFilter(list, MoneyKb.query, MoneyKb.src) : list;
  const tot = kbSum
    ? { out: kbSum.out || 0, inn: kbSum.in || 0, cats: (kbSum.cats || []).slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)) }
    : MoneyFeed.kakeiboTotals(viewList);
  const shown = MoneyKb.showAll ? viewList : viewList.slice(0, 30);
  const kbBar = MoneyView.monthBar(kbMonths, selYm, 'MoneyKb');
  const srcOpts = MoneyFeed.kakeiboSources(list);
  if (MoneyKb.src !== 'all' && !srcOpts.includes(MoneyKb.src)) MoneyKb.src = 'all';
  const kbControls = list.length
    ? `<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <input id="kb-search" type="search" value="${esc(MoneyKb.query)}" placeholder="🔍 明細を検索（店名など）" oninput="MoneyKb.setQuery(this.value)" aria-label="家計簿を検索" style="flex:1;min-width:0;width:auto;margin:0;padding:7px 10px;font-size:13px">
        <select onchange="MoneyKb.setSrc(this.value)" aria-label="出所で絞り込む" style="flex:none;width:auto;margin:0;padding:7px 8px;font-size:13px"><option value="all"${MoneyKb.src === 'all' ? ' selected' : ''}>出所: 全部</option>${srcOpts.map(sv => `<option value="${esc(sv)}"${MoneyKb.src === sv ? ' selected' : ''}>${esc(sv)}</option>`).join('')}</select>
      </div>` +
      (filtering ? `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><span class="badge bb" style="font-size:11px">絞り込み中</span><button type="button" class="btn btn-sm btn-s" onclick="MoneyKb.clearFilter()" style="font-size:11px;padding:4px 10px">絞り込みを解除</button></div>` : '')
    : '';
  const kbCount = kbSum ? (kbSum.count || 0) : (filtering ? `${viewList.length}件（全${list.length}件中）` : list.length);
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
    ? `<div class="card"><div class="card-hdr"><span class="card-hdr-title">📒 家計簿</span><span class="muted" style="font-size:11px">${kbCount}件</span></div>
      ${kbBar}${kbControls}
      <div class="g2" style="margin-bottom:6px">
        <div class="stat"><div class="stat-v" style="font-size:19px">${MoneyView.yen(tot.out)}</div><div class="stat-l">支出</div></div>
        <div class="stat"><div class="stat-v" style="font-size:19px;color:var(--a3)">${MoneyView.yen(tot.inn)}</div><div class="stat-l">入金</div></div>
      </div>` +
      (tot.cats.length ? tot.cats.slice(0, 6).map(c => MoneyView.row(c.name, '', c.amount, MoneyFeed.pct(c.amount, tot.out), 'var(--a2)')).join('') : '') +
      (kbSum
        ? `<div class="empty" style="margin-top:10px">この月は明細が多く、合計とカテゴリ別だけを表示しています。</div>`
        : `<div style="font-size:12px;font-weight:700;margin:12px 0 2px">明細（新しい順）</div>` +
          (shown.length ? shown.map(rowHtml).join('') : `<div class="empty">${filtering ? '条件に合う明細がありません。検索や出所フィルタを変えてみてください。' : 'この月の明細はまだありません'}</div>`) +
          (viewList.length > 30 ? `<button type="button" class="btn ghost" style="width:100%;margin-top:8px" onclick="MoneyKb.toggleAll()">${MoneyKb.showAll ? '直近30件だけ見る' : `ぜんぶ見る（${viewList.length}件）`}</button>` : '')) +
      `<div class="muted" style="font-size:11px;margin-top:8px">銀行（楽天銀行・PayPay銀行）の明細と PayPay の支払い・送金を合わせたものです。PayPayへのチャージは、二重に数えないため明細に入れていません。</div></div>`
    : '';

  // ⑥ サブスク（S.moneySubs が正）
  const subsItems = MoneySubs.items().slice().sort((a, b) => {
    if (a.nextDate && b.nextDate) return a.nextDate < b.nextDate ? -1 : 1;
    if (a.nextDate) return -1;
    if (b.nextDate) return 1;
    return (b.amount || 0) - (a.amount || 0);
  });
  const st = MoneySubs.totals(subsItems);
  const subRow = (x) => {
    const dLeft = x.nextDate ? DateManager.daysBetween(x.nextDate) : null;
    const nextLabel = x.nextDate
      ? `${esc(x.nextDate.replace(/-/g, '/'))}（${dLeft > 0 ? `あと${dLeft}日` : dLeft === 0 ? '今日' : `${-dLeft}日過ぎ`}）`
      : '—';
    return `<div class="row" style="align-items:flex-start">
      <div class="row-title" style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(x.name)}</div>
        <div class="muted" style="font-size:11px">次回支払日 ${nextLabel}${x.memo ? ` ・ ${esc(x.memo)}` : ''}</div>
      </div>
      <div style="text-align:right;flex:none;margin-left:10px">
        <div style="font-size:14px;font-weight:800">${MoneyView.yen(x.amount)}<span class="muted" style="font-size:11px;font-weight:600">/${x.cycle === 'year' ? '年' : '月'}</span></div>
        <div style="margin-top:4px;display:flex;gap:4px;justify-content:flex-end">
          <button type="button" class="btn btn-sm btn-s" onclick="MoneySubs.openEdit('${x.id}')" style="font-size:11px;padding:4px 10px">編集</button>
          <button type="button" class="btn btn-sm btn-s" onclick="MoneySubs.askRemove('${x.id}')" style="font-size:11px;padding:4px 10px">削除</button>
        </div>
      </div>
    </div>`;
  };
  out.subs = `<div class="card"><div class="card-hdr"><span class="card-hdr-title">🔁 サブスク</span><button type="button" class="btn btn-p btn-sm" onclick="MoneySubs.openNew()">＋ 追加</button></div>
    <div class="g2" style="margin-bottom:6px">
      <div class="stat"><div class="stat-v" style="font-size:19px">${MoneyView.yen(st.monthlyEq)}</div><div class="stat-l">月額換算の合計</div></div>
      <div class="stat"><div class="stat-v" style="font-size:19px">${MoneyView.yen(st.yearlyEq)}</div><div class="stat-l">年額換算の合計</div></div>
    </div>` +
    (subsItems.length ? subsItems.map(subRow).join('') : '<div class="empty">登録されているサブスクはまだありません。「＋ 追加」から登録できます。</div>') +
    `</div>`;

  // ⑤ PayPay（CSVスナップショット＋アプリから取込）
  const pp = data.paypay;
  const ppMonths = (pp && Array.isArray(pp.monthlyPayments)) ? pp.monthlyPayments.slice(-6) : [];
  const ppMax = ppMonths.length ? Math.max(...ppMonths.map(m => m.amount), 1) : 1;
  const ppImportHtml = `<div style="margin-top:10px"><button type="button" class="btn btn-s btn-sm" onclick="document.getElementById('paypay-import-input').click()">📱 PayPay CSVを取り込む</button>`
    + `<input type="file" id="paypay-import-input" accept=".csv,text/csv" style="display:none" onchange="PayPayImportUI.onFile(event)">`
    + `<div id="paypay-import-c"></div></div>`;
  out.paypay = `<div class="card"><div class="card-hdr"><span class="card-hdr-title">📱 PayPay の支払い</span><span class="badge" style="font-size:10px">CSVスナップショット</span></div>`
    + (ppMonths.length
      ? ppMonths.map(m => MoneyView.row(MoneyView.ymLabel(m.month), `${m.count}件`, m.amount, Math.round(m.amount / ppMax * 100), 'var(--pur)')).join('') +
        `<div style="font-size:12px;font-weight:700;margin:12px 0 4px">よく使う店（全期間）</div>` +
        (pp.topMerchants || []).map(t => MoneyView.row(t.name, `${t.count}件`, t.amount, null)).join('') +
        `<div class="muted" style="font-size:11px;margin-top:8px">対象期間 ${esc(pp.periodFrom || '')} 〜 ${esc(pp.periodTo || '')}・全期間の支払い合計 ${MoneyView.yen(pp.totalPayments)}（${pp.paymentCount}件）。PayPayは自動連携が無いため、この欄は取引履歴CSVを取り込んだ時点のスナップショットです。</div>`
      : '<div class="empty">PayPay のデータはまだありません。下のボタンから取引履歴CSVを取り込めます。</div>')
    + ppImportHtml + `</div>`;

  // ⑦ 月次家計レポート（サーバー生成: 19-server.js の HouseholdReportUI が描く）
  out.report = (typeof HouseholdReportUI !== 'undefined' && HouseholdReportUI.html) ? HouseholdReportUI.html() : '';

  return out;
};

// サブタブに応じた全体描画。tab を省略すると現在のタブ（MoneyTab.current）で描くので、
// データ再取得・再描画のたびにホームへ戻ることはない。
// ホームは全セクションをこの順で並べる: 総資産→口座・資産ごと→証券→今月の支出→家計簿→サブスク→PayPay
MoneyView.html = (data, tab) => {
  const s = MoneyView.sections(data);
  const cur = MoneyTab.TABS.some(t => t.id === tab) ? tab : MoneyTab.current;
  const order = {
    home: ['total', 'accounts', 'securities', 'expenses', 'kakeibo', 'subs', 'paypay'],
    accounts: ['total', 'accounts'],
    securities: ['securities'],
    expenses: ['expenses'],
    paypay: ['paypay'],
    kakeibo: ['kakeibo'],
    subs: ['subs'],
    report: ['report']
  }[cur] || ['total', 'accounts', 'securities', 'expenses', 'kakeibo', 'subs', 'paypay'];
  const body = order.map(k => s[k]).join('');
  return body || '<div class="card"><div class="empty">データがまだありません</div></div>';
};
