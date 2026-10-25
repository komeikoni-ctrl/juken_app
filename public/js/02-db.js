// ============================================================
// FIREBASE DATABASE SERVICE（localStorage自動フォールバック付き）
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyAqvY2gfztJvOsyxPnrfw11nAD8FocvNgU", authDomain: "juken2027-63058.firebaseapp.com",
  projectId: "juken2027-63058", storageBucket: "juken2027-63058.firebasestorage.app",
  messagingSenderId: "476160146486", appId: "1:476160146486:web:81461a827d2e3a50f1ec97"
};

const generateId = () => 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2);

// 同名タスクの重複除去（Firebase sync 競合対策）
const deduplicateTasks = () => {
  const seen = new Map();
  const toDelete = [];
  // done のタスクを優先して残す
  // 対象は自動生成の【復習】【予習】タスクだけ。
  // 手で入れた同名タスク（期限違いの「単語帳」など）まで消すと、入れたはずのタスクが黙って無くなる。
  [...S.tasks].filter(t => /^【(復習|予習)】/.test(String(t.text || ''))).sort((a,b) => (b.done ? 1 : 0) - (a.done ? 1 : 0)).forEach(t => {
    if (seen.has(t.text)) {
      toDelete.push(t.id);
    } else {
      seen.set(t.text, t.id);
    }
  });
  if (toDelete.length > 0) {
    toDelete.forEach(id => DbService.del('tasks', id));
    S.tasks = S.tasks.filter(t => !toDelete.includes(t.id));
  }
};
const lsSave = () => {
  try {
    const toSave = {...S};
    delete toSave.calMonth;
    // chatHistoryのfileData.base64はlocalStorageに保存しない（容量超過防止）
    if (toSave.chatHistory) {
      toSave.chatHistory = toSave.chatHistory.map(m =>
        m.fileData ? {...m, fileData: {...m.fileData, base64: undefined}} : m
      );
    }
    localStorage.setItem('jukenAppData2027', JSON.stringify(toSave));
  } catch(e) {}
};

let db = null;
// 開発用：localhost で ?sandbox=1 を付けて開いたときだけ、本番とは別のドキュメントに読み書きする
// （動作確認のテストデータで本番のデータを汚さないため）
const IS_SANDBOX = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('sandbox');
const DOC_ID = IS_SANDBOX ? "sandbox_test_data" : "perfect_sync_data_2027";

// Firestore のサブコレクションとして1件ずつ同期する配列（S[名前]）
const SYNC_COLS = ['tasks','events','unis','mocks','timerLogs','notes','chatHistory','homework','mockSchedule','specials','extras','applications','pastExams','trash'];
// 端末ごとの画面状態。同期すると、別の端末で開いているタブや月に引きずられてしまう
const LOCAL_ONLY_KEYS = ['calMonth','currentPage','weekOffset'];
// プロフィール（appData/DOC_ID 本体）として送る部分だけを取り出す
const profileForServer = () => {
  const p = { ...S };
  [...SYNC_COLS, 'dailyLogs', ...LOCAL_ONLY_KEYS].forEach(k => delete p[k]);
  return p;
};

// Firebase に繋がらない状態（SDKの読み込み失敗など）で行った変更の控え。
// 次に繋がったとき、サーバーの内容で上書きされる前にこちらを先に送る。
const Pending = {
  _get: (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } },
  _set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  // 同じ削除を何度も積まない（送信失敗のたびに積み直すため）
  addDel: (col, id) => { const a = Pending._get('jukenPendingDel'); if (a.some(d => d.col === col && String(d.id) === String(id))) return; a.push({ col, id: String(id) }); Pending._set('jukenPendingDel', a.slice(-500)); },
  takeDels: () => { const a = Pending._get('jukenPendingDel'); localStorage.removeItem('jukenPendingDel'); return a; },
  addLog: (dKey) => { const a = Pending._get('jukenPendingLogs'); if (!a.includes(dKey)) a.push(dKey); Pending._set('jukenPendingLogs', a); },
  takeLogs: () => { const a = Pending._get('jukenPendingLogs'); localStorage.removeItem('jukenPendingLogs'); return a; },
  // 覗くだけ（消さない）。送信に成功したものだけ removeDel / removeLog で消す。
  // 取り出してから送ると、送信中に失敗・終了したとき控えが失われるため。
  peekDels: () => Pending._get('jukenPendingDel'),
  peekLogs: () => Pending._get('jukenPendingLogs'),
  removeDel: (col, id) => Pending._set('jukenPendingDel', Pending._get('jukenPendingDel').filter(d => !(d.col === col && String(d.id) === String(id)))),
  removeLog: (dKey) => Pending._set('jukenPendingLogs', Pending._get('jukenPendingLogs').filter(k => k !== dKey)),
  markProfile: () => { try { localStorage.setItem('jukenPendingProfile', '1'); } catch (e) {} },
  takeProfile: () => { const v = localStorage.getItem('jukenPendingProfile') === '1'; localStorage.removeItem('jukenPendingProfile'); return v; }
};

