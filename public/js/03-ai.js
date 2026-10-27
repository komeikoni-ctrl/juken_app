// ============================================================
// AI SERVICE & DATA LOGIC
// ============================================================
// 使用可能なモデル（新しい順）。DEFAULT_MODEL は設定未保存時に使われる
const DEFAULT_MODEL = 'gemini-3.8-flash';
// 2026-10-23 に公式（ai.google.dev の Models / Deprecations）で確認。
// gemini-3.7-flash と gemini-3.5-flash は、呼ぶとそれぞれ 3.8-flash / 3.6-flash に自動で転送されるようになったので一覧から外した
// （残すと「3.7を選んだのに中身は3.8」になり、混雑時の代替先としても同じモデルを叩き直すだけになる）
// gemini-4-argon は最上位の推論モデル。有料プランのキーでしか使えず（無料枠なし）、料金も高いので既定にはしない。
// 混雑時の代替先（FALLBACK_MODELS）にも入れない（Flash が混んだときに勝手に高いモデルへ切り替わらないように）。
const AVAILABLE_MODELS = ['gemini-4-argon','gemini-3.8-flash','gemini-3.6-flash','gemini-3.5-flash-lite','gemini-3.1-pro-preview','gemini-2.5-flash'];
// 明示キャッシュ（cachedContents）に対応していないモデル。暗黙キャッシュは効く
const NO_EXPLICIT_CACHE_MODELS = ['gemini-4-argon'];
// thinkingLevel（low / high）を送れるモデル。2.5 系に送ると弾かれる
const supportsThinkingLevel = (model) => /^gemini-[34]/.test(String(model || ''));
// 503（混雑）時に順番に試す代替モデル。廃止済みモデルや、別モデルへの転送になったIDは含めないこと
const FALLBACK_MODELS = ['gemini-3.6-flash','gemini-3.5-flash-lite','gemini-2.5-flash'];
// inlineData を使う場合、リクエスト全体で 20MB が上限（base64 は元サイズの約1.33倍になる）
const INLINE_LIMIT_BYTES = 14 * 1024 * 1024;
const API_TIMEOUT_MS = 180000;
// ストリーミング中は「最後にデータが届いてから」この時間で打ち切る
const STREAM_IDLE_TIMEOUT_MS = 90000;

// 用途ごとの思考レベル。単純な抽出作業に高レベルの思考は不要で、遅く・高くなるだけ。
// 'minimal' は 3.8 Flash では未対応なので使わない。
const THINKING_BY_PURPOSE = { fast: 'low', normal: null, deep: 'high' };

// ============================================================
// AI の単価と概算コスト（利用量表示用）
// ------------------------------------------------------------
// 単価は Google 公式料金ページ（ai.google.dev/pricing）で
// 2026-10-27 に確認した公開価格（USD / 100万トークン、標準料金）。
// 期間で単価が変わるモデルは until（その日まで適用）で切り替える。
// 円換算は 1ドル=155円 の概算レート。あくまで目安の表示であり、
// 実際の請求は Google 側の明細が正。
// ============================================================
const AI_USD_JPY = 155;
const AI_PRICES = {
  'gemini-4-argon':       [{ until: '2026-11-30', input: 2.00, output: 10.00 }, { until: null, input: 4.00, output: 20.00 }],
  'gemini-3.8-flash':     [{ until: '2026-12-31', input: 0.75, output: 3.75 }, { until: null, input: 1.50, output: 7.50 }],
  'gemini-3.6-flash':     [{ until: null, input: 0.75, output: 3.75 }],
  'gemini-3.5-flash-lite': [{ until: null, input: 0.10, output: 0.40 }],
  'gemini-3.1-pro-preview': [{ until: null, input: 2.00, output: 12.00 }],
  'gemini-2.5-flash':     [{ until: null, input: 0.30, output: 2.50 }]
};
const AiCost = {
  // その日付に効く単価。表に無いモデルは Flash 系として概算する
  priceFor: (model, dateStr) => {
    const tiers = AI_PRICES[model] || AI_PRICES['gemini-3.8-flash'];
    for (const t of tiers) { if (!t.until || (dateStr || '') <= t.until) return t; }
    return tiers[tiers.length - 1];
  },
  // 概算コスト（円）。dateStr は単価の期間判定用（省略時は今日）
  estimateYen: (model, inTok, outTok, dateStr) => {
    const p = AiCost.priceFor(model, dateStr || new Date().toISOString().slice(0, 10));
    return ((Number(inTok) || 0) * p.input + (Number(outTok) || 0) * p.output) / 1000000 * AI_USD_JPY;
  }
};

