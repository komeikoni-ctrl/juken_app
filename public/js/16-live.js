// ============================================================
// LIVE FEED — 天気・警報・地震・中継JSON・Geminiモデル一覧の自動取得
// 状態 S や jukenAppData2027 / geminiApiKey / geminiModel には書き込まない（読むだけ）。
// キャッシュは専用キー jukenLive2027 だけに置き、Firestore 同期には載せない。
// どの取得が失敗しても例外を外に出さず、アプリ本体の起動・描画は止めない。
// ============================================================

// URL が変わったときはここだけ直せばよいように集約しておく
// 中継データは Firestore の live/feeds ドキュメント（チェッカーが定期書き込み、アプリは読むだけ）
const LIVE_ENDPOINTS = {
  weather: 'https://www.jma.go.jp/bosai/forecast/data/forecast/280000.json',
  warning: 'https://www.jma.go.jp/bosai/warning/data/r8/280000.json',
  quake: 'https://www.jma.go.jp/bosai/quake/data/list.json',
  relayDoc: 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/feeds',
  geminiModels: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
  shinkiNavi: 'https://navi.shinkibus.jp/'
};
const LIVE_CACHE_KEY = 'jukenLive2027';
// 三田市は兵庫県南部（一次細分 280010）、市区町村コードは 2821900
const LIVE_AREA = { forecast: '280010', city: '2821900' };
const LIVE_INTERVAL = { jma: 10 * 60 * 1000, quake: 10 * 60 * 1000, relay: 30 * 60 * 1000 };
// 最新の警報電文がこれより古ければ「配信が止まっている可能性」とみなす
const LIVE_WARNING_STALE_MS = 48 * 3600 * 1000;

// 設定画面の状態一覧に出す名前（並び順もこの順）
const LIVE_FEED_NAMES = {
  weather: '天気予報（気象庁）',
  warning: '警報・注意報（気象庁）',
  quake: '地震情報（気象庁）',
  examNews: '入試ニュース',
  geminiPricing: 'Gemini 料金表',
  busNews: 'バスのお知らせ',
  busTimetable: 'バス時刻表',
  roadRisk: '道路状況',
  geminiModels: 'Geminiモデル一覧'
};

// 気象庁の警報・注意報 種別コード。主要種別は気象庁のコード表どおり。
// ここに無いコードは推測で名前を付けず「警報・注意報（コードXX）」と出す
const LIVE_WARNING_NAMES = {
  '02': '暴風雪警報', '03': '大雨警報', '04': '洪水警報', '05': '暴風警報', '06': '大雪警報', '07': '波浪警報', '08': '高潮警報',
  '10': '大雨注意報', '12': '大雪注意報', '13': '風雪注意報', '14': '雷注意報', '15': '強風注意報', '16': '波浪注意報',
  '17': '融雪注意報', '18': '洪水注意報', '19': '高潮注意報', '20': '濃霧注意報', '21': '乾燥注意報', '22': 'なだれ注意報',
  '23': '低温注意報', '24': '霜注意報', '25': '着氷注意報', '26': '着雪注意報',
  '32': '暴風雪特別警報', '33': '大雨特別警報', '35': '暴風特別警報', '36': '大雪特別警報', '37': '波浪特別警報', '38': '高潮特別警報'
};

// 09-misc.js の modelMigration で起動時に別IDへ書き換えられるモデル。
// 一覧に足すと「選んでも次回起動で勝手に戻る」ことになり、SelfTest（提供終了モデルが一覧にないこと）も崩れるので足さない
const LIVE_MODEL_SKIP = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-3-flash', 'gemini-3-flash-preview', 'gemini-3-pro-preview',
  'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-lite-preview-09-2025', 'gemini-2.5-pro', 'gemini-3.7-flash', 'gemini-3.5-flash'];