// この端末を識別するID。どの端末が最後に書いたかを判定して同期の取りこぼしを防ぐ
const DEVICE_ID = (() => {
  let id = localStorage.getItem('jukenDeviceId');
  if (!id) { id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('jukenDeviceId', id); }
  return id;
})();

// 🔄 同期状態インジケータ
const SyncStatus = {
  state: 'local',   // local | syncing | synced | offline | error
  detail: '',
  set: (state, detail = '') => {
    SyncStatus.state = state; SyncStatus.detail = detail;
    const el = document.getElementById('sync-indicator');
    if (!el) return;
    const map = {
      local:   ['💾', 'この端末のみ', 'var(--muted)'],
      syncing: ['🔄', '同期中...',    'var(--accent)'],
      synced:  ['☁️', '同期済み',     'var(--muted)'],
      offline: ['📴', 'オフライン',   '#b45309'],
      error:   ['⚠️', '同期エラー',   'var(--a2)']
    };
    const [icon, label, color] = map[state] || map.local;
    el.innerHTML = `<span title="${esc(detail || label)}" style="color:${color};font-size:11px;white-space:nowrap">${icon} ${label}</span>`;
  }
};
window.addEventListener('online',  () => { if (db) SyncStatus.set('syncing', 'オンラインに復帰しました'); });
window.addEventListener('offline', () => SyncStatus.set('offline', 'ネットワークがありません'));

// Firebase初期化（失敗してもアプリは動く）
try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    // undefined を含むオブジェクトを書こうとすると Firestore は例外を投げ、その1件が同期されなくなる。
    // （AIが一部のキーを返さなかった場合などに起きる）undefined は単に無視させる。
    try { db.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) { console.warn('Firestore設定に失敗', e.message); }
    // オフライン中の書き込みを端末内に保持し、アプリを閉じても次回オンライン時に送れるようにする。
    // これが無いと、圏外で入力→アプリを閉じる→次回起動時にサーバーの古い内容で上書きされて消える。
    db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('オフライン永続化は使えません:', e.code || e.message));
    console.log('✅ Firebase接続成功 - クラウド同期が有効です' + (IS_SANDBOX ? '（🧪 サンドボックス）' : ''));
    SyncStatus.set('syncing');
  }
} catch(e) {
  console.warn('Firebase初期化失敗、ローカルモードで動作:', e.message);
  SyncStatus.set('local', e.message);
}

// ローカルで最後に書き込んだ時刻。これより古いリモート更新は無視して「巻き戻り」を防ぐ
let lastLocalWriteAt = 0;
// プロフィール本体を最後に書いた時刻。巻き戻り判定にはこちらを使う
// （タスクなど一覧データの書き込み時刻で判定すると、無関係な書き込みのせいで他端末の設定変更を取りこぼす）
let lastProfileWriteAt = 0;
// クラウドのプロフィールを一度でも受け取ったか。受け取るまではプロフィールを書き込まない
let _profileReady = false;
let _profileWriteQueued = false;
const _queuedReplaceFields = new Set();