// ============================================================
// モデルの「おまかせ（自動）」振り分け
// ------------------------------------------------------------
// モードは端末ごとの localStorage 'jukenAiModelMode'（'auto' |
// 'manual'）。キーが無い端末では、モデルを保存したことがあれば
// 手動（その選択を尊重）、無ければ自動を既定とする。
// 自動の割り当て:
//   fast（抽出・要約・分類などの軽い処理）… 最も安い Flash Lite
//   normal / deep（コーチ・チャットの本生成）… 既定モデル
// Argon などの高額モデルは、手動で明示選択したときだけ使う。
// 手動モードでは従来どおり保存済みモデルをそのまま使う。
// ============================================================
const AiModelMode = {
  KEY: 'jukenAiModelMode',
  AUTO_LIGHT_MODEL: 'gemini-3.5-flash-lite',
  get: () => {
    try {
      const v = localStorage.getItem(AiModelMode.KEY);
      if (v === 'auto' || v === 'manual') return v;
    } catch (e) { /* 読めなければ自動扱い */ }
    try { return localStorage.getItem('geminiModel') ? 'manual' : 'auto'; } catch (e) { return 'auto'; }
  },
  set: (mode) => { try { localStorage.setItem(AiModelMode.KEY, mode); } catch (e) {} },
  // 自動モードでの割り当て（純粋関数寄り・テスト対象）
  autoModelFor: (purpose) => purpose === 'fast' ? AiModelMode.AUTO_LIGHT_MODEL : DEFAULT_MODEL,
  // 実際に使うモデルの解決。manual なら従来の getModel()、auto なら用途で振り分け
  resolve: (purpose) => AiModelMode.get() === 'manual'
    ? AiService.getModel()
    : AiModelMode.autoModelFor(purpose),
  // 設定画面に出す説明文
  describe: () => AiModelMode.get() === 'manual'
    ? '手動で選んだモデルを常に使います'
    : 'おまかせ中：軽い処理（抽出・要約など）は ' + AiModelMode.AUTO_LIGHT_MODEL + '、コーチやチャットの生成は ' + DEFAULT_MODEL + ' を使います。高額モデル（Argon 等）は自動では使いません'
};

// ============================================================
// AI 中継（Vercel Functions /api/gemini）クライアント
// ------------------------------------------------------------
// Vercel 上ではサーバー側がキーを持って中継するので、端末に
// キーが無くても AI 機能が使える。中継が無い環境（GitHub Pages
// では /api/gemini が 404/405 になる）や、中継にキーが未設定の
// ときは、このセッションでは中継を使わないと覚えて従来の
// 直接呼び出し（localStorage のキー）にフォールバックする。
// ============================================================
const AiProxy = {
  endpoint: '/api/gemini',
  // 'unknown' | 'ok' | 'down'（セッション内だけの判定メモ）
  state: 'unknown',
  // Vercel Functions のリクエスト上限（4.5MB）に収まる範囲だけ中継を使う。
  // 大きな画像添付などは最初から直接呼び出しにする
  MAX_BODY_BYTES: 4 * 1024 * 1024,

  shouldTry: (bodyStr) => AiProxy.state !== 'down' && (bodyStr || '').length <= AiProxy.MAX_BODY_BYTES,

  buildBody: (model, payload, stream) => ({ model, stream: !!stream, payload }),

  // 中継のエラーを「直接呼び出しに切り替えるべきか」で分類する（純粋関数・テスト対象）
  // status: HTTPステータス, errStatus: 中継のエラーコード, hasKey: 端末にキーがあるか
  decide: ({ status, errStatus, hasKey }) => {
    if (errStatus === 'PROXY_NOT_CONFIGURED') return 'fallback'; // サーバー未設定 → 直接へ
    if (status === 404 || status === 405 || status === 501) return 'fallback'; // 中継が存在しない環境
    if ((errStatus === 'PROXY_UPSTREAM' || errStatus === 'PROXY_TOO_LARGE') && hasKey) return 'fallback';
    return 'return';
  },

  // 中継で実際に呼んでみる。使えなければ null（＝直接へ）、
  // 中継からの応答（成功・Gemini のエラーとも）があればその Response を返す
  tryFetch: async (model, payload, { stream = false, signal = null } = {}) => {
    let res;
    try {
      res = await AiService._fetchWithTimeout(AiProxy.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(AiProxy.buildBody(model, payload, stream))
      }, { stream, signal });
    } catch (e) {
      if (e.kind === 'abort') throw e; // 中断・タイムアウトは中継の失敗ではない
      return null; // 通信自体ができない → 直接で正規のエラーを出す
    }
    const isProxy = res.headers.get('x-ai-proxy') === '1';
    if (!isProxy) {
      // 中継ではない応答（Pages の 404/405 ページ等）
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        AiProxy.state = 'down';
        try { res.body?.cancel(); } catch (e) { /* noop */ }
        return null;
      }
      return res;
    }
    if (res.ok) { AiProxy.state = 'ok'; return res; }
    // 中継側のエラーは本文（小さいJSON）を覗いて切り替え判定する
    let errStatus = '';
    try { const ej = await res.clone().json(); errStatus = ej?.error?.status || ''; } catch (e) { /* 本文なし */ }
    const d = AiProxy.decide({ status: res.status, errStatus, hasKey: !!AiService.getKey() });
    if (d === 'fallback') {
      if (errStatus === 'PROXY_NOT_CONFIGURED' || res.status === 404 || res.status === 405) AiProxy.state = 'down';
      try { res.body?.cancel(); } catch (e) { /* noop */ }
      return null;
    }
    AiProxy.state = 'ok';
    return res;
  }
};

