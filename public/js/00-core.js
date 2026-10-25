// ============================================================
// CORE ARCHITECTURE & UTILITIES
// ============================================================

// 🛡️ XSS防止用エスケープ関数
const esc = (s) => {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

// 🔗 リンク先URLの安全化
// AIが返す出典URLをそのまま href に入れると、javascript: や data: を踏まされたときに
// このアプリのオリジン（＝Firestoreのデータやローカル保存のAPIキーが読める場所）で
// スクリプトが動いてしまう。http/https 以外は握りつぶす。
const safeUrl = (u) => {
  const s = String(u ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  try { const p = new URL(s); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : ''; }
  catch (e) { return ''; }
};

// 🔗 出典リンクの共通描画。
// http/https 以外はリンクにせず文字として出す（safeUrl 参照）。
// 出典が1件も無いときは「AIの記憶による回答かもしれない」と明示する。
const renderSourceChips = (sources, label = '出典', emptyNote = 'Web検索の出典が取得できませんでした。AIの推測が含まれる可能性があるため、必ず大学公式や河合塾などで確認してください。') => {
  const list = sources || [];
  if (!list.length) {
    return emptyNote ? `<div style="font-size:10px;color:var(--a2);margin-top:8px">⚠️ ${esc(emptyNote)}</div>` : '';
  }
  const chips = list.map((s, i) => {
    const url = safeUrl(s.uri);
    const text = `[${i + 1}] ${esc(s.title)}`;
    return url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="src-chip">${text}</a>`
      : `<span class="src-chip" title="開けないURLのためリンクにしていません">${text}</span>`;
  }).join('');
  return `<div class="cb-sources"><div class="cb-sources-label">🔗 ${esc(label)}（${DateManager.getTodayStr()} 取得）</div>${chips}</div>`;
};

// 🗄️ 画像など大きいデータの保管庫（IndexedDB）
// localStorage（約5MB）にも Firestore（1ドキュメント1MB）にも入らないので別管理にする。
// 端末ローカル専用なので、機種変更時は引き継がれない。
const Blobs = {
  _db: null,
  open: () => new Promise((resolve, reject) => {
    if (Blobs._db) return resolve(Blobs._db);
    if (!window.indexedDB) return reject(new Error('IndexedDB非対応'));
    const req = indexedDB.open('jukenBlobs', 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files'); };
    req.onsuccess = () => { Blobs._db = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error);
  }),
  _tx: async (mode, fn) => {
    const db = await Blobs.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  set: async (key, value) => { try { return await Blobs._tx('readwrite', st => st.put(value, key)); } catch (e) { console.warn('Blobs.set失敗', e); } },
  get: async (key) => { try { return await Blobs._tx('readonly', st => st.get(key)); } catch (e) { return undefined; } },
  del: async (key) => { try { return await Blobs._tx('readwrite', st => st.delete(key)); } catch (e) {} },
  keys: async () => { try { return await Blobs._tx('readonly', st => st.getAllKeys()) || []; } catch (e) { return []; } }
};

// ローマ数字→算用数字。「数学Ⅱ」と「数学2」を同じ語として扱うために必要。
// NFKC だと Ⅱ は "II" になってしまい 2 とは一致しないので、NFKC より先に置き換える。
const ROMAN_NUM = { 'Ⅰ':'1','Ⅱ':'2','Ⅲ':'3','Ⅳ':'4','Ⅴ':'5','Ⅵ':'6','Ⅶ':'7','Ⅷ':'8','Ⅸ':'9','Ⅹ':'10','Ⅺ':'11','Ⅻ':'12',
                    'ⅰ':'1','ⅱ':'2','ⅲ':'3','ⅳ':'4','ⅴ':'5','ⅵ':'6','ⅶ':'7','ⅷ':'8','ⅸ':'9','ⅹ':'10','ⅺ':'11','ⅻ':'12' };

// 🔤 あいまい検索用の正規化：ローマ数字→数字、全角→半角、カタカナ→ひらがな、大文字→小文字、記号と空白を除去
const normalizeForSearch = (s) => String(s ?? '')
  .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ]/g, c => ROMAN_NUM[c])
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
  .replace(/[\s　.,、。・･ー\-_/（）()「」『』"']/g, '');

// クエリの文字が順番どおりに現れるか（部分一致より緩い「とびとび一致」）
const fuzzyMatch = (text, query) => {
  const t = normalizeForSearch(text), q = normalizeForSearch(query);
  if (!q) return true;
  if (t.includes(q)) return true;
  if (q.length < 2) return false;
  let i = 0;
  for (const ch of t) { if (ch === q[i]) i++; if (i === q.length) return true; }
  return false;
};

// ⑳ トースト通知
const showToast = (msg, type = 'success', duration = 3000) => {
  const c = document.getElementById('toast-container');
  if (!c) { console.log(msg); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => { requestAnimationFrame(() => { t.classList.add('show'); }); });
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, duration);
};

// 🛡️ confirm() の代替：アプリ内確認モーダル
const showConfirm = (title, msg, okLabel, okCallback) => {
  document.getElementById('mo-confirm-title').textContent = title;
  document.getElementById('mo-confirm-msg').textContent = msg;
  const okBtn = document.getElementById('mo-confirm-ok');
  okBtn.textContent = okLabel || '削除する';
  okBtn.onclick = () => { closeMo('mo-confirm'); okCallback(); };
  showMo('mo-confirm');
};

// 📅 日付管理モジュール（タイムゾーンの脆弱性を排除）
const DateManager = {
  getTodayStr: (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },
  // 'YYYY-MM-DD' を安全にローカルのDateオブジェクトに変換（T00:00:00等のハックを排除）
  // 壊れた文字列を「今日」として扱うと、壊れた日別ログが今日の集計に混入するため、無効な日付を返す。
  // 呼び出し側は isNaN で判定できる。
  parseSafe: (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return new Date(NaN);
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(NaN);
    if (!parts.every(p => /^\d+$/.test(p))) return new Date(NaN);
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, day = parseInt(parts[2], 10);
    const d = new Date(y, m, day);
    // 2月30日 → 3月2日 のような繰り上がりは無効とする
    if (d.getFullYear() !== y || d.getMonth() !== m || d.getDate() !== day) return new Date(NaN);
    return d;
  },
  daysBetween: (targetDateStr) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = DateManager.parseSafe(targetDateStr);
    return Math.ceil((target - today) / 864e5);
  },
  formatHours: (min) => {
    if (isNaN(min) || min <= 0) return '0m';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return m + 'm';
    if (m === 0) return h + 'h';
    return h + 'h' + m + 'm';
  },
  formatDays: (d) => d > 0 ? d + '日' : d === 0 ? '今日!' : '終了'
};