const LiveFeed = {
  // localStorage jukenLive2027 の読み書き。壊れていたら空として扱う
  cache: {
    read: () => {
      try {
        const o = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) || '{}');
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
      } catch (e) { return {}; }
    },
    write: (obj) => {
      try { localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(obj)); }
      catch (e) { console.warn('[live] キャッシュ保存に失敗', e); }
    },
    getEntry: (key) => LiveFeed.cache.read()[key] || null,
    setEntry: (key, entry) => { const o = LiveFeed.cache.read(); o[key] = entry; LiveFeed.cache.write(o); }
  },

  // フィードごとの { state: 'ok'|'error'|'stale', fetchedAt, sourceAt }
  status: {},
  setStatus: (key, patch) => { LiveFeed.status[key] = { ...(LiveFeed.status[key] || {}), ...patch }; },

  // タイムアウト付き fetch。成功時は JSON、失敗時は null（例外は投げない）
  fetchJson: async (url, timeoutMs = 12000, init = {}) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, { cache: 'no-store', ...init, ...(ctrl ? { signal: ctrl.signal } : {}) });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  _inflight: {},
  // 取得してキャッシュに保存する。失敗時は null（古いキャッシュと fetchedAt はそのまま）
  _refresh: (key, url, opts = {}) => {
    if (LiveFeed._inflight[key]) return LiveFeed._inflight[key];
    const p = (async () => {
      try {
        const raw = await LiveFeed.fetchJson(url);
        if (raw == null) { LiveFeed.setStatus(key, { state: 'error' }); return null; }
        const data = opts.transform ? opts.transform(raw) : raw;
        const fetchedAt = Date.now();
        LiveFeed.cache.setEntry(key, { data, fetchedAt });
        LiveFeed.setStatus(key, { state: 'ok', fetchedAt });
        return data;
      } catch (e) {
        LiveFeed.setStatus(key, { state: 'error' });
        return null;
      } finally {
        delete LiveFeed._inflight[key];
      }
    })();
    LiveFeed._inflight[key] = p;
    return p;
  },

  // キャッシュが maxAge 内ならそれを返して裏で再取得（取れたら opts.onUpdate を呼ぶ）。
  // 無い・古いなら取得を待つ。取得に失敗したら古いキャッシュを返す（無ければ null）
  get: async (key, url, maxAgeMs, opts = {}) => {
    try {
      const entry = LiveFeed.cache.getEntry(key);
      if (entry && !LiveFeed.status[key]) LiveFeed.setStatus(key, { state: 'ok', fetchedAt: entry.fetchedAt });
      if (entry && Date.now() - (entry.fetchedAt || 0) < maxAgeMs) {
        LiveFeed._refresh(key, url, opts).then(d => { if (d != null && opts.onUpdate) { try { opts.onUpdate(d); } catch (e) { console.warn('[live]', e); } } });
        return entry.data;
      }
      const fresh = await LiveFeed._refresh(key, url, opts);
      if (fresh != null) return fresh;
      return entry ? entry.data : null;
    } catch (e) {
      return null;
    }
  },

  // 最終取得時刻（HH:MM）
  fmtHM: (ts) => {
    if (!ts) return '--:--';
    const d = new Date(ts);
    if (isNaN(d)) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  fmtMDHM: (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return '';
    return `${d.getMonth() + 1}/${d.getDate()} ${LiveFeed.fmtHM(d)}`;
  },
  _timeTag: (key) => `<span style="font-size:10px;color:var(--muted);font-weight:normal;margin-left:6px">${LiveFeed.fmtHM(LiveFeed.status[key]?.fetchedAt)}取得</span>`,

  // ---------------- 天気 ----------------
  // 構造の細部（timeSeries の並び）に依存しすぎないよう、中身で見分ける
  _parseWeather: (data) => {
    const short = Array.isArray(data) ? data[0] : null;
    const series = short?.timeSeries || [];
    const dateOf = (t) => String(t || '').slice(0, 10);
    const out = { reportDatetime: short?.reportDatetime || null, days: [] };
    let wSeries = null, wArea = null, pSeries = null, pArea = null, tSeries = null, tArea = null;
    for (const ts of series) {
      for (const a of (ts.areas || [])) {
        if (a.weathers && String(a.area?.code) === LIVE_AREA.forecast && !wArea) { wSeries = ts; wArea = a; }
        if (a.pops && String(a.area?.code) === LIVE_AREA.forecast && !pArea) { pSeries = ts; pArea = a; }
        if (a.temps && !tArea) { tSeries = ts; tArea = a; }
      }
      // 気温は代表地点（南部は神戸）。名前で見つかればそれを優先
      const kobe = (ts.areas || []).find(a => a.temps && a.area?.name === '神戸');
      if (kobe) { tSeries = ts; tArea = kobe; }
    }
    if (!wArea) return null;
    const dates = (wSeries.timeDefines || []).map(dateOf);
    dates.slice(0, 2).forEach((date, i) => {
      const day = { date, weather: String(wArea.weathers?.[i] || '').replace(/[\s　]+/g, ' ').trim(), pop: null, max: null, min: null };
      if (pArea && pSeries) {
        const pops = (pSeries.timeDefines || []).map((t, j) => dateOf(t) === date ? Number(pArea.pops[j]) : NaN).filter(n => !isNaN(n));
        if (pops.length) day.pop = Math.max(...pops);
      }
      if (tArea && tSeries) {
        // 気象庁の短期予報では 00:00 が朝の最低、09:00 が日中の最高
        (tSeries.timeDefines || []).forEach((t, j) => {
          if (dateOf(t) !== date) return;
          const v = Number(tArea.temps[j]);
          if (tArea.temps[j] === '' || isNaN(v)) return;
          const h = new Date(t).getHours();
          if (h === 0) day.min = v; else if (h === 9) day.max = v;
        });
      }
      out.days.push(day);
    });
    out.tempPoint = tArea?.area?.name || '神戸';
    return out;
  },
  _weatherIcon: (w) => {
    const s = String(w || '');
    const first = s.match(/晴|くもり|曇|雨|雪/)?.[0];
    return { '晴': '☀️', 'くもり': '☁️', '曇': '☁️', '雨': '☔', '雪': '❄️' }[first] || '🌤';
  },

  // ---------------- 警報・注意報 ----------------
  // 電文を reportDatetime 昇順に処理し、指定地域について種別コードごとの最新 status をマージする。
  // 「発表」「継続」のものだけを現在有効として返す。純粋関数（テストから呼べる）
  _mergeWarnings: (telegrams, areaCode, now = Date.now()) => {
    const list = (Array.isArray(telegrams) ? telegrams : (telegrams ? [telegrams] : []))
      .filter(t => t && typeof t === 'object')
      .slice()
      .sort((a, b) => (Date.parse(a.reportDatetime) || 0) - (Date.parse(b.reportDatetime) || 0));
    const code = String(areaCode);
    // 実構造: telegram.warning.class20Items[] = { areaCode, kinds: [{ code, status }] }
    // 市区町村で見つからなければ一次細分（兵庫県南部 280010）の項目で代用する
    const areaKinds = (t) => {
      const w = t.warning || {};
      const city = (w.class20Items || []).find(i => String(i.areaCode) === code);
      if (city) return city.kinds || [];
      const sub = (w.class10Items || []).find(i => String(i.areaCode) === LIVE_AREA.forecast);
      return sub ? (sub.kinds || []) : [];
    };
    const latest = {};
    let latestReportAt = null;
    for (const t of list) {
      const at = t.reportDatetime || null;
      if (at && (!latestReportAt || Date.parse(at) > Date.parse(latestReportAt))) latestReportAt = at;
      for (const k of areaKinds(t)) {
        if (k?.code == null || k.code === '') continue; // 「発表警報・注意報はなし」の項目は code を持たない
        const key = String(k.code).padStart(2, '0');
        latest[key] = { code: key, status: k.status || '', reportDatetime: at, headlineText: t.headlineText || '' };
      }
    }
    const active = Object.values(latest)
      .filter(w => w.status === '発表' || w.status === '継続')
      .map(w => {
        const name = LIVE_WARNING_NAMES[w.code] || `警報・注意報（コード${w.code}）`;
        const level = /特別警報/.test(name) ? 'special' : /警報/.test(name) && !/注意報/.test(name) ? 'warning' : /注意報/.test(name) ? 'advisory' : 'unknown';
        return { ...w, name, level };
      })
      .sort((a, b) => ({ special: 0, warning: 1, unknown: 2, advisory: 3 }[a.level] - { special: 0, warning: 1, unknown: 2, advisory: 3 }[b.level]));
    const stale = !latestReportAt || (now - Date.parse(latestReportAt)) >= LIVE_WARNING_STALE_MS;
    return { active, latestReportAt, stale };
  },

  // ---------------- 地震 ----------------
  _intRank: (s) => ({ '1': 1, '2': 2, '3': 3, '4': 4, '5-': 5, '5+': 6, '6-': 7, '6+': 8, '7': 9 }[String(s ?? '')] || 0),
  // 観測点の入れ子（都道府県→市区町村）を辿って、指定市区町村の震度を探す
  _findCityInt: (node, code, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6) return null;
    if (Array.isArray(node)) { for (const n of node) { const r = LiveFeed._findCityInt(n, code, depth + 1); if (r) return r; } return null; }
    if (String(node.code ?? '') === code && node.maxi) return node.maxi;
    for (const k of Object.keys(node)) { if (node[k] && typeof node[k] === 'object') { const r = LiveFeed._findCityInt(node[k], code, depth + 1); if (r) return r; } }
    return null;
  },
  // 直近5件から、三田市を含むものがあればその震度、無ければ最大震度の大きい直近1件を返す
  _summarizeQuakes: (list) => {
    const recent = (Array.isArray(list) ? list : []).filter(e => e && e.at)
      .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, 5);
    if (!recent.length) return null;
    const pick = (e, cityInt) => ({
      at: e.at, title: e.ttl || e.title || '',
      epicenter: e.anm || (e.ctt && !/^\d+$/.test(String(e.ctt)) ? e.ctt : '') || '',
      mag: e.mag ?? '', maxi: e.maxi || '', cityInt: cityInt || null
    });
    for (const e of recent) {
      const ci = LiveFeed._findCityInt(e.int, LIVE_AREA.city);
      if (ci) return pick(e, ci);
    }
    let best = null;
    for (const e of recent) { if (!best || LiveFeed._intRank(e.maxi) > LiveFeed._intRank(best.maxi)) best = e; }
    return pick(best, null);
  },

  // ---------------- 描画 ----------------
  data: {},

  renderBand: () => {
    const el = document.getElementById('live-band');
    if (!el) return;
    const w = LiveFeed.data.warning, wx = LiveFeed.data.weather, qk = LiveFeed.data.quake;
    // 警報がある時だけ目立つカード（警報級=赤系、注意報=黄系）
    if (w && !w.stale && w.active.length) {
      const strong = w.active.some(a => a.level === 'special' || a.level === 'warning');
      const bg = strong ? 'rgba(255,59,48,0.12)' : 'rgba(255,204,0,0.16)';
      const bd = strong ? 'rgba(255,59,48,0.45)' : 'rgba(255,170,0,0.5)';
      const names = w.active.map(a => esc(a.name)).join('・');
      const headline = w.active.map(a => a.headlineText).filter(Boolean).pop() || '';
      el.innerHTML = `<div class="card" style="margin-bottom:0;background:${bg};border:1px solid ${bd} !important">
        <details><summary style="cursor:pointer;font-weight:800;font-size:13px">${strong ? '🚨' : '⚠️'} 三田市に ${names} が発表中${LiveFeed._timeTag('warning')}</summary>
        <div style="font-size:12px;line-height:1.6;margin-top:8px">${headline ? esc(headline) : '詳細は気象庁の発表を確認してください。'}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:6px">発表 ${esc(LiveFeed.fmtMDHM(w.latestReportAt))}（気象庁）</div></details></div>`;
      return;
    }
    const parts = [];
    const today = wx?.days?.[0];
    if (today) {
      const t = [`${LiveFeed._weatherIcon(today.weather)} ${esc(today.weather)}`];
      if (today.pop != null) t.push(`降水確率${today.pop}%`);
      const temp = [today.max != null ? `最高${today.max}°` : '', today.min != null ? `最低${today.min}°` : ''].filter(Boolean).join('/');
      if (temp) t.push(`${temp}（気温は${esc(wx.tempPoint || '神戸')}地点）`);
      parts.push(t.join(' ') + LiveFeed._timeTag('weather'));
    }
    if (qk !== undefined) {
      let q = '地震：直近なし';
      if (qk) {
        const when = LiveFeed.fmtMDHM(qk.at);
        q = qk.cityInt
          ? `地震：${esc(when)} ${esc(qk.epicenter)} 三田市で震度${esc(qk.cityInt)}`
          : `地震：${esc(when)} ${esc(qk.epicenter)}${qk.mag !== '' ? ' M' + esc(qk.mag) : ''}${qk.maxi ? ' 最大震度' + esc(qk.maxi) : ''}`;
      }
      parts.push(q + LiveFeed._timeTag('quake'));
    }
    if (w && w.stale) parts.push(`⚠️ 警報データの配信が止まっている可能性があります（最新 ${esc(LiveFeed.fmtMDHM(w.latestReportAt)) || '不明'}）`);
    el.innerHTML = parts.length
      ? `<div style="font-size:11px;line-height:1.7;color:var(--text);background:var(--card);border:1px solid var(--border);border-radius:12px;padding:6px 12px">${parts.join(' ／ ')}</div>`
      : '';
  },

  renderBus: () => {
    const el = document.getElementById('bus-live-info');
    if (!el) return;
    const parts = [];
    const news = (LiveFeed.data.busNews?.items || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 2);
    news.forEach(n => {
      const url = safeUrl(n.url);
      const title = esc(n.title);
      parts.push(`<div style="font-size:11px;margin-top:4px">📢 <span class="muted">${esc(n.date)}</span> ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</div>`);
    });
    const road = LiveFeed.data.roadRisk;
    if (road && Number(road.level) >= 1) {
      const lv2 = Number(road.level) >= 2;
      parts.push(`<div style="font-size:11px;margin-top:6px;padding:6px 10px;border-radius:10px;background:${lv2 ? 'rgba(255,59,48,0.12)' : 'rgba(255,204,0,0.16)'}">${lv2 ? '🚨' : '⚠️'} 阪神高速で渋滞/規制：${lv2 ? '大幅に遅れるおそれ' : '遅れやすい'}${road.summary ? `<div style="color:var(--muted);margin-top:2px">${esc(road.summary)}</div>` : ''}</div>`);
    }
    parts.push(`<div style="font-size:10px;text-align:center;margin-top:6px"><a href="${LIVE_ENDPOINTS.shinkiNavi}" target="_blank" rel="noopener noreferrer">神姫バスNAVIで運行状況を確認</a></div>`);
    el.innerHTML = parts.join('');
  },

  renderExamNews: () => {
    const el = document.getElementById('exam-news-feed');
    if (!el) return;
    const items = (LiveFeed.data.examNews?.items || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8);
    if (!items.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="card" style="margin-bottom:0"><div class="card-hdr"><span class="card-hdr-title">📰 入試ニュース</span>${LiveFeed._timeTag('examNews')}</div>${items.map(n => {
      const url = safeUrl(n.url);
      const title = esc(n.title);
      const imp = !!n.important;
      return `<div style="font-size:12px;line-height:1.5;padding:6px 0 6px ${imp ? '8px' : '0'};border-bottom:1px solid var(--border);${imp ? 'border-left:3px solid var(--a2);font-weight:700;' : ''}">
        <span class="badge bb" style="font-size:10px">${esc(n.source)}</span> <span class="muted" style="font-size:10px">${esc(n.date)}</span>${imp ? ' <span style="color:var(--a2)">❗重要</span>' : ''}<br>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</div>`;
    }).join('')}</div>`;
  },

  _pricingFallback: null,
  renderPricing: () => {
    const el = document.getElementById('gemini-pricing-note');
    if (!el) return;
    if (LiveFeed._pricingFallback == null) LiveFeed._pricingFallback = el.innerHTML;
    const up = LiveFeed.data.modelAutoUpgrade || LiveFeed.cache.getEntry('modelAutoUpgrade')?.data;
    const upNote = up ? `🆕 新しいモデル「${esc(up.to)}」が出たので、「${esc(up.from)}」から自動で切り替えました。` : '';
    const p = LiveFeed.data.geminiPricing;
    const model = (typeof AiService !== 'undefined') ? AiService.getModel() : '';
    const m = p?.models?.[model];
    if (!m) { el.innerHTML = (upNote ? upNote + '<br>' : '') + LiveFeed._pricingFallback; return; }
    const free = m.freeTier === true ? '無料枠あり' : m.freeTier === false ? '無料枠なし（有料プランのみ）' : (m.freeTier ? String(m.freeTier) : '');
    const price = (m.inputPer1M != null || m.outputPer1M != null) ? `100万トークンあたり入力$${m.inputPer1M ?? '—'}・出力$${m.outputPer1M ?? '—'}` : '';
    const body = [price, free, m.note || ''].filter(Boolean).map(esc).join('。');
    el.innerHTML = (upNote ? upNote + '<br>' : '') + `💎 ${esc(m.displayName || model)}：${body}${body ? '。' : ''}（Google公式料金表 ${esc(p.sourceUpdatedAt || p.updatedAt || '')} 時点・自動取得）`;
  },

  renderStatus: () => {
    const el = document.getElementById('live-status-c');
    if (!el) return;
    const label = { ok: '✅ 正常', error: '⚠️ 取得失敗', stale: '⏸ 配信停止の可能性', unavailable: '— 取得不可（提供元が自動取得を制限）' };
    el.innerHTML = `<div style="font-size:12px;font-weight:700;margin:8px 0 4px">📡 ライブ情報</div>` + Object.keys(LIVE_FEED_NAMES).map(k => {
      const s = LiveFeed.status[k];
      const st = s ? (label[s.state] || s.state) : '— 未取得';
      return `<div class="row"><div class="row-title" style="font-size:12px">${esc(LIVE_FEED_NAMES[k])}</div><span class="muted" style="font-size:11px">${esc(st)} ${s?.fetchedAt ? esc(LiveFeed.fmtMDHM(s.fetchedAt)) : ''}</span></div>`;
    }).join('');
  },

  // ---------------- 各フィードの取得 ----------------
  loadWeather: async () => {
    const raw = await LiveFeed.get('weather', LIVE_ENDPOINTS.weather, LIVE_INTERVAL.jma, { onUpdate: d => LiveFeed._applyWeather(d) });
    LiveFeed._applyWeather(raw);
  },
  _applyWeather: (raw) => {
    try {
      const w = raw ? LiveFeed._parseWeather(raw) : null;
      if (w) { LiveFeed.data.weather = w; LiveFeed.setStatus('weather', { sourceAt: w.reportDatetime }); }
    } catch (e) { console.warn('[live] 天気の解析に失敗', e); }
    LiveFeed.renderBand(); LiveFeed.renderStatus();
  },

  loadWarning: async () => {
    const raw = await LiveFeed.get('warning', LIVE_ENDPOINTS.warning, LIVE_INTERVAL.jma, { onUpdate: d => LiveFeed._applyWarning(d) });
    LiveFeed._applyWarning(raw);
  },
  _applyWarning: (raw) => {
    try {
      if (raw) {
        const m = LiveFeed._mergeWarnings(raw, LIVE_AREA.city);
        LiveFeed.data.warning = m;
        LiveFeed.setStatus('warning', { sourceAt: m.latestReportAt, ...(m.stale ? { state: 'stale' } : {}) });
      }
    } catch (e) { console.warn('[live] 警報の解析に失敗', e); }
    LiveFeed.renderBand(); LiveFeed.renderStatus();
  },

  loadQuake: async () => {
    // 一覧は大きいので、要約に必要な直近分だけキャッシュに残す
    const opts = { transform: d => Array.isArray(d) ? d.slice().sort((a, b) => (Date.parse(b?.at) || 0) - (Date.parse(a?.at) || 0)).slice(0, 10) : d, onUpdate: d => LiveFeed._applyQuake(d) };
    const raw = await LiveFeed.get('quake', LIVE_ENDPOINTS.quake, LIVE_INTERVAL.quake, opts);
    LiveFeed._applyQuake(raw);
  },
  _applyQuake: (raw) => {
    try {
      if (raw) { LiveFeed.data.quake = LiveFeed._summarizeQuakes(raw); LiveFeed.setStatus('quake', { sourceAt: LiveFeed.data.quake?.at || null }); }
    } catch (e) { console.warn('[live] 地震の解析に失敗', e); }
    LiveFeed.renderBand(); LiveFeed.renderStatus();
  },

  // 中継データ（Firestore live/feeds）。1回の取得で全フィードを配る。
  // フィールドは JSON 文字列で入っているので、パースできなかったものは捨てる
  _parseRelayDoc: (raw) => {
    const fields = raw?.fields || {};
    const out = {};
    const map = { examNews: 'examNews', geminiPricing: 'geminiPricing', busNews: 'busNews', busTimetable: 'busTimetable', roadRisk: 'roadRisk' };
    for (const [key, field] of Object.entries(map)) {
      const s = fields[field]?.stringValue;
      if (!s) continue;
      try { const v = JSON.parse(s); if (v && typeof v === 'object') out[key] = v; } catch (e) { /* 壊れたフィールドは無視 */ }
    }
    return Object.keys(out).length ? out : null;
  },
  _distributeRelay: (bundle) => {
    if (!bundle) return;
    for (const key of Object.keys(bundle)) {
      LiveFeed.data[key] = bundle[key];
      const fs = bundle[key] && bundle[key].status;
      const state = fs === 'unavailable' ? 'unavailable' : (fs === 'error' ? 'error' : 'ok');
      LiveFeed.setStatus(key, { state, fetchedAt: Date.now(), sourceAt: bundle[key].updatedAt || null });
    }
    try { LiveFeed.renderExamNews(); } catch (e) { console.warn('[live]', e); }
    try { LiveFeed.renderPricing(); } catch (e) { console.warn('[live]', e); }
    try { LiveFeed.renderBus(); } catch (e) { console.warn('[live]', e); }
    try { LiveFeed.applyBusTimetable(); } catch (e) { console.warn('[live]', e); }
    LiveFeed.renderStatus();
  },
  loadRelays: async () => {
    const key = (typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey) || '';
    if (!key) return;
    const url = LIVE_ENDPOINTS.relayDoc + '?key=' + encodeURIComponent(key);
    const bundle = await LiveFeed.get('relayDoc', url, LIVE_INTERVAL.relay, {
      transform: (raw) => LiveFeed._parseRelayDoc(raw),
      onUpdate: (b) => LiveFeed._distributeRelay(b)
    });
    LiveFeed._distributeRelay(bundle);
  },

  // bus-timetable.json が取れたら 09-misc.js の BUS_TIMETABLE を差し替えて表示し直す
  applyBusTimetable: () => {
    const t = LiveFeed.data.busTimetable;
    // 時刻は 0:00〜23:59 だけ受け付ける（"25:99" のような壊れた値で次便の計算が狂うのを防ぐ）
    const isTime = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s)); return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59; };
    const isTimes = (a) => Array.isArray(a) && a.length > 0 && a.every(isTime);
    if (!t || !isTimes(t.toSan) || !isTimes(t.toFlo)) return;
    // 次便の判定は先頭から順に見るので、取得したデータの並び順に頼らず時刻順に並べ直す
    const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
    const sorted = (a) => a.map(String).sort((x, y) => toMin(x) - toMin(y));
    const duration = Number(t.duration) > 0 ? Number(t.duration) : (window.BUS_TIMETABLE?.duration || 53);
    const next = { duration, toSan: sorted(t.toSan), toFlo: sorted(t.toFlo) };
    if (Number(t.durationReturn) > 0) next.durationReturn = Number(t.durationReturn);
    if (isTimes(t.toSanWeekend) && isTimes(t.toFloWeekend)) { next.toSanWeekend = sorted(t.toSanWeekend); next.toFloWeekend = sorted(t.toFloWeekend); }
    window.BUS_TIMETABLE = next;
    if (window.updateBusTimes) window.updateBusTimes();
  },

  // ---------------- Gemini モデル一覧の動的化 ----------------
  // モデルの系統（Flash / Flash-Lite / Pro / Argon）とバージョンを取り出す
  _modelFamily: (id) => {
    const m = /^gemini-(\d+)(?:\.(\d+))?-([a-z0-9-]+)$/.exec(String(id || ''));
    if (!m) return null;
    let fam = m[3];
    const preview = /preview/.test(fam);
    fam = fam.replace(/-preview$/, '');
    return { ver: [Number(m[1]), Number(m[2] || 0)], fam, preview };
  },
  // 新しいモデルが出ていたら、今使っているモデルを同じ系統の最新版へ自動で切り替える。
  // 系統は変えない（Flash の人は Flash のまま）。プレビュー版へは、今がプレビュー版のときだけ。
  // チャットに使える系統だけ（音声・画像・Live・文字起こし・日付つきの旧プレビューなどは除く）。
  // これを通さないと、TTS や画像生成のモデルまで選択肢に並び、選ぶとチャットが動かなくなる
  _isChatModel: (id) => /^gemini-\d+(?:\.\d+)?-(?:flash-lite|flash|pro|argon)(?:-preview)?$/.test(String(id || '')),
  autoUpgradeModel: (list) => {
    try {
      // 「保存されているモデル」を基準にする。AiService.getModel() は選択欄の値を先に見るので、
      // 起動直後（09-misc.js が保存値を選択欄に入れる前）に呼ぶと、先頭の選択肢を「今のモデル」と誤認して
      // Argon などを選んでいる人まで Flash に切り替えてしまう
      const cur = localStorage.getItem('geminiModel') || (typeof DEFAULT_MODEL !== 'undefined' ? DEFAULT_MODEL : '');
      const cf = LiveFeed._modelFamily(cur);
      if (!cf || !Array.isArray(list)) return;
      const newer = list
        .filter(m => m && LiveFeed._isChatModel(m.id))
        .map(m => ({ id: m.id, f: LiveFeed._modelFamily(m.id) }))
        .filter(x => x.f && x.f.fam === cf.fam && x.id !== cur)
        .filter(x => {
          const gt = x.f.ver[0] > cf.ver[0] || (x.f.ver[0] === cf.ver[0] && x.f.ver[1] > cf.ver[1]);
          const sameVerStable = x.f.ver[0] === cf.ver[0] && x.f.ver[1] === cf.ver[1] && cf.preview && !x.f.preview;
          return (gt || sameVerStable) && (cf.preview || !x.f.preview);
        })
        .sort((a, b) => (b.f.ver[0] - a.f.ver[0]) || (b.f.ver[1] - a.f.ver[1]));
      if (!newer.length) return;
      const to = newer[0].id;
      const optOut = LiveFeed.cache.getEntry('modelAutoUpgradeOptOut')?.data;
      if (optOut && optOut.from === cur && optOut.to === to) return; // 手動で戻した選択は尊重する
      localStorage.setItem('geminiModel', to);
      try { if (typeof S !== 'undefined' && S) S.aiModel = to; } catch (e) {}
      const rec = { from: cur, to, at: new Date().toISOString() };
      LiveFeed.cache.setEntry('modelAutoUpgrade', { data: rec, fetchedAt: Date.now() });
      LiveFeed.data.modelAutoUpgrade = rec;
      console.info(`[live] 新モデル ${to} が出たので ${cur} から自動切替しました`);
    } catch (e) { console.warn('[live] モデルの自動切替に失敗', e); }
  },

  _origOptions: null,
  // list: [{ id, displayName }]
  applyModelList: (list) => {
    try {
      if (!Array.isArray(list)) return;
      list = list.filter(m => m && LiveFeed._isChatModel(m.id));   // 古いキャッシュに混ざっていた分もここで落とす
      if (!list.length) return;
      const sel = document.getElementById('set-model');
      // 手書きの option は初回に控えておき、表示名と並び順の基準にする
      if (sel && !LiveFeed._origOptions) LiveFeed._origOptions = [...sel.options].map(o => ({ value: o.value, text: o.textContent }));
      const ids = list.map(m => m.id);
      // AiService.getModel() が弾かないよう、新しく見つかったモデルを AVAILABLE_MODELS に足す
      list.forEach(m => { if (!AVAILABLE_MODELS.includes(m.id)) AVAILABLE_MODELS.push(m.id); });
      if (!sel) return;
      const saved = localStorage.getItem('geminiModel') || (typeof S !== 'undefined' && S.aiModel) || sel.value || '';
      // 起動時に 09-misc.js が別IDへ書き換える旧IDは「選択中」として残さない
      const current = LIVE_MODEL_SKIP.includes(saved) ? '' : saved;
      const opts = [];
      const orig = LiveFeed._origOptions || [];
      orig.forEach(o => {
        if (ids.includes(o.value)) opts.push({ value: o.value, text: o.text });
        else if (o.value === current) opts.push({ value: o.value, text: o.text + '（提供終了の可能性）' });
      });
      list.forEach(m => { if (!opts.some(o => o.value === m.id)) opts.push({ value: m.id, text: m.displayName || m.id }); });
      // 一覧に無いモデルが選ばれていても勝手に切り替えない
      if (current && !opts.some(o => o.value === current)) opts.push({ value: current, text: current + '（提供終了の可能性）' });
      const prev = sel.value;
      // 「おまかせ（自動）」はモデル一覧には無い選択肢なので、再構築のたびに先頭へ戻す
      const autoOpt = orig.find(o => o.value === 'auto') || { value: 'auto', text: 'おまかせ（自動・コスト最適）' };
      if (!opts.some(o => o.value === 'auto')) opts.unshift(autoOpt);
      sel.innerHTML = opts.map(o => `<option value="${esc(o.value)}">${esc(o.text)}</option>`).join('');
      // おまかせ中は選択欄もおまかせのまま（保存済みモデルへ勝手に戻さない）
      if (typeof AiModelMode !== 'undefined' && AiModelMode.get() === 'auto') sel.value = 'auto';
      else sel.value = current || prev;
      if (!sel.value && prev) sel.value = prev;
      LiveFeed.renderPricing();
    } catch (e) { console.warn('[live] モデル一覧の反映に失敗', e); }
  },
  loadModels: async () => {
    const key = (localStorage.getItem('geminiApiKey') || '').trim();
    if (!key) return;
    const res = await LiveFeed.fetchJson(LIVE_ENDPOINTS.geminiModels, 12000, { headers: { 'x-goog-api-key': key } });
    if (!res || !Array.isArray(res.models)) { LiveFeed.setStatus('geminiModels', { state: 'error' }); LiveFeed.renderStatus(); return; }
    const list = res.models
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => ({ id: String(m.name || '').replace(/^models\//, ''), displayName: m.displayName || '' }))
      .filter(m => m.id && !LIVE_MODEL_SKIP.includes(m.id) && LiveFeed._isChatModel(m.id));
    if (!list.length) { LiveFeed.setStatus('geminiModels', { state: 'error' }); LiveFeed.renderStatus(); return; }
    const fetchedAt = Date.now();
    LiveFeed.cache.setEntry('geminiModels', { data: list, fetchedAt });
    LiveFeed.setStatus('geminiModels', { state: 'ok', fetchedAt });
    LiveFeed.autoUpgradeModel(list);
    LiveFeed.applyModelList(list);
    LiveFeed.renderStatus();
  },

  _safe: (fn) => { try { const p = fn(); if (p && p.catch) p.catch(e => console.warn('[live]', e)); } catch (e) { console.warn('[live]', e); } },
  _every: (ms, fn) => setInterval(() => { if (!document.hidden) LiveFeed._safe(fn); }, ms),

  init: () => {
    LiveFeed.renderStatus();
    LiveFeed._safe(LiveFeed.renderBus);
    LiveFeed._safe(LiveFeed.loadWeather);
    LiveFeed._safe(LiveFeed.loadWarning);
    LiveFeed._safe(LiveFeed.loadQuake);
    LiveFeed._safe(LiveFeed.loadRelays);
    // モデル一覧は起動直後の描画を邪魔しないよう少し遅らせる
    setTimeout(() => LiveFeed._safe(LiveFeed.loadModels), 3000);
    document.getElementById('set-model')?.addEventListener('change', (ev) => {
      // 自動切替の直後にユーザーが手動で選び直したら、その組み合わせでは二度と自動切替しない
      try {
        const rec = LiveFeed.cache.getEntry('modelAutoUpgrade')?.data;
        const picked = ev.target.value;
        if (rec && picked && picked !== rec.to) LiveFeed.cache.setEntry('modelAutoUpgradeOptOut', { data: { from: picked, to: rec.to }, fetchedAt: Date.now() });
      } catch (e) {}
      LiveFeed._safe(LiveFeed.renderPricing);
    });
    LiveFeed._every(LIVE_INTERVAL.jma, () => Promise.all([LiveFeed.loadWeather(), LiveFeed.loadWarning()]));
    LiveFeed._every(LIVE_INTERVAL.quake, LiveFeed.loadQuake);
    LiveFeed._every(LIVE_INTERVAL.relay, LiveFeed.loadRelays);
  }
};

// 前回取得したモデル一覧で先に option を組み立てる。
// 09-misc.js の起動処理（DOMContentLoaded）が「一覧に無いモデルは既定に戻す」より前に済ませておく必要がある
try {
  const cachedModels = LiveFeed.cache.getEntry('geminiModels');
  if (cachedModels?.data) {
    LiveFeed.autoUpgradeModel(cachedModels.data);
    LiveFeed.applyModelList(cachedModels.data);
    LiveFeed.setStatus('geminiModels', { state: 'ok', fetchedAt: cachedModels.fetchedAt });
  }
} catch (e) { console.warn('[live]', e); }

document.addEventListener('DOMContentLoaded', () => LiveFeed._safe(LiveFeed.init));