const AiService = {
  getModel: () => {
    const sel = document.getElementById('set-model')?.value || '';
    if (AVAILABLE_MODELS.includes(sel)) return sel;
    const saved = localStorage.getItem('geminiModel') || '';
    if (AVAILABLE_MODELS.includes(saved)) return saved;
    return DEFAULT_MODEL;
  },
  getKey: () => (document.getElementById('set-api-key')?.value || localStorage.getItem('geminiApiKey') || '').trim(),

  // 応答から本文テキストを取り出す。Gemini 3系は parts が複数に分かれたり
  // 先頭が thought パートになることがあるため、parts[0] 決め打ちにはしない
  extractText: (cand) => {
    const parts = cand?.content?.parts || [];
    return parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
  },
  // Web検索の出典（groundingMetadata）を [{title, uri}] に整形。重複URLは除去
  extractSources: (cand) => {
    const chunks = cand?.groundingMetadata?.groundingChunks || [];
    const seen = new Set();
    const out = [];
    for (const c of chunks) {
      const uri = c?.web?.uri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      out.push({ title: c.web.title || uri.replace(/^https?:\/\//, '').split('/')[0], uri });
    }
    return out;
  },

  buildUrl: (model, stream) => {
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;
  },

  // タイムアウトと中断を管理して fetch する共通部分。
  // 失敗は e.kind（'abort' | 'network'）付きで投げ、呼び出し側が
  // 「中継が使えないだけか、本当の通信エラーか」を判別できるようにする
  _fetchWithTimeout: async (url, init, { stream = false, signal = null } = {}) => {
    const ctrl = new AbortController();
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    const timer = stream ? null : setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      const err = new Error(e.name === 'AbortError'
        ? 'AIの応答が時間内に返りませんでした。もう一度お試しください。'
        : 'ネットワークに接続できませんでした。通信環境を確認してください。');
      err.kind = e.name === 'AbortError' ? 'abort' : 'network';
      throw err;
    } finally { if (timer) clearTimeout(timer); }
  },

  // 従来経路: 端末に保存したキーで Gemini API を直接呼ぶ
  fetchDirect: async (model, payload, body, { stream = false, signal = null } = {}) => {
    const apiKey = AiService.getKey();
    if (!apiKey) throw new Error('⚙️設定タブからGemini APIキーを入力してください。');
    // APIキーはURLではなくヘッダーで送る（履歴・Referer・プロキシログへの流出を防ぐ）
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
    return AiService._fetchWithTimeout(AiService.buildUrl(model, stream), {
      method: 'POST', headers, body
    }, { stream, signal });
  },

  fetchOnce: async (model, payload, { stream = false, signal = null } = {}) => {
    const body = JSON.stringify(payload);
    // まず同一オリジンの中継（Vercel）を試す。使えればキー不要。
    // 中継が無い環境（GitHub Pages 等）では従来の直接呼び出しに戻る
    if (AiProxy.shouldTry(body)) {
      const proxied = await AiProxy.tryFetch(model, payload, { stream, signal });
      if (proxied) return proxied;
    }
    return AiService.fetchDirect(model, payload, body, { stream, signal });
  },

  // HTTPエラーを日本語の原因つき例外に変換する。再試行が必要な場合は
  // { retry: 'noSearch' | 'noThinking' | 'backoff' } を返す
  classifyError: (status, detail, { withSearch, withThinking }) => {
    // 無料枠のキーで有料専用モデル（Gemini 4 Argon など）を呼ぶと、回数オーバーと同じ429などで「上限0」と返ってくる。
    // 「1分待って」と案内すると何度試しても通らないので、モデルを変えるよう伝える
    if ((status === 429 || status === 403 || status === 400) && /free[_ -]?tier|limit:\s*0\b|billing|paid tier/i.test(detail || '')) {
      return { msg: 'このモデルは無料枠のAPIキーでは使えません（有料プランのみ）。⚙️設定タブで Gemini 3.8 Flash などに戻してください。' };
    }
    if (status === 429) return { msg: 'APIの利用制限（回数オーバー）です。約1分ほど待ってからもう一度試してください🙏' };
    if (status === 401 || status === 403) return { msg: 'APIキーが無効か、権限がありません。⚙️設定タブでキーを確認してください。' };
    if (status === 404) return { msg: 'モデルが利用できません（提供終了の可能性）。⚙️設定タブでモデルを変更してください。' };
    if (status === 400) {
      // Gemini はキーが不正でも 401/403 ではなく 400 を返す。英語のまま出すと原因が伝わらない
      if (/api[_ ]?key|API_KEY_INVALID|api key not valid/i.test(detail)) {
        return { msg: 'APIキーが正しくありません。⚙️設定タブでキーを確認してください。' };
      }
      if (withThinking && /thinking|thought/i.test(detail)) return { retry: 'noThinking' };
      if (withSearch && /tool|search|function/i.test(detail)) return { retry: 'noSearch' };
      if (/size|too large|exceeds|payload/i.test(detail)) return { msg: '送信データが大きすぎます。添付ファイルを小さくするか、新しいチャットを始めてください。' };
      return { msg: 'リクエストが拒否されました: ' + (detail || '400 Bad Request') };
    }
    if (status === 503 || status === 500) return { retry: 'backoff' };
    return { msg: `APIエラー: ${status}${detail ? ' - ' + detail : ''}` };
  },

  // finishReason から「本文が空だった理由」を日本語にする
  emptyReason: (cand) => {
    const reason = cand?.finishReason || 'UNKNOWN';
    if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT') return '安全フィルターによりブロックされました。質問の内容を変えてお試しください。';
    if (reason === 'MAX_TOKENS') return '回答が長すぎて途中で打ち切られました。質問を分けてお試しください。';
    if (reason === 'RECITATION') return '著作物の引用と判定されたため回答が中断されました。質問を言い換えてお試しください。';
    return 'AIからの回答が空でした。（理由: ' + reason + '）';
  },

  // ===== 明示的コンテキストキャッシュ =====
  // 毎回同じ長い前提（生徒データなど）を送るとき、サーバー側に預けておいて
  // 「このIDの続きから」と指示すると入力トークンが割り引かれる。
  // 失敗しても致命的ではないので、そのときは普通に全文を送る方式へ黙って戻す。
  _cache: { name: null, key: null, expiresAt: 0, disabled: false },
  hashText: (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + '_' + s.length;
  },
  // 小さすぎる前提はキャッシュの最低トークン数に届かないので作らない
  CACHE_MIN_CHARS: 8000,
  CACHE_TTL_SEC: 3600,
  // ⚠️ 明示キャッシュは既定オフ。
  // 保存料が時間課金なので、1時間に数回しか質問しない使い方だと通常送信より高くつく。
  // 「不変部分を先頭に置く」並び順だけで暗黙キャッシュの割引は効くため、まずはそれで十分。
  // 1日に何十回も連投するようになったら true にする。
  USE_EXPLICIT_CACHE: false,
  ensureCache: async (stableText, model) => {
    const c = AiService._cache;
    if (c.disabled || !stableText || stableText.length < AiService.CACHE_MIN_CHARS) return null;
    if (NO_EXPLICIT_CACHE_MODELS.includes(model)) return null;
    if (!AiService.getKey()) return null;      // キー未設定でキャッシュを試すと400で永久に無効化されてしまう
    const key = model + ':' + AiService.hashText(stableText);
    if (c.name && c.key === key && Date.now() < c.expiresAt - 60000) return c.name;
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/cachedContents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': AiService.getKey() },
        body: JSON.stringify({
          model: 'models/' + model,
          systemInstruction: { parts: [{ text: stableText }] },
          ttl: AiService.CACHE_TTL_SEC + 's'
        })
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        // このモデルが未対応 / 最低トークン数に届かない → このセッションではもう試さない。
        // ただしキーが悪いだけの400で無効化すると、キーを直しても再読み込みまで戻らない
        const keyIssue = /api[_ ]?key|API_KEY_INVALID|api key not valid|permission/i.test(t);
        if ((res.status === 400 || res.status === 404) && !keyIssue) AiService._cache.disabled = true;
        console.warn('📦 コンテキストキャッシュを作れませんでした（通常送信に戻します）:', res.status, t.slice(0, 200));
        return null;
      }
      const data = await res.json();
      c.name = data.name; c.key = key;
      c.expiresAt = data.expireTime ? Date.parse(data.expireTime) : Date.now() + AiService.CACHE_TTL_SEC * 1000;
      console.log('📦 コンテキストキャッシュ作成:', c.name);
      return c.name;
    } catch (e) {
      console.warn('📦 キャッシュ作成に失敗（通常送信に戻します）', e.message);
      return null;
    }
  },

  buildPayload: ({ prompt, system, fileData, forceJson, history, withSearch, thinkingLevel, model, maxOutputTokens, cachedContent }) => {
    const contents = [...(history || [])];
    // cachedContent を使うときは systemInstruction を送れない。
    // 毎回変わる前提（今日の日付・今日の学習・指示文・教材の抜粋）はここで質問の前に入れる。
    // これを落とすと「今日の評価」なのに今日の情報が無い、という事故になる。
    const head = (cachedContent && system) ? '【今回の前提（毎回変わる情報）】\n' + system + '\n\n【質問】\n' : '';
    const parts = [{ text: head + prompt }];
    // fileData は単体でも配列でもよい（複数ページのノートをまとめて送る用）
    for (const f of [].concat(fileData || [])) {
      if (f?.base64) parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } });
    }
    contents.push({ role: 'user', parts });

    const payload = { contents };
    // cachedContent を使うときは、前提（systemInstruction）はキャッシュ側に入っている
    if (cachedContent) payload.cachedContent = cachedContent;
    else payload.systemInstruction = { parts: [{ text: system }] };
    if (withSearch) payload.tools = [{ googleSearch: {} }];
    const gc = {};
    // googleSearch と responseMimeType:json は併用できない
    if (forceJson && !withSearch) gc.responseMimeType = 'application/json';
    if (thinkingLevel && supportsThinkingLevel(model)) gc.thinkingConfig = { thinkingLevel };
    // 出力の上限。指定しないと長考・長文で無駄にトークンを使うことがある
    if (maxOutputTokens) gc.maxOutputTokens = maxOutputTokens;
    if (Object.keys(gc).length) payload.generationConfig = gc;
    return payload;
  },

  // 中心となる実行関数。{ text, sources } を返す。
  // onChunk を渡すとストリーミングで、受信のたびに onChunk(累積テキスト) を呼ぶ。
  request: async (opts) => {
    const {
      prompt, system, fileData = null, forceJson = false, useSearch = false,
      history = [], purpose = 'normal', onChunk = null, signal = null,
      systemStable = null, maxOutputTokens = null,
      _retryCount = 0, _noSearch = false, _noThinking = false, _model = null, _noCache = false
    } = opts;

    // モデルは用途で解決する（おまかせ自動 or 手動選択）。再試行で _model が
    // 指定されている場合（フォールバック先など）はそちらを常に優先する
    const model = _model || AiModelMode.resolve(purpose);
    const withSearch = useSearch && !_noSearch;
    const thinkingLevel = _noThinking ? null : THINKING_BY_PURPOSE[purpose];

    // 長い前提（systemStable）はサーバー側に預けて使い回す。
    // Web検索ツールを使うときはキャッシュと併用できないので、そのときは従来どおり全文を送る。
    let cachedContent = null;
    if (AiService.USE_EXPLICIT_CACHE && systemStable && !withSearch && !_noCache) {
      cachedContent = await AiService.ensureCache(systemStable, model);
    }
    const sys = cachedContent ? system : [systemStable, system].filter(Boolean).join('\n\n');

    const payload = AiService.buildPayload({ prompt, system: sys, fileData, forceJson, history, withSearch, thinkingLevel, model, maxOutputTokens, cachedContent });
    const stream = !!onChunk;

    const res = await AiService.fetchOnce(model, payload, { stream, signal });
    if (!res.ok) {
      let detail = '';
      try { const ej = await res.json(); detail = (Array.isArray(ej) ? ej[0]?.error?.message : ej?.error?.message) || ''; } catch (e) { /* 本文なし */ }
      // キャッシュが期限切れ・削除済みのときは、キャッシュ無しで送り直せば通る
      if (cachedContent && /cachedcontent|cached_content|cache/i.test(detail)) {
        console.warn('📦 キャッシュが使えないため通常送信で再試行:', detail);
        AiService._cache.name = null;
        return AiService.request({ ...opts, _noCache: true });
      }
      const c = AiService.classifyError(res.status, detail, { withSearch, withThinking: !!thinkingLevel });

      if (c.retry === 'noThinking') {
        console.warn('⚠️ thinkingLevel 非対応のため無効化して再試行:', detail);
        return AiService.request({ ...opts, _noThinking: true });
      }
      if (c.retry === 'noSearch') {
        console.warn('⚠️ Web検索ツールが使えないため検索なしで再試行:', detail);
        return AiService.request({ ...opts, _noSearch: true });
      }
      if (c.retry === 'backoff') {
        if (_retryCount < 2) {
          await new Promise(r => setTimeout(r, 2000 * (_retryCount + 1)));
          return AiService.request({ ...opts, _retryCount: _retryCount + 1 });
        }
        for (const fb of FALLBACK_MODELS) {
          if (fb === model) continue;
          console.warn('⚠️ ' + model + ' が' + res.status + 'のためフォールバック: ' + fb);
          try {
            return await AiService.request({ ...opts, _model: fb, _retryCount: 0 });
          } catch (e) { /* 次の候補へ */ }
        }
        throw new Error('AIサーバーが混雑中です（' + model + ' ' + res.status + '）。しばらく待ってから再試行してください。');
      }
      throw new Error(c.msg.startsWith('モデルが') ? c.msg.replace('モデルが', `モデル「${model}」が`) : c.msg);
    }

    return stream ? await AiService.readStream(res, onChunk) : await AiService.readWhole(res);
  },

  readWhole: async (res) => {
    const data = await res.json();
    if (data.promptFeedback?.blockReason) throw new Error('安全フィルターによりブロックされました（' + data.promptFeedback.blockReason + '）。内容を変えてお試しください。');
    if (!data.candidates || data.candidates.length === 0) throw new Error('AIからの回答が空でした。');
    const cand = data.candidates[0];
    const text = AiService.extractText(cand);
    if (!text) throw new Error(AiService.emptyReason(cand));
    return { text, sources: AiService.extractSources(cand) };
  },

  // Server-Sent Events を読みながら、届いたテキストを逐次 onChunk に流す
  readStream: async (res, onChunk) => {
    if (!res.body) throw new Error('このブラウザはストリーミングに対応していません。');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', text = '', lastCand = null, blockReason = '';
    const sourceMap = new Map();
    let idleTimer = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { try { reader.cancel(); } catch (e) {} }, STREAM_IDLE_TIMEOUT_MS);
    };
    resetIdle();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const body = line.slice(5).trim();
          if (!body || body === '[DONE]') continue;
          let obj; try { obj = JSON.parse(body); } catch (e) { continue; }
          if (obj.promptFeedback?.blockReason) blockReason = obj.promptFeedback.blockReason;
          const cand = obj.candidates?.[0];
          if (!cand) continue;
          lastCand = cand;
          const piece = AiService.extractText(cand);
          if (piece) { text += piece; onChunk(text); }
          for (const s of AiService.extractSources(cand)) sourceMap.set(s.uri, s);
        }
      }
    } finally { if (idleTimer) clearTimeout(idleTimer); }

    if (blockReason) throw new Error('安全フィルターによりブロックされました（' + blockReason + '）。内容を変えてお試しください。');
    if (!text.trim()) throw new Error(AiService.emptyReason(lastCand));
    return { text: text.trim(), sources: [...sourceMap.values()] };
  },

  // 既存の呼び出し側との互換用。テキストだけを返す
  call: async (prompt, system, fileData = null, forceJson = false, useSearch = false, history = [], purpose = 'normal') => {
    const { text } = await AiService.request({ prompt, system, fileData, forceJson, useSearch, history, purpose });
    return text;
  },

  // 🔎 Web検索した結果を、出典つきでJSONとして受け取る
  //
  // 「JSONだけ出力して」と指示すると、モデルは検索ツールを使わずに
  // 記憶だけで答えてしまい、出典（groundingMetadata）が付かない。
  // ボーダーや配点は外れると困る情報なので、
  //   1回目: 文章で調べさせる（ここで実際に検索が走り、出典が付く）
  //   2回目: その文章からJSONを抜き出すだけ（検索なし・低思考なので速くて安い）
  // の2段構えにして、必ず出典が残るようにする。
  //
  // さらに、1回の検索では見つからない項目が残りやすいので、
  //   ・出典が1件も付かなかった（＝検索せずに記憶で答えた）ときは検索を強制してやり直す
  //   ・required で指定した項目が空のままなら、その項目だけを狙って追加で調べ直す
  // ことで、空欄をできるだけ残さないようにする。
  //
  // opts:
  //   system      … 調査役の人格（省略時は受験情報の調査AI）
  //   withContext … true ならアプリ内の全データを調査役に渡す
  //   required    … { キー: '日本語の項目名' }。空なら追加調査の対象になる
  //   maxRounds   … 追加調査の最大回数
  //   onProgress  … 進行状況の文言を受け取るコールバック
  //   requireSources … true なら、出典が付かなかったときに検索を強制してやり直す
  researchJson: async ({ question, format, purpose = 'normal', system = null, withContext = false, required = null, maxRounds = 2, onProgress = null, requireSources = true }) => {
    const say = (t) => { try { onProgress && onProgress(t); } catch (e) {} };
    let sys = system || ('最新の受験情報をWeb検索で調べて、根拠とともに日本語で説明するAIです。\n'
      + '・必ずGoogle検索ツールを使い、大学公式サイト・募集要項・予備校（河合塾Kei-Net、駿台、東進、パスナビ等）など複数の情報源で裏を取ること。\n'
      + '・記憶だけで答えないこと。検索しても見つからなかった項目は「見つからなかった」と正直に書くこと。\n'
      + '・今年度の情報が未公表で前年度の実績を示す場合は、必ず「前年度実績」と明記すること。推測した部分は「推測」と明記すること。\n'
      + '・日付は年を省略せず「2027年2月25日」のように書くこと。');
    if (withContext && typeof getComprehensiveContext === 'function') {
      try { sys += '\n\n【この生徒のアプリ内の全データ（参考）】\n' + getComprehensiveContext(); } catch (e) { console.warn('コンテキスト生成に失敗', e); }
    }

    const sourceMap = new Map();
    const addSources = (list) => (list || []).forEach(s => { if (s?.uri && !sourceMap.has(s.uri)) sourceMap.set(s.uri, s); });
    const researches = [];

    say('🔍 Web検索中...');
    let first = await AiService.request({ prompt: question, system: sys, useSearch: true, purpose });
    // 出典なし＝検索せずに答えた可能性が高い。検索を明示的に要求してもう一度だけ試す
    if (requireSources && !first.sources.length) {
      say('🔍 出典が無いため再検索中...');
      try {
        const again = await AiService.request({
          prompt: question + '\n\n※必ずGoogle検索ツールを実行し、検索結果に基づいて答えてください。記憶だけで答えてはいけません。',
          system: sys, useSearch: true, purpose
        });
        if (again.sources.length) first = again;
      } catch (e) { /* 1回目の結果をそのまま使う */ }
    }
    researches.push(first.text); addSources(first.sources);

    const extract = async () => {
      say('🧩 調査結果を整理中...');
      const raw = await AiService.call(
        `次の調査結果から、指定のJSON形式でデータを抜き出してください。\n`
        + `・調査結果に書かれていない値は勝手に作らず、文字列なら空文字、数値なら0、配列なら空配列にすること。\n`
        + `・日付は必ず YYYY-MM-DD 形式にすること。年が書かれていない日付は使わないこと。\n`
        + `・複数の調査結果で値が食い違う場合は、大学公式・今年度の情報を優先すること。\n`
        + `・JSON以外は一切出力しないこと。\n\n【JSON形式】\n${format}\n\n【調査結果】\n${researches.join('\n\n----- 追加調査 -----\n\n')}`,
        'JSONのみを出力するAIです。', null, true, false, [], 'fast');
      return AiService.extractJson(raw);
    };
    const isBlank = (v) => v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0);
    const missingOf = (d) => required ? Object.keys(required).filter(k => isBlank(d?.[k])) : [];

    let data = await extract();
    let missing = missingOf(data);
    for (let round = 0; round < maxRounds && missing.length; round++) {
      say(`🔍 見つからなかった${missing.length}項目を追加調査中...（${round + 1}/${maxRounds}）`);
      try {
        const more = await AiService.request({
          prompt: `${question}\n\n前回の調査では次の項目が分かりませんでした：\n${missing.map(k => '・' + required[k]).join('\n')}\n\n`
            + `別の検索語・別の情報源（大学公式の募集要項PDF、入試情報ページ、パスナビ、Kei-Net、旺文社、前年度の募集要項など）を当たり、これらの項目だけを重点的に調べてください。\n`
            + `今年度の情報がまだ公表されていない場合は、前年度の実績を「前年度実績」と明記して示してください。それでも見つからない項目は「見つからなかった」と書いてください。`,
          system: sys, useSearch: true, purpose
        });
        researches.push(more.text); addSources(more.sources);
        const merged = await extract();
        // 前回取れていた値は消さない（追加調査で抜け落ちることがあるため）
        Object.keys(data || {}).forEach(k => { if (isBlank(merged[k]) && !isBlank(data[k])) merged[k] = data[k]; });
        data = merged;
        missing = missingOf(data);
      } catch (e) { console.warn('追加調査に失敗', e); break; }
    }
    return { data, sources: [...sourceMap.values()], research: researches.join('\n\n'), missing };
  },
  // 入試年度（4月以降は翌年、1〜3月はその年）。例: 2026年9月→2027年度、2027年2月→2027年度
  admissionYear: (d = new Date()) => d.getFullYear() + (d.getMonth() >= 3 ? 1 : 0),
  extractJson: (text) => {
    try {
      let cleanText = text.replace(/```json|```/gi, '').trim();
      const match = cleanText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      return JSON.parse(cleanText);
    } catch (e) { throw new Error('AIがデータを正しく作成できませんでした。'); }
  }
};

const readAsBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.readAsDataURL(blob);
  reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = error => reject(error);
});

// 送信前に画像を縮小する。スマホの写真は1枚10MB超になることがあり、
// そのまま送ると遅い・高い・20MB上限に当たる。手書きOCRの精度を保てる
// 長辺2000px / JPEG品質0.88 まで落とす（PDFとGIFは加工しない）。
const MAX_IMAGE_DIM = 2000;
const IMAGE_QUALITY = 0.88;

const compressImage = (file) => new Promise((resolve) => {
  const fallback = async () => resolve({ blob: file, mimeType: file.type });
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return fallback();
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
      // 縮小が不要で、もともと十分小さいならそのまま使う
      if (scale === 1 && file.size <= 2 * 1024 * 1024) { URL.revokeObjectURL(url); return fallback(); }
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((blob) => {
        URL.revokeObjectURL(url);
        // 圧縮して逆に大きくなった場合は元を使う
        if (!blob || blob.size >= file.size) return fallback();
        resolve({ blob, mimeType: 'image/jpeg' });
      }, 'image/jpeg', IMAGE_QUALITY);
    } catch (e) { URL.revokeObjectURL(url); fallback(); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); fallback(); };
  img.src = url;
});

// ファイル → 送信用 {base64, mimeType}（画像は自動で圧縮）
const prepareFileData = async (file) => {
  const { blob, mimeType } = await compressImage(file);
  if (blob.size > INLINE_LIMIT_BYTES) {
    throw new Error('圧縮しても14MBを超えました（' + (blob.size/1024/1024).toFixed(1) + 'MB）。もっと小さいファイルを選んでください。');
  }
  return { base64: await readAsBase64(blob), mimeType, size: blob.size, originalSize: file.size };
};