const DbService = {
  // サーバーへ送る形に整える。端末内だけの印（_dirty）と、1MB上限に入らない添付の中身を落とす
  _forServer: (col, item) => {
    const out = { ...item };
    delete out._dirty;
    if (col === 'chatHistory' && out.fileData) {
      const { base64, ...rest } = out.fileData;   // 中身は BlobSync が分割して別に送る
      out.fileData = { ...rest, hasFile: true };
    }
    return out;
  },
  // 成功（または控えに積んで後で送る）なら true、送信失敗なら false を返す
  setMainProfile: async () => {
    lsSave();
    if (!db) { Pending.markProfile(); return true; }
    // クラウドの内容をまだ一度も受け取っていないうちは書き込まない。
    // 新しい端末では S が初期値のままなので、ここで書くとクラウドの設定（名前・目標点・時間割など）を
    // 初期値で上書きしてしまう。最初の受信が済んだ直後にまとめて送る（initRealtimeSync 参照）。
    if (!_profileReady) {
      _profileWriteQueued = true;
      // 圏外のまま使い続けた場合は、次に繋がったときこの端末の変更を優先して送る
      if (!navigator.onLine) Pending.markProfile();
      return true;
    }
    const p = profileForServer();
    lastLocalWriteAt = lastProfileWriteAt = Date.now();
    // どの端末がいつ書いたかを残す（他端末の古い上書きを検出するため）
    p._writer = DEVICE_ID;
    p._writtenAt = lastLocalWriteAt;
    SyncStatus.set('syncing');
    try { await db.collection('appData').doc(DOC_ID).set(p, {merge:true}); SyncStatus.set('synced'); return true; }
    catch(e){ SyncStatus.set(navigator.onLine ? 'error' : 'offline', e.message); return false; }
  },
  set: async (col, item) => {
    if (!item.id) item.id = generateId();
    // 未接続のあいだの変更には印を付けておき、次に繋がったときに送る（reconcileLocal 参照）
    if (!db) { item._dirty = true; lsSave(); return true; }
    lastLocalWriteAt = Date.now();
    item._writer = DEVICE_ID; item._writtenAt = lastLocalWriteAt;
    delete item._dirty;
    lsSave();
    SyncStatus.set('syncing');
    try { await db.collection('appData').doc(DOC_ID).collection(col).doc(item.id.toString()).set(DbService._forServer(col, item)); SyncStatus.set('synced'); return true; }
    catch(e){
      // 送れなかった項目には未送信の印を付け直し、次の同期で送り直す（reconcileLocal 参照）
      item._dirty = true; lsSave();
      SyncStatus.set(navigator.onLine ? 'error' : 'offline', e.message);
      return false;
    }
  },
  del: async (col, id) => {
    lsSave();
    if (id == null) return true;
    if (!db) { Pending.addDel(col, id); return true; }
    lastLocalWriteAt = Date.now();
    SyncStatus.set('syncing');
    try { await db.collection('appData').doc(DOC_ID).collection(col).doc(id.toString()).delete(); SyncStatus.set('synced'); return true; }
    catch(e){
      SyncStatus.set(navigator.onLine ? 'error' : 'offline', e.message);
      // 削除に失敗したら控えに積み、flushPendingWrites で送り直す（放置すると次の同期で復活する）
      Pending.addDel(col, id);
      return false;
    }
  },
  setDailyLog: async (dKey) => {
    lsSave();
    if (!dKey) return true;
    if (!db) { Pending.addLog(dKey); return true; }
    try {
      const ref = db.collection('appData').doc(DOC_ID).collection('dailyLogs').doc(dKey);
      // ローカルで消した日（または中身が空になった日）はサーバーからも消す。
      // 残しておくと次の同期で復活し、0分の日としてグラフに出続ける。
      const lg = S.dailyLogs[dKey];
      if (!lg || (!(lg.total > 0) && !Object.keys(lg.subjects || {}).length)) await ref.delete();
      else await ref.set(lg);
      return true;
    } catch(e){
      console.warn('日別ログの同期に失敗', dKey, e.message);
      // 控えに積み直し、次の flushPendingWrites で送り直す
      Pending.addLog(dKey);
      return false;
    }
  },
  // プロフィール内のマップ項目を「丸ごと差し替える」。
  // setMainProfile は set(..., {merge:true}) なので、ローカルでキーを消しても
  // サーバー側には残り続け、次の同期で復活してしまう（科目名を消しても戻ってくる原因）。
  // update() にオブジェクトを渡すとそのフィールドごと置き換わるので、削除が反映される。
  replaceField: async (field, value) => {
    lsSave();
    if (!db) { Pending.markProfile(); return true; }
    if (!_profileReady) { _profileWriteQueued = true; _queuedReplaceFields.add(field); return true; }
    lastLocalWriteAt = lastProfileWriteAt = Date.now();
    try { await db.collection('appData').doc(DOC_ID).update({ [field]: value, _writer: DEVICE_ID, _writtenAt: lastLocalWriteAt }); return true; }
    catch(e){
      console.warn('replaceField失敗', field, e.message);
      // まだ本体ドキュメントが無い（初回）場合は update が失敗するので、通常の保存に切り替える
      if (e.code === 'not-found') return await DbService.setMainProfile();
      return false;
    }
  },
  migrateLocalData: async () => {
    if (!db) return;
    if (localStorage.getItem('migrated_to_split_db_final') === 'true') return;
    const local = localStorage.getItem('jukenAppData2027');
    // 新しい端末（端末内にデータが無い）は移行するものが無い。ここで印を付けておかないと、
    // 2回目の起動時に「同期で受け取った手元のコピー」を旧データと誤認して丸ごと再アップロードし、
    // 他の端末で消したデータが復活したり、新しい編集が古い内容で上書きされたりする。
    if (!local) { localStorage.setItem('migrated_to_split_db_final', 'true'); return; }
    // クラウドに既にデータがあるなら、そちらが正。手元のコピーで上書きしない
    try {
      const existing = await db.collection('appData').doc(DOC_ID).get();
      if (existing.exists) { localStorage.setItem('migrated_to_split_db_final', 'true'); return; }
    } catch (e) { return; }   // 確認できないとき（オフライン等）は何もしない。次回の起動でやり直す
    const oldS = Store.safeState(JSON.parse(local));
    Object.assign(S, oldS);
    S.calMonth = new Date(); // calMonthはUI状態のみ（永続化しない）
    await DbService.setMainProfile();
    for (const col of SYNC_COLS) {
      if (S[col]) for (const item of S[col]) {
        if (!item.id) item.id = generateId();
        if (col==='chatHistory' && !item.timestamp) item.timestamp = Date.now() + Math.random();
        await DbService.set(col, item);
      }
    }
    if (S.dailyLogs) for (const dKey in S.dailyLogs) await DbService.setDailyLog(dKey);
    localStorage.setItem('migrated_to_split_db_final', 'true');
  }
};