// 既存コードとの互換（圧縮なしでbase64化）
const getBase64 = (file) => readAsBase64(file);

// 添付ファイルの事前チェック（形式・サイズ）。問題があればトーストを出して false を返す
const validateUpload = (file) => {
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  if (!isImage && !isPdf) { showToast('画像（JPG/PNG/GIF/WebP）またはPDFを選択してください', 'warn'); return false; }
  // 画像は送信前に縮小するので元ファイルは大きくてもよい。PDFは加工できないため上限そのまま
  const limit = isImage ? 40 * 1024 * 1024 : INLINE_LIMIT_BYTES;
  if (file.size > limit) {
    const limitMB = Math.round(limit / 1024 / 1024);
    showToast(`ファイルは${limitMB}MB以下にしてください（現在 ` + (file.size/1024/1024).toFixed(1) + 'MB）', 'warn'); return false;
  }
  return true;
};

const stripHtml = (html) => { let tmp = document.createElement("DIV"); tmp.innerHTML = html; return tmp.textContent || tmp.innerText || ""; };

// 💡 今日の学習時間を取得
const getTodayMinutes = () => {
  const dStr = DateManager.getTodayStr();
  return S.dailyLogs[dStr]?.total || 0;
};

// 💡 全ての学習記録から正確な総学習時間を計算する関数
const calcTotalMinutes = () => {
  let total = 0;
  if (S.dailyLogs) {
    Object.values(S.dailyLogs).forEach(log => {
      if (log.total) total += log.total;
    });
  }
  return total;
};

const calcStreak = () => {
  let streak = 0; const todayStr = DateManager.getTodayStr(); 
  let cd = DateManager.parseSafe(todayStr);
  if (!(S.dailyLogs[DateManager.getTodayStr(cd)]?.total > 0)) cd.setDate(cd.getDate() - 1);
  for(let i=0; i<730; i++) {
     if(S.dailyLogs[DateManager.getTodayStr(cd)]?.total > 0) { streak++; cd.setDate(cd.getDate() - 1); } 
     else break;
  }
  return streak;
};