// Firestore の同期は、後続のJSファイルが読み込まれる前に返ってくることがある。
// （1ファイルだった頃は起こらなかったが、ファイルを分割したことで実際に起きるようになった）
// その時点では描画関数がまだ存在しないので、直接呼ばずにここを通す。
// まだ無ければ「あとで描き直す」印だけ付けておき、起動完了時にまとめて反映する。
let _needsRefreshAfterBoot = false;
const doRefresh = () => { try { refreshAllViews(); } catch (e) { console.warn('描画に失敗', e); } };
const safeRefresh = () => {
  if (typeof refreshAllViews === 'function') doRefresh();
  else _needsRefreshAfterBoot = true;   // まだ描画関数が無いので、起動後にまとめて反映する
};
// 起動完了後に、取りこぼした描画を反映する
const flushPendingRefresh = () => {
  if (!_needsRefreshAfterBoot) return;
  _needsRefreshAfterBoot = false;
  if (typeof refreshAllViews === 'function') doRefresh();
};

// 未接続のあいだに行った変更を、サーバーの内容を受け取る前に送っておく。
// 控えは覗くだけで取り出し、送信に成功したものだけを控えから消す（途中で失敗しても控えが残る）。
const flushPendingWrites = async () => {
  if (!db) return;
  try {
    for (const d of Pending.peekDels()) { if (await DbService.del(d.col, d.id)) Pending.removeDel(d.col, d.id); }
    for (const dKey of Pending.peekLogs()) { if (await DbService.setDailyLog(dKey)) Pending.removeLog(dKey); }
    // プロフィール（設定・時間割など）の未送信分は、最初の受信のときに扱う（initRealtimeSync 参照）
  } catch (e) { console.warn('未送信データの送信に失敗', e); }
};

// サーバーから届いた一覧に、この端末だけが持つ未送信の変更（_dirty）を合流させる。
// これをしないと、未接続のあいだに追加・編集した内容が最初の同期で消えてしまう。
const _reconciledCols = new Set();
const reconcileLocal = (col, serverItems) => {
  const dirty = (S[col] || []).filter(x => x && x.id && x._dirty);
  if (!dirty.length) return serverItems;
  const byId = new Map(serverItems.map(x => [String(x.id), x]));
  dirty.forEach(item => { byId.set(String(item.id), item); DbService.set(col, item); });
  return [...byId.values()];
};

let unsubscribes = [];
const initRealtimeSync = () => {
  if (!db) return;
  unsubscribes.forEach(u => u()); unsubscribes = [];
  // includeMetadataChanges: まだドキュメントが無い新規ユーザーの場合、「キャッシュに無い」→「サーバーにも無い」の
  // 変化は中身が同じなので通常は通知されない。これを受け取らないと、いつまでも「受信待ち」のままになる。
  let _lastProfileStamp = '';
  unsubscribes.push(db.collection('appData').doc(DOC_ID).onSnapshot({ includeMetadataChanges: true }, doc => {
    // 自分が書いた内容がそのまま返ってくる「エコー」は無視する。
    // 反映するとユーザーが入力中の値を古い値で上書きしてしまうことがある。
    if (doc.metadata.hasPendingWrites) return;
    // 中身が変わっていない通知（キャッシュ→サーバー確認済み、など）で何度も描き直さない
    const stamp = doc.exists ? (doc.data()._writtenAt || '') + ':' + (doc.data()._writer || '') : 'none';
    if (_profileReady && stamp === _lastProfileStamp) return;
    _lastProfileStamp = stamp;
    // 「クラウドの内容を受け取れた」と言えるのは、ドキュメントが届いたか、サーバーに聞いて無いと分かったとき
    const firstTime = !_profileReady;
    const ready = doc.exists || !doc.metadata.fromCache;
    // 未接続のあいだにこの端末で設定を変えていた場合は、最初の1回だけ手元を優先して送る
    const localWins = firstTime && ready && Pending.takeProfile();
    if (firstTime && ready) {
      // 受信内容を S に反映し終えてから、待たせていた書き込みを送る
      setTimeout(() => {
        _profileReady = true;
        if (_profileWriteQueued || localWins) {
          _profileWriteQueued = false;
          DbService.setMainProfile();
          // merge 保存ではマップ内の削除が伝わらないので、該当フィールドは丸ごと差し替える
          if (localWins) _queuedReplaceFields.add('timetable');
          _queuedReplaceFields.forEach(fld => DbService.replaceField(fld, S[fld] ?? {}));
          _queuedReplaceFields.clear();
        }
      }, 0);
    }
    if (doc.exists && !localWins) {
      const data = doc.data();
      // 他端末が書いた内容でも、こちらの直近の編集より古いなら適用しない（巻き戻り防止）。
      // 最初の受信では必ず適用する（新しい端末の初期値でクラウドの設定を潰さないため）
      if (!firstTime && data._writer && data._writer !== DEVICE_ID && data._writtenAt && data._writtenAt < lastProfileWriteAt) {
        console.warn('⏪ 古いリモート更新を無視しました', new Date(data._writtenAt).toLocaleString('ja-JP'));
        return;
      }
      // コレクション管理のフィールドと、端末ごとの画面状態は上書きしない
      const collectionKeys = new Set([...SYNC_COLS, 'dailyLogs', ...LOCAL_ONLY_KEYS]);
      // 下の4つは dailyLogs から計算できる「集計結果」。
      // サーバーの古い値を受け取ると、せっかく直した集計がまた壊れるので受け取らない。
      // 各端末が dailyLogs から同じ値を計算するので、同期する必要もない。
      const derivedKeys = new Set(['studyTime','totalMinutes','weekdayTime','monthlyTime']);
      // マップ型フィールドは中身がある場合のみ上書き（空で消えるのを防止）。
      // 配列（repeatEvents など）は対象にしない。配列の [] は「最後の1件を消した」という正しい状態で、
      // これを無視すると、消したはずの予定が別の端末から書き戻されて復活する。
      const objectFields = new Set(['timetable','scoreTargets']);
      Object.keys(data).forEach(k => {
        if (collectionKeys.has(k) || derivedKeys.has(k) || k === '_writer' || k === '_writtenAt' || k === '__probe') return;
        const v = data[k];
        // Firestoreのタイムスタンプ型を変換
        const val = (v && typeof v.toDate === 'function') ? v.toDate() : v;
        // timetable等は受信値が空オブジェクトの場合、既存データを保持
        if (objectFields.has(k) && val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0 && S[k] && Object.keys(S[k]).length > 0) return;
        S[k] = val;
      });
      // チャットのスレッドが0件になると画面が壊れるので、必ず1件は持たせる
      if (!Array.isArray(S.chatThreads) || !S.chatThreads.length) S.chatThreads = [{ id: 'th_default', title: 'メインチャット', updatedAt: Date.now() }];
      if (!S.chatThreads.some(t => t.id === window.currentChatThreadId)) window.currentChatThreadId = S.chatThreads[0].id;
      SyncStatus.set('synced');
      safeRefresh();
    }
  }, err => SyncStatus.set('error', err.message)));
  SYNC_COLS.forEach(col => {
    unsubscribes.push(db.collection('appData').doc(DOC_ID).collection(col).onSnapshot(snap => {
      // 端末内キャッシュが空なだけ（まだサーバーに聞けていない）の状態で、手元のデータを消さない
      if (snap.metadata.fromCache && snap.empty && (S[col] || []).length) return;
      let items = snap.docs.map(d => d.data());
      // サーバーと初めて突き合わせるときに、未送信の変更を合流させる
      if (!snap.metadata.fromCache && !_reconciledCols.has(col)) { _reconciledCols.add(col); items = reconcileLocal(col, items); }
      if (col === 'chatHistory') {
        // 添付ファイルの中身はサーバーに置いていないので、メモリ上に持っている分を引き継ぐ
        const local = new Map((S.chatHistory || []).filter(m => m.fileData?.base64).map(m => [m.id, m.fileData.base64]));
        items.forEach(m => { if (m.fileData && !m.fileData.base64 && local.has(m.id)) m.fileData.base64 = local.get(m.id); });
      }
      S[col] = items;
      if (col === 'chatHistory') S[col].sort((a,b) => (a.timestamp||0) - (b.timestamp||0));
      // サーバーからはID順（＝古い順）で届く。画面は新しい順を前提にしているので並べ直す
      if (col === 'timerLogs') S[col].sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')) || String(b.id).localeCompare(String(a.id)));
      if (col === 'mocks') S[col].sort((a,b) => String(a.date||'').localeCompare(String(b.date||'')));
      if (col === 'trash') S[col].sort((a,b) => (b.deletedAt||0) - (a.deletedAt||0));
      // id は 'id_1700000000_abc' 形式の文字列なので引き算すると NaN になり並び順が壊れる。
      // 日付→書込時刻の順で新しい順に並べる。
      if (col === 'notes') S[col].sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')) || (b._writtenAt||0) - (a._writtenAt||0));
      // tasks 同期後は重複タスクをその場で除去
      if (col === 'tasks') deduplicateTasks();
      SyncStatus.set('synced');
      safeRefresh();
    }, err => SyncStatus.set('error', err.message)));
  });
  unsubscribes.push(db.collection('appData').doc(DOC_ID).collection('dailyLogs').onSnapshot(snap => {
    if (snap.metadata.fromCache && snap.empty && Object.keys(S.dailyLogs || {}).length) return;
    S.dailyLogs = {};
    snap.docs.forEach(d => {
      const lg = d.data() || {};
      // 古いデータには subjects が無いものがあり、グラフ描画が例外で止まる原因になる
      if (!lg.subjects || typeof lg.subjects !== 'object') lg.subjects = {};
      lg.total = Number(lg.total) || 0;
      S.dailyLogs[d.id] = lg;
    });
    // 日別ログが届いたら、そこから集計を組み直す（他端末の記録もこれで反映される）
    if (typeof rebuildStudyTotals === 'function') { try { rebuildStudyTotals({ persist: false }); } catch (e) { console.warn('集計の再構築に失敗', e); } }
    safeRefresh();
  }, err => SyncStatus.set('error', err.message)));
};

// ============================================================
// 🗑️ ゴミ箱（削除したデータを30日間保持して復元できるようにする）
// ============================================================
const TRASH_KEEP_DAYS = 30;
// ゴミ箱も S.trash として他のデータと同じ仕組みで同期する
// （以前は端末の localStorage だけにあり、スマホで消したものをPCで復元できなかった）
const Trash = {
  load: () => Array.isArray(S.trash) ? S.trash : (S.trash = []),
  push: (col, item) => {
    if (!item) return;
    const trashId = generateId();
    // item は複製して持つ（元のオブジェクトがあとで書き換わってもゴミ箱の中身が変わらないように）
    const entry = { id: trashId, trashId, col, item: JSON.parse(JSON.stringify(DbService._forServer(col, item))), deletedAt: Date.now() };
    Trash.load().unshift(entry);
    DbService.set('trash', entry);
    Trash.purge();
  },
  // 30日を過ぎたものを落とす。件数も上限200件で打ち切る
  purge: () => {
    const limit = Date.now() - TRASH_KEEP_DAYS * 86400000;
    const arr = Trash.load();
    const kept = arr.filter(e => e.deletedAt > limit).slice(0, 200);
    if (kept.length !== arr.length) {
      const keepIds = new Set(kept.map(e => e.id));
      arr.filter(e => !keepIds.has(e.id)).forEach(e => DbService.del('trash', e.id));
      S.trash = kept;
    }
    return S.trash;
  },
  restore: (trashId) => {
    const entry = Trash.load().find(e => e.trashId === trashId);
    if (!entry) return false;
    if (!Array.isArray(S[entry.col])) S[entry.col] = [];
    // 同じIDが既にあれば重複させない
    const already = S[entry.col].some(x => x.id === entry.item.id);
    if (!already) S[entry.col].unshift(entry.item);
    DbService.set(entry.col, entry.item);
    // 学習記録は削除時に集計から引いているので、戻すときに足し直す（これをしないと時間だけ消えたままになる）
    if (!already && entry.col === 'timerLogs' && typeof recordStudy === 'function') recordStudy(entry.item.subj, entry.item.min, entry.item.date);
    S.trash = Trash.load().filter(e => e.trashId !== trashId);
    DbService.del('trash', entry.id || trashId);
    safeRefresh();
    return true;
  },
  empty: () => { Trash.load().forEach(e => DbService.del('trash', e.id || e.trashId)); S.trash = []; lsSave(); }
};
// 旧形式（localStorage の jukenTrash）からの引っ越し。1回だけ動く
(() => {
  try {
    const old = JSON.parse(localStorage.getItem('jukenTrash') || '[]');
    if (Array.isArray(old) && old.length) {
      old.forEach(e => {
        if (!e || !e.trashId || Trash.load().some(x => x.trashId === e.trashId)) return;
        const entry = { ...e, id: e.trashId };
        S.trash.push(entry); DbService.set('trash', entry);
      });
    }
    localStorage.removeItem('jukenTrash');
  } catch (e) { /* 壊れていたら諦める */ }
})();

// ============================================================
// 🖼️ 画像・PDFの同期（ノートの元画像、チャットの添付）
// Firestore は1ドキュメント1MBまでなので、base64 を分割して blobChunks に置く。
// 一覧の同期には載せず、必要になったとき（元画像を開いたとき）にだけ取りに行く。
// ============================================================
const BlobSync = {
  CHUNK: 900000,                    // 1チャンクの文字数（base64はASCIIなので文字数＝バイト数）
  MAX_TOTAL: 10 * 1024 * 1024,      // これを超えるものは同期しない（端末内にのみ保存）
  _col: () => db.collection('appData').doc(DOC_ID).collection('blobChunks'),
  _uploaded: () => { try { return new Set(JSON.parse(localStorage.getItem('jukenBlobUploaded') || '[]')); } catch (e) { return new Set(); } },
  _markUploaded: (key) => { try { const s = BlobSync._uploaded(); s.add(key); localStorage.setItem('jukenBlobUploaded', JSON.stringify([...s].slice(-2000))); } catch (e) {} },

  // files: [{ mimeType, base64 }]
  upload: async (key, files) => {
    if (!db || !key || !Array.isArray(files) || !files.length) return false;
    const total = files.reduce((s, f) => s + (f.base64 || '').length, 0);
    if (!total || total > BlobSync.MAX_TOTAL) { if (total) console.warn('🖼️ 大きすぎるため同期しません（端末内のみ）:', key, (total / 1024 / 1024).toFixed(1) + 'MB'); return false; }
    try {
      const manifest = [];
      for (let fi = 0; fi < files.length; fi++) {
        const b = files[fi].base64 || '';
        const n = Math.ceil(b.length / BlobSync.CHUNK);
        manifest.push({ mimeType: files[fi].mimeType || 'image/jpeg', chunks: n });
        for (let ci = 0; ci < n; ci++) {
          await BlobSync._col().doc(`${key}__${fi}__${ci}`).set({ key, fi, ci, data: b.slice(ci * BlobSync.CHUNK, (ci + 1) * BlobSync.CHUNK) });
        }
      }
      // 目録は最後に書く（途中で失敗したものを「ある」と誤認させないため）
      await BlobSync._col().doc(`${key}__manifest`).set({ key, manifest, _writer: DEVICE_ID, _writtenAt: Date.now() });
      BlobSync._markUploaded(key);
      return true;
    } catch (e) { console.warn('🖼️ 画像の同期に失敗', key, e.message); return false; }
  },
  download: async (key) => {
    if (!db || !key) return null;
    try {
      const m = await BlobSync._col().doc(`${key}__manifest`).get();
      if (!m.exists) return null;
      const out = [];
      const manifest = m.data().manifest || [];
      for (let fi = 0; fi < manifest.length; fi++) {
        let b = '';
        for (let ci = 0; ci < manifest[fi].chunks; ci++) {
          const c = await BlobSync._col().doc(`${key}__${fi}__${ci}`).get();
          if (!c.exists) return null;   // 欠けていたら壊れた画像を出さない
          b += c.data().data || '';
        }
        out.push({ mimeType: manifest[fi].mimeType, base64: b });
      }
      return out;
    } catch (e) { console.warn('🖼️ 画像の取得に失敗', key, e.message); return null; }
  },
  remove: async (key) => {
    if (!db || !key) return;
    try {
      const snap = await BlobSync._col().where('key', '==', key).get();
      await Promise.all(snap.docs.map(d => d.ref.delete()));
    } catch (e) { console.warn('🖼️ 画像の削除に失敗', key, e.message); }
  },
  // 端末内 → 無ければクラウド、の順で探す。クラウドから取れたら端末内にも保存しておく
  fetch: async (key) => {
    const local = await Blobs.get(key);
    if (local && local.length) return local;
    const remote = await BlobSync.download(key);
    if (remote && remote.length) { await Blobs.set(key, remote); BlobSync._markUploaded(key); }
    return remote;
  },
  // 保存と同期をまとめて行う
  save: async (key, files) => { await Blobs.set(key, files); return BlobSync.upload(key, files); },
  // この機能が入る前にスキャンしたノート画像など、端末内にしか無いものを少しずつクラウドへ上げる
  backfill: async () => {
    if (!db || !navigator.onLine) return;
    try {
      const done = BlobSync._uploaded();
      const keys = (await Blobs.keys()).filter(k => typeof k === 'string' && /^(note|chat)_/.test(k) && !done.has(k));
      for (const key of keys.slice(0, 20)) {
        const noteId = key.replace(/^(note|chat)_/, '');
        const alive = key.startsWith('note_') ? (S.notes || []).some(n => String(n.id) === noteId) : (S.chatHistory || []).some(m => String(m.id) === noteId);
        if (!alive) continue;
        const m = await BlobSync._col().doc(`${key}__manifest`).get();
        if (m.exists) { BlobSync._markUploaded(key); continue; }
        const files = await Blobs.get(key);
        if (files && files.length) await BlobSync.upload(key, files);
      }
    } catch (e) { console.warn('🖼️ 画像の追い同期に失敗', e.message); }
  }
};

// ============================================================
// 💾 自動バックアップ（週1回、直近4世代を端末内に保持）
// ============================================================
const Backup = {
  snapshot: () => {
    const p = { ...S };
    delete p.calMonth;
    // 画像のbase64は容量が大きいので除外する
    if (p.chatHistory) p.chatHistory = p.chatHistory.map(m => m.fileData ? { ...m, fileData: { ...m.fileData, base64: undefined } } : m);
    return { version: APP_VERSION, createdAt: Date.now(), date: DateManager.getTodayStr(), data: p };
  },
  run: async (force = false) => {
    const last = +(localStorage.getItem('jukenLastBackupAt') || 0);
    if (!force && Date.now() - last < 7 * 86400000) return false;
    try {
      const snap = Backup.snapshot();
      const list = (await Blobs.get('backups')) || [];
      list.unshift(snap);
      await Blobs.set('backups', list.slice(0, 4));   // 直近4世代だけ残す
      localStorage.setItem('jukenLastBackupAt', String(Date.now()));
      console.log('💾 自動バックアップを作成しました');
      // 端末内とは別にクラウドにも残す。失敗したことは呼び出し側に伝える（黙って成功扱いにしない）
      const cloud = await Backup.saveCloud(snap);
      if (cloud === false) { console.warn('💾 端末内バックアップは作成しましたが、クラウド保存に失敗しました'); return false; }
      return true;
    } catch (e) { console.warn('バックアップ失敗', e); return false; }
  },
  // JSON の UTF-8 バイト数。日本語は1文字3バイトになるので文字数とは一致しない
  _cloudJsonBytes: (json) => new TextEncoder().encode(json).length,
  // Firestore の1ドキュメント上限（1MiB）を超えそうか
  _tooBigForCloud: (json) => Backup._cloudJsonBytes(json) > 800000,
  // クラウド（Firestore）にも同じスナップショットを残す。URL移行時の引き継ぎ用。
  // DOC_ID を使うので、サンドボックス時はサンドボックス側にだけ書かれる。
  // 戻り値: null = 試みなかった / true = 保存した / false = 失敗・容量超過でスキップ
  saveCloud: async (snap) => {
    if (!db || !snap) return null;
    // クラウドの内容をまだ受け取っていない端末では書かない（setMainProfile と同じガード）。
    // 新しい端末の初回起動で、ほぼ空のスナップショットがクラウドのバックアップを押し出すのを防ぐ。
    if (!_profileReady) { console.warn('☁️ クラウド未受信のためバックアップのクラウド保存をスキップしました'); return null; }
    try {
      const json = JSON.stringify(snap.data);
      // Firestore の上限はバイト数。文字数で判定すると日本語データで上限超過を見逃す。
      if (Backup._tooBigForCloud(json)) { console.warn('☁️ バックアップが大きいためクラウド保存をスキップしました', Backup._cloudJsonBytes(json)); return false; }
      const col = db.collection('appData').doc(DOC_ID).collection('backups');
      await col.doc(String(snap.createdAt)).set({ version: snap.version, createdAt: snap.createdAt, date: snap.date, json });
      // 最新4件だけ残して古いものを消す
      const qs = await col.orderBy('createdAt', 'desc').get();
      const docs = qs.docs || [];
      await Promise.all(docs.slice(4).map(d => d.ref.delete()));
      return true;
    } catch (e) { console.warn('☁️ クラウドバックアップ失敗', e); return false; }
  },
  // クラウドのバックアップ一覧（新しい順）。取れなければ空配列。
  listCloud: async () => {
    try {
      if (!db) return [];
      const qs = await db.collection('appData').doc(DOC_ID).collection('backups').orderBy('createdAt', 'desc').get();
      const out = [];
      (qs.docs || []).forEach(d => {
        try {
          const v = d.data();
          out.push({ version: v.version, createdAt: v.createdAt, date: v.date, data: JSON.parse(v.json) });
        } catch (e) { /* 壊れた1件は読み飛ばす */ }
      });
      return out;
    } catch (e) { console.warn('☁️ クラウドバックアップの取得に失敗', e); return []; }
  },
  list: async () => (await Blobs.get('backups')) || [],
  download: (snap) => {
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `juken-backup-${snap.date}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
};

(async () => {
  await DbService.migrateLocalData();
  // 同期の開始は、全スクリプトの読み込みが終わってから。
  // 先に始めると、読み込み途中で Firestore の結果が返ってきて、
  // まだ定義されていない描画関数を呼んでしまい、その分の画面更新が失われる。
  // スクリプトは body の末尾にあるので、DOMContentLoaded 時点で全て揃っている。
  const start = async () => {
    await flushPendingWrites();   // 未接続中の変更を、サーバーの内容で上書きされる前に送る
    initRealtimeSync();
    Trash.purge();
    Backup.run();   // 前回から1週間経っていればバックアップを取る
    setTimeout(() => BlobSync.backfill(), 15000);   // 起動直後の通信と重ならないよう少し待つ
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

// アプリ起動時の日付チェックとタスク整理
const initTodayStr = DateManager.getTodayStr();
if (S.lastAppOpenDate !== initTodayStr) {
  S.tasks.forEach(t => { if(t.done) DbService.del('tasks', t.id); });
  S.tasks = S.tasks.filter(t => !t.done);
  S.lastAppOpenDate = initTodayStr;
  S.autoTaskDate = ''; // 日付変更時は生成フラグもリセット
}
// 起動時に既存の重複タスクをクリーンアップ
deduplicateTasks();
// 起動直後に予習復習タスクを生成（Firestoreの同期完了を待つため3秒遅らせる）
setTimeout(autoGenerateDailyTasks, 3000);

let lastSavedProfileStr = JSON.stringify(profileForServer());
let lastRenderedDate = DateManager.getTodayStr(); 

// 5秒に1回の定期保存・日付更新チェック
setInterval(() => {
  const todayStr = DateManager.getTodayStr();
  if (todayStr !== lastRenderedDate) {
     lastRenderedDate = todayStr;
     S.tasks.forEach(t => { if(t.done) DbService.del('tasks', t.id); });
     S.tasks = S.tasks.filter(t => !t.done);
     S.lastAppOpenDate = todayStr;
     S.autoTaskDate = ''; // 日付変更時リセット
     DbService.setMainProfile();
     autoGenerateDailyTasks();
     safeRefresh();
  }
  const tempStr = JSON.stringify(profileForServer());
  if (tempStr !== lastSavedProfileStr) {
    lastSavedProfileStr = tempStr;
    DbService.setMainProfile();   // 端末内への保存（lsSave）もこの中で行われる
  }
}, 5000);

