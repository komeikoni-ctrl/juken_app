// ============================================================
// 起動処理：Service Worker 登録 / 更新通知 / エラーログ / 自己テスト
// このファイルは最後に読み込まれる（他の全ファイルの定義が揃っている前提）
// ============================================================

// ------------------------------------------------------------
// 🐞 エラーログの収集
// 画面が固まったとき「何が起きたか」を後から見られるようにする。
// 外部送信はせず、この端末のlocalStorageに直近50件だけ残す。
// ------------------------------------------------------------
const ErrorLog = {
  KEY: 'jukenErrorLog',
  MAX: 50,
  list: () => { try { return JSON.parse(localStorage.getItem(ErrorLog.KEY) || '[]'); } catch (e) { return []; } },
  push: (entry) => {
    try {
      const arr = ErrorLog.list();
      arr.unshift({ ...entry, at: Date.now(), version: APP_VERSION, page: S?.currentPage || '' });
      localStorage.setItem(ErrorLog.KEY, JSON.stringify(arr.slice(0, ErrorLog.MAX)));
    } catch (e) { /* 容量超過時は諦める */ }
  },
  clear: () => { try { localStorage.removeItem(ErrorLog.KEY); } catch (e) {} },
  // サポートに貼れるテキスト
  asText: () => ErrorLog.list().map(e =>
    `[${new Date(e.at).toLocaleString('ja-JP')}] (v${e.version}/${e.page}) ${e.type}: ${e.message}\n  ${e.source || ''}`
  ).join('\n')
};
window.ErrorLog = ErrorLog;

// ------------------------------------------------------------
// 📡 エラーの自動送信（Vercel版のみ）
// エラーを端末に残すだけでなく、サーバー（/api/error-log）にも
// 送って「どの端末でも起きている問題」を後から確認できるように
// する。送るのはメッセージ・発生箇所・バージョン・ページ名だけ
// （入力内容や個人データは送らない）。GitHub Pages には受け口が
// 無いので送らない。送信は控えめに: 1回の起動で最大10件、同じ
// 内容は1回だけ。
// ------------------------------------------------------------
const ErrorReport = {
  MAX_PER_SESSION: 10,
  _sent: 0,
  _seen: new Set(),
  enabled: () => location.protocol === 'https:' && !location.hostname.endsWith('github.io'),
  // 送信する形に整える（純粋関数・テスト対象）。長さ制限はサーバー側でも担保する
  build: (entry) => ({
    type: String(entry?.type || 'error').slice(0, 30),
    message: String(entry?.message || '').slice(0, 300),
    source: String(entry?.source || '').slice(0, 200),
    version: String(APP_VERSION || '').slice(0, 20),
    page: String(entry?.page || '').slice(0, 40)
  }),
  send: (entry) => {
    try {
      if (!ErrorReport.enabled()) return;
      if (ErrorReport._sent >= ErrorReport.MAX_PER_SESSION) return;
      const body = ErrorReport.build(entry);
      if (!body.message) return;
      const key = body.type + '|' + body.message;
      if (ErrorReport._seen.has(key)) return;
      ErrorReport._seen.add(key);
      ErrorReport._sent++;
      const json = JSON.stringify(body);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/error-log', new Blob([json], { type: 'application/json' }));
      } else {
        fetch('/api/error-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
      }
    } catch (e) { /* 送信の失敗はアプリに影響させない */ }
  }
};
window.ErrorReport = ErrorReport;
// ErrorLog.push の末尾で送るよう差し込む（既存の呼び出し側は無改修）
{
  const _pushOrig = ErrorLog.push;
  ErrorLog.push = (entry) => { _pushOrig(entry); ErrorReport.send({ ...entry, page: (typeof S !== 'undefined' && S?.currentPage) || '' }); };
}

window.addEventListener('error', (ev) => {
  ErrorLog.push({ type: 'error', message: ev.message || String(ev.error), source: `${ev.filename}:${ev.lineno}:${ev.colno}` });
});
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  ErrorLog.push({ type: 'unhandledrejection', message: r?.message || String(r), source: r?.stack?.split('\n')[1]?.trim() || '' });
});

window.renderErrorLog = () => {
  const el = document.getElementById('errorlog-c');
  if (!el) return;
  const list = ErrorLog.list();
  if (!list.length) { el.innerHTML = '<div style="font-size:12px;color:var(--muted)">エラーは記録されていません ✅</div>'; return; }
  el.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">直近 ${list.length} 件（この端末内にのみ保存）</div>`
    + list.slice(0, 10).map(e => `<div class="row" style="padding:6px 0">
        <div style="flex:1;min-width:0">
          <div class="row-title" style="font-size:12px;color:var(--a2);word-break:break-all">${esc(e.message)}</div>
          <div class="row-sub">${new Date(e.at).toLocaleString('ja-JP')} ／ v${esc(e.version)} ／ ${esc(e.source || '')}</div>
        </div></div>`).join('')
    + `<div style="display:flex;gap:8px;margin-top:10px">
         <button class="btn btn-s btn-sm" onclick="copyErrorLog()">📋 コピー</button>
         <button class="btn btn-s btn-sm" style="color:var(--a2)" onclick="ErrorLog.clear();renderErrorLog()">クリア</button>
       </div>`;
};
window.copyErrorLog = async () => {
  try { await navigator.clipboard.writeText(ErrorLog.asText()); showToast('📋 エラーログをコピーしました'); }
  catch (e) { showToast('コピーできませんでした', 'error'); }
};

// ------------------------------------------------------------
// 📦 Service Worker 登録 ＋ 新バージョンの通知
// ------------------------------------------------------------
let _swRegistration = null;

const showUpdateBanner = (worker) => {
  if (document.getElementById('update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.innerHTML = `<span>✨ 新しいバージョンがあります</span>
    <button onclick="applyUpdate()">今すぐ更新</button>
    <button class="ghost" onclick="this.parentElement.remove()">あとで</button>`;
  document.body.appendChild(bar);
  window.applyUpdate = () => {
    // 新しいSWが有効になった瞬間にリロードする。
    // 固定の待ち時間だと、切り替わる前にリロードされて古い版のままバナーがまた出ることがある。
    let reloaded = false;
    const reload = () => { if (reloaded) return; reloaded = true; location.reload(); };
    navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true });
    if (worker) worker.postMessage('SKIP_WAITING');
    setTimeout(reload, 3000);   // 何らかの理由で切り替わりを検知できなかったときの保険
  };
};

const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return;
  // file:// で開いた場合はSWが使えない
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    _swRegistration = reg;

    // すでに待機中の新バージョンがある
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        // controller がある＝初回インストールではなく「更新」
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(nw);
      });
    });

    // 30分ごとに更新を確認する
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    console.log('📦 Service Worker 登録完了');
  } catch (e) {
    console.warn('Service Worker 登録失敗:', e.message);
  }
};

// ------------------------------------------------------------
// 🗑️ ゴミ箱・💾 バックアップの設定画面
// ------------------------------------------------------------
const COL_LABELS = { notes: 'ノート', timerLogs: '学習記録', applications: '出願', tasks: 'タスク', events: '予定', unis: '志望校', mocks: '模試', homework: '宿題', mockSchedule: '模試予定', specials: '特別講習', extras: 'その他の記録', pastExams: '過去問' };

// ------------------------------------------------------------
// 🗑 全データのリセット
// 以前は localStorage を消すだけだったので、クラウド同期が有効だと次の瞬間に全データが戻ってきて、
// 実際に消えるのはAPIキーや端末IDだけ、という逆効果のボタンになっていた。
// 端末内・クラウドの両方を消し、直前の状態は自動バックアップに残す。APIキーは残す。
// ------------------------------------------------------------
window.resetAllData = () => {
  showConfirm('🗑 全データをリセット',
    'この端末とクラウドの全データ（すべての端末で共有している学習記録・予定・出願・チャットなど）を削除します。直前の状態は「💾 バックアップ」に残るので、あとから復元できます。APIキーは残ります。',
    'すべて削除', async () => {
      showToast('🗑 削除中...（画面を閉じないでください）', 'warn', 6000);
      try { await Backup.run(true); } catch (e) {}
      try { unsubscribes.forEach(u => u()); unsubscribes = []; } catch (e) {}
      // クラウドの削除が確認できたか。確認できないまま端末内を消すと、
      // 再読み込み後にクラウドから全データが戻り「リセットしたのに消えていない」状態になる
      let cloudOk = true;
      if (db) {
        try {
          const root = db.collection('appData').doc(DOC_ID);
          const jobs = [];
          for (const col of [...SYNC_COLS, 'dailyLogs', 'blobChunks']) {
            const snap = await root.collection(col).get();
            snap.docs.forEach(d => jobs.push(d.ref.delete()));
          }
          jobs.push(root.delete());
          if (navigator.onLine) {
            const results = await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(() => r(null), 20000))]);
            // 時間切れ、または1件でも失敗したら完了とみなさない
            if (!results || results.some(r => r.status === 'rejected')) cloudOk = false;
          } else {
            cloudOk = false;   // オフラインでは削除の完了を確認できない
          }
        } catch (e) { console.warn('クラウドの削除に失敗', e); cloudOk = false; }
      }
      if (db && !cloudOk) { showToast('⚠️ クラウドの削除が完了しなかったため、リセットを中止しました。通信状態を確認してもう一度お試しください', 'error', 7000); return; }
      const keep = {};
      ['geminiApiKey', 'geminiModel', 'jukenDeviceId', 'jukenLastBackupAt'].forEach(k => { const v = localStorage.getItem(k); if (v != null) keep[k] = v; });
      localStorage.clear();
      Object.keys(keep).forEach(k => localStorage.setItem(k, keep[k]));
      // 初期データを改めて「移行」しないように印を付けておく
      localStorage.setItem('migrated_to_split_db_final', 'true');
      for (const key of await Blobs.keys()) { if (key !== 'backups') await Blobs.del(key); }
      location.reload();
    });
};

window.renderTrash = () => {
  const el = document.getElementById('trash-c');
  if (!el) return;
  const list = Trash.purge();
  if (!list.length) { el.innerHTML = '<div style="font-size:12px;color:var(--muted)">ゴミ箱は空です</div>'; return; }
  el.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">削除から30日以内なら復元できます（${list.length}件）</div>`
    + list.slice(0, 30).map(e => {
        const label = e.item?.title || e.item?.name || e.item?.text || e.item?.subj || '(無題)';
        const days = 30 - Math.floor((Date.now() - e.deletedAt) / 86400000);
        return `<div class="row" style="padding:6px 0">
          <div style="flex:1;min-width:0">
            <div class="row-title" style="font-size:13px">${esc(label)}</div>
            <div class="row-sub">${esc(COL_LABELS[e.col] || e.col)} ／ ${new Date(e.deletedAt).toLocaleDateString('ja-JP')} 削除 ／ あと${days}日</div>
          </div>
          <button class="btn btn-s btn-sm" onclick="restoreTrash('${e.trashId}')">復元</button>
        </div>`;
      }).join('')
    + `<button class="btn btn-s btn-sm mt12" style="color:var(--a2)" onclick="emptyTrash()">ゴミ箱を空にする</button>`;
};
window.restoreTrash = (id) => {
  if (Trash.restore(id)) { showToast('✅ 復元しました'); window.renderTrash(); }
  else showToast('復元できませんでした', 'error');
};
window.emptyTrash = () => {
  showConfirm('🗑 ゴミ箱を空にする', '復元できなくなります。よろしいですか？', '空にする', () => {
    Trash.empty(); window.renderTrash(); showToast('ゴミ箱を空にしました');
  });
};

// バックアップに含まれていてよい状態キー（01-state.js の defaultS 由来）
const BACKUP_KNOWN_KEYS = ['tasks', 'unis', 'mocks', 'events', 'dailyLogs', 'studyTime', 'scoreTargets', 'timerLogs', 'timetable', 'homework', 'mockSchedule', 'specials', 'extras', 'repeatEvents', 'chatHistory', 'chatThreads', 'notes', 'heatmapData', 'applications', 'pastExams', 'trash', 'userName', 'userGrade', 'nijiDate', 'aiModel'];
// 本物のスナップショット（Backup.snapshot() = S 全体）には、これらが必ずすべて含まれる。
// 1つでも欠けているファイルは一部だけのデータか別物なので復元しない（復元すると残りがすべて初期化される）。
const BACKUP_REQUIRED_KEYS = BACKUP_KNOWN_KEYS;

// ダウンロードしたバックアップファイル（またはデータ本体そのもの）を検査し、
// {version, createdAt, date, data} の形にそろえて返す。おかしければ日本語のエラーを投げる。
const validateBackupSnapshot = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('バックアップファイルの形式が正しくありません');
  const hasData = obj.data !== undefined && obj.data !== null && typeof obj.data === 'object' && !Array.isArray(obj.data);
  const data = hasData ? obj.data : obj;   // data ラッパーが無い「データ本体だけ」の形も受け付ける
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('バックアップにデータが含まれていません');
  const missing = BACKUP_REQUIRED_KEYS.filter(k => !Object.prototype.hasOwnProperty.call(data, k));
  if (missing.length === BACKUP_REQUIRED_KEYS.length) throw new Error('受験アプリのバックアップデータが見つかりませんでした');
  // 一部の項目だけのファイルは弾く（足りない項目が初期値で上書きされてしまうため）
  if (missing.length > 0) throw new Error('バックアップが不完全なため復元できません（不足: ' + missing.join(', ') + '）。一部のデータだけのファイルでは、残りのデータが初期化されてしまいます');
  const createdAt = (hasData && typeof obj.createdAt === 'number' && obj.createdAt > 0) ? obj.createdAt : Date.now();
  return {
    version: hasData && obj.version ? obj.version : '',
    createdAt,
    // 日本時間の日付にする。JSTには夏時間が無いので、+9時間してからUTCで切り出せばJSTの暦日になる
    date: (hasData && obj.date) || new Date(createdAt + 9 * 3600 * 1000).toISOString().slice(0, 10),
    data
  };
};
window.validateBackupSnapshot = validateBackupSnapshot;

// 復元確認メッセージ用に、ざっくりした件数を数える
const backupCountsText = (data) => {
  const parts = [];
  const n = (k) => Array.isArray(data?.[k]) ? data[k].length : 0;
  if (n('tasks')) parts.push(`タスク ${n('tasks')}件`);
  if (n('unis')) parts.push(`志望校 ${n('unis')}件`);
  if (n('mocks')) parts.push(`模試 ${n('mocks')}件`);
  if (n('applications')) parts.push(`出願 ${n('applications')}件`);
  const logs = data?.dailyLogs && typeof data.dailyLogs === 'object' ? Object.keys(data.dailyLogs).length : 0;
  if (logs) parts.push(`学習記録 ${logs}日分`);
  return parts.length ? parts.join(' ／ ') : '記録はほぼ空です';
};

// スナップショットから実際に復元する処理（端末内・クラウド・ファイル共通）
const restoreFromSnapshot = async (snap) => {
  // 念のため、復元する直前の状態もバックアップに残しておく
  await Backup.run(true);
  // いまあるデータのID。バックアップに無いものは、あとでクラウドからも消す
  // （消さないと、次の同期で「バックアップより後に作ったデータ」が戻ってきて、復元前後が混ざる）
  const beforeIds = {};
  SYNC_COLS.forEach(col => { beforeIds[col] = (S[col] || []).map(x => x?.id).filter(Boolean); });
  const beforeLogKeys = Object.keys(S.dailyLogs || {});
  const keepPage = S.currentPage;

  const restored = Store.safeState(snap.data);
  // safeState は既定値にマージするだけなので、日別ログは丸ごと差し替える
  Object.assign(S, restored);
  S.dailyLogs = snap.data?.dailyLogs ? JSON.parse(JSON.stringify(snap.data.dailyLogs)) : {};
  S.calMonth = new Date(); S.currentPage = keepPage;
  showToast('⏪ 復元中...（画面を閉じないでください）', 'warn', 4000);

  // DbService は書き込み完了（サーバー応答）まで待つので、待たずに投げてから最後にまとめて待つ
  const jobs = [DbService.setMainProfile(), DbService.replaceField('timetable', S.timetable || {})];
  for (const col of SYNC_COLS) {
    const items = Array.isArray(S[col]) ? S[col] : [];
    const keep = new Set(items.map(x => x?.id));
    items.forEach(item => jobs.push(DbService.set(col, item)));
    beforeIds[col].filter(id => !keep.has(id)).forEach(id => jobs.push(DbService.del(col, id)));
  }
  // 日別ログ：バックアップにある日は書き戻し、無い日は消す（setDailyLog は無い日を削除として扱う）
  new Set([...Object.keys(S.dailyLogs), ...beforeLogKeys]).forEach(d => jobs.push(DbService.setDailyLog(d)));
  // 書き込み結果を確かめる。失敗・時間切れを「復元しました」と表示すると、
  // 一部だけ戻った状態に気づけず、次の同期で復元前のデータと混ざる
  // （オフライン時は SDK が書き込みを溜めて後で送るので、従来どおり待たずに完了扱い）
  let failed = 0, timedOut = false;
  if (navigator.onLine) {
    const results = await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(() => r(null), 20000))]);
    if (!results) timedOut = true;
    else failed = results.filter(r => r.status === 'rejected' || r.value === false).length;
  }
  try { rebuildStudyTotals({ persist: false }); } catch (e) {}
  refreshAllViews(); initAllCharts();
  if (failed > 0 || timedOut) showToast(`⚠️ 復元の一部が完了しませんでした（${timedOut ? '書き込みが時間内に終わりませんでした' : failed + '件の書き込みに失敗しました'}）。通信状態を確認して、もう一度復元をお試しください`, 'error', 7000);
  else showToast('⏪ 復元しました');
};
window.restoreFromSnapshot = restoreFromSnapshot;

window.renderBackups = async () => {
  const el = document.getElementById('backup-c');
  if (!el) return;
  const list = await Backup.list();
  const last = +(localStorage.getItem('jukenLastBackupAt') || 0);
  el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">
      週に1回、自動でこの端末に保存します（最新4件）${last ? '<br>最終バックアップ: ' + new Date(last).toLocaleString('ja-JP') : ''}
      <br>📌 学習データ本体はクラウド同期で、新しいURLでも自動で引き継がれます。
      <br>📌 端末内バックアップと Gemini APIキーは端末・URLごとに別です。旧URLでは「保存」でファイルに書き出し、新URLでは下の「ファイルから復元」で読み込めます（APIキーは再入力が必要です）。
    </div>`
    + (list.length
        ? list.map((b, i) => `<div class="row" style="padding:6px 0">
            <div style="flex:1">
              <div class="row-title" style="font-size:13px">${esc(b.date)}</div>
              <div class="row-sub">v${esc(b.version || '?')} ／ ${new Date(b.createdAt).toLocaleString('ja-JP')}</div>
            </div>
            <button class="btn btn-s btn-sm" onclick="downloadBackup(${i})">保存</button>
            <button class="btn btn-s btn-sm" onclick="restoreBackup(${i})">復元</button>
          </div>`).join('')
        : '<div style="font-size:12px;color:var(--muted)">まだバックアップがありません</div>')
    + `<div class="mt12" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-s btn-sm" onclick="runBackupNow()">💾 いますぐバックアップを作る</button>
        <button class="btn btn-s btn-sm" onclick="importBackup()">📂 バックアップファイルから復元</button>
      </div>
      <div id="backup-cloud-c"></div>`;
  await window.renderCloudBackups();
};
// クラウドバックアップの一覧（db が無いときは何も出さない）
window.renderCloudBackups = async () => {
  const el = document.getElementById('backup-cloud-c');
  if (!el) return;
  if (typeof db === 'undefined' || !db) { el.innerHTML = ''; return; }
  const cloud = await Backup.listCloud();
  window._cloudBackups = cloud;
  el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin:14px 0 4px">☁️ クラウドバックアップ（最新4件）</div>`
    + (cloud.length
        ? cloud.map((b, i) => `<div class="row" style="padding:6px 0">
            <div style="flex:1">
              <div class="row-title" style="font-size:13px">${esc(b.date || '')}</div>
              <div class="row-sub">v${esc(b.version || '?')} ／ ${new Date(b.createdAt).toLocaleString('ja-JP')}</div>
            </div>
            <button class="btn btn-s btn-sm" onclick="restoreCloudBackup(${i})">復元</button>
          </div>`).join('')
        : '<div style="font-size:12px;color:var(--muted)">まだクラウドバックアップがありません</div>');
};
window.runBackupNow = async () => {
  // 失敗（クラウド保存の失敗を含む）を成功と表示しない
  const ok = await Backup.run(true);
  await window.renderBackups();
  if (ok) showToast('💾 バックアップを作成しました');
  else showToast('⚠️ バックアップに失敗しました（クラウド保存できていない場合があります）', 'error', 5000);
};
window.downloadBackup = async (i) => {
  const list = await Backup.list();
  if (list[i]) Backup.download(list[i]);
};
window.restoreBackup = async (i) => {
  const list = await Backup.list();
  const snap = list[i];
  if (!snap) return;
  showConfirm('⏪ バックアップから復元',
    `${snap.date} 時点の状態に戻します。いまのデータは上書きされます。よろしいですか？`, '復元する', async () => {
      await restoreFromSnapshot(snap);
    });
};
window.restoreCloudBackup = async (i) => {
  const cloud = window._cloudBackups || await Backup.listCloud();
  const snap = cloud[i];
  if (!snap) return;
  showConfirm('☁️ クラウドバックアップから復元',
    `${snap.date} 時点の状態に戻します。いまのデータは上書きされます。よろしいですか？`, '復元する', async () => {
      await restoreFromSnapshot(snap);
    });
};
// ダウンロードしておいたバックアップファイル（.json）を読み込んで復元する
window.importBackup = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const snap = validateBackupSnapshot(parsed);
      showConfirm('📂 バックアップファイルから復元',
        `${snap.date} 時点のバックアップ（v${snap.version || '?'}）に戻します。${backupCountsText(snap.data)}。いまのデータは上書きされます。よろしいですか？`, '復元する', async () => {
          await restoreFromSnapshot(snap);
        });
    } catch (e) {
      showToast('📂 バックアップファイルを読み込めませんでした: ' + (e.message || e), 'error');
    }
  };
  input.click();
};

// ------------------------------------------------------------
// ✅ 自己テスト（主要ロジックの回帰チェック）
// 設定タブの「セルフチェックを実行」から呼ぶ。外部ライブラリなしで動く簡易版。
// ------------------------------------------------------------
const SelfTest = {
  cases: [],
  add: (name, fn) => SelfTest.cases.push({ name, fn }),
  run: () => {
    const results = [];
    for (const c of SelfTest.cases) {
      try { c.fn(); results.push({ name: c.name, ok: true }); }
      catch (e) { results.push({ name: c.name, ok: false, error: e.message }); }
    }
    return results;
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || '条件を満たしませんでした'); };
const assertEq = (actual, expected, msg) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || ''} 期待:${b} / 実際:${a}`);
};

SelfTest.add('日付ユーティリティ: 往復変換', () => {
  const s = DateManager.getTodayStr();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(s), 'YYYY-MM-DD 形式であること');
  assertEq(DateManager.getTodayStr(DateManager.parseSafe(s)), s, 'parse→format で同じ日付に戻ること');
});

SelfTest.add('私大一般の判定: 配点・最低点・英語の基準点', () => {
  const sc = EXAM_SCORING['doshisha-econ-kobetsu'];
  const ok = privEstimate({ en: 70, jp: 70, sel: 70 }, sc);
  assertEq([ok.score, ok.max, ok.diff, ok.grade], [350, 500, 5, '○'], '同志社経済 学部個別で全科目7割');
  const engLow = privEstimate({ en: 39, jp: 100, sel: 100 }, sc);
  assert(engLow.engFail && engLow.grade === '✕', '英語78点（基準80点未満）は合計が足りても✕');
  const rits = privEstimate({ en: 50, jp: 50, sel: 50, ma: 100 }, EXAM_SCORING['rits-econ-zengaku']);
  assertEq(rits.max, 320, '立命 全学統一は数学を使わず320点満点');
  // 全方式がプランに実在すること（キーの打ち間違い防止）
  assert(Object.keys(EXAM_SCORING).every(k => EXAM_PLAN.entries.some(e => e.key === k)), 'EXAM_SCORING のキーが出願プランにあること');
});

SelfTest.add('過去問: 結果の計算と直近の平均', () => {
  const r = { key: 'doshisha-econ-kobetsu', year: 2025, date: '2026-10-01', scores: { en: 150, jp: 100, sel: 100 }, min: null };
  const res = pastResult(r);
  assertEq([res.score, res.max, res.min, res.minAssumed, res.diff], [350, 500, 345, true, 5], '最低点が空欄なら2026年度の値で比べる');
  const recs = [r, { key: 'kindai-econ-zenkiA', year: 2025, date: '2026-10-05', scores: { en: 70, jp: 50 } }];
  assertEq(pastAvgRates(recs, 3), { en: 73, jp: 58, sel: 67 }, '科目ごとに得点率を平均（記録のある科目だけ）');
});

SelfTest.add('モデルの自動切替: 系統・保存値・チャット用だけ', () => {
  const okIds = ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'];
  assert(okIds.every(LiveFeed._isChatModel), 'Flash / Flash-Lite / Pro / Argon はチャット用として通すこと');
  const ngIds = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-image', 'gemini-3.8-live', 'gemini-3.5-transcribe', 'gemini-2.5-flash-preview-09-2025', 'gemma-4-27b'];
  assert(!ngIds.some(LiveFeed._isChatModel), '音声・画像・Live・日付つきプレビューは選択肢に入れないこと');
  // localStorage を一時的に差し替えて確かめる（終わったら必ず戻す）
  const KEYS = ['geminiModel', LIVE_CACHE_KEY];
  const saved = KEYS.map(k => localStorage.getItem(k));
  const savedAi = (typeof S !== 'undefined') ? S.aiModel : undefined;
  try {
    localStorage.removeItem(LIVE_CACHE_KEY);
    localStorage.setItem('geminiModel', 'gemini-4-argon');
    LiveFeed.autoUpgradeModel([{ id: 'gemini-3.9-flash' }, { id: 'gemini-3.9-flash-tts' }]);
    assertEq(localStorage.getItem('geminiModel'), 'gemini-4-argon', 'Argon を保存している人を Flash に切り替えないこと（選択欄の先頭ではなく保存値を見る）');
    localStorage.setItem('geminiModel', 'gemini-3.8-flash');
    LiveFeed.autoUpgradeModel([{ id: 'gemini-3.9-flash-tts' }, { id: 'gemini-4-flash-preview' }]);
    assertEq(localStorage.getItem('geminiModel'), 'gemini-3.8-flash', '音声版やプレビュー版だけの新作では切り替えないこと');
    LiveFeed.autoUpgradeModel([{ id: 'gemini-3.9-flash' }]);
    assertEq(localStorage.getItem('geminiModel'), 'gemini-3.9-flash', '同じ系統の新しい安定版が出たら切り替えること');
  } finally {
    KEYS.forEach((k, i) => saved[i] == null ? localStorage.removeItem(k) : localStorage.setItem(k, saved[i]));
    if (typeof S !== 'undefined') S.aiModel = savedAi;
    delete LiveFeed.data.modelAutoUpgrade;
  }
});

SelfTest.add('AI中継: 中継を試す条件とリクエスト整形', () => {
  const savedState = AiProxy.state;
  try {
    AiProxy.state = 'unknown';
    assert(AiProxy.shouldTry('{}'), '通常サイズなら中継を試すこと');
    assert(!AiProxy.shouldTry('x'.repeat(AiProxy.MAX_BODY_BYTES + 1)), '大きすぎる送信は中継を試さないこと（Vercelの上限回避）');
    AiProxy.state = 'down';
    assert(!AiProxy.shouldTry('{}'), '中継が使えないと判定済みなら試さないこと');
    AiProxy.state = 'unknown';
    const b = AiProxy.buildBody('gemini-3.8-flash', { contents: [] }, true);
    assertEq(b.model, 'gemini-3.8-flash', '中継ボディにモデルが入ること');
    assertEq(b.stream, true, '中継ボディに stream が伝わること');
    assert(Array.isArray(b.payload.contents), '中継ボディに payload がそのまま入ること');
  } finally { AiProxy.state = savedState; }
});

SelfTest.add('AI中継: 失敗時のフォールバック判定', () => {
  assertEq(AiProxy.decide({ status: 503, errStatus: 'PROXY_NOT_CONFIGURED', hasKey: false }), 'fallback', 'サーバー未設定（503）ならキー無しでも直接経路へ切り替えること');
  assertEq(AiProxy.decide({ status: 404, errStatus: '', hasKey: true }), 'fallback', '中継が無い環境（404）なら直接へ切り替えること');
  assertEq(AiProxy.decide({ status: 405, errStatus: '', hasKey: false }), 'fallback', '405 でも直接へ切り替えること');
  assertEq(AiProxy.decide({ status: 502, errStatus: 'PROXY_UPSTREAM', hasKey: true }), 'fallback', '中継の上流エラーでキーがあるなら直接を試すこと');
  assertEq(AiProxy.decide({ status: 502, errStatus: 'PROXY_UPSTREAM', hasKey: false }), 'return', 'キーが無ければ中継のエラーをそのまま返すこと');
  assertEq(AiProxy.decide({ status: 403, errStatus: '', hasKey: true }), 'return', 'Gemini側の403（キー無効等）は中継の失敗と誤判定しないこと');
  assertEq(AiProxy.decide({ status: 429, errStatus: '', hasKey: false }), 'return', 'Gemini側の429はそのまま返すこと');
  assertEq(AiProxy.decide({ status: 400, errStatus: 'PROXY_MODEL', hasKey: true }), 'return', '許可リスト外モデルの拒否はそのまま返すこと');
});

SelfTest.add('お金: Firestoreドキュメントの解釈', () => {
  const data = { total: 28088, categories: [{ name: '普通預金', amount: 22290, accounts: [] }], holdings: [], summaries: [], paypay: null };
  const raw = { fields: { money: { stringValue: JSON.stringify(data) }, updatedAt: { timestampValue: '2026-10-27T01:32:51Z' } } };
  const parsed = MoneyFeed._parseDoc(raw);
  assertEq(parsed.total, 28088, '総資産が解釈できること');
  assertEq(MoneyFeed._parseDoc({ fields: {} }), null, 'money字段が無ければ null');
  assertEq(MoneyFeed._parseDoc({ fields: { money: { stringValue: '{"total":"x"}' } } }), null, 'total が数でなければ null');
  assertEq(MoneyFeed._parseDoc(null), null, 'null は null');
});

SelfTest.add('お金: 証券の切り分け・割合・月の集計', () => {
  const data = {
    total: 28088,
    categories: [],
    holdings: [
      { name: '円預金(普通預金)', asset_category: '普通預金', institution_name: '楽天銀行', current_value: 15421 },
      { name: 'eMAXIS Slim 米国株式(S&P500)', asset_category: '投資信託', institution_name: '楽天証券', current_value: 2359 },
      { name: 'eMAXIS Slim 全世界株式(オルカン)', asset_category: '投資信託', institution_name: '楽天証券', current_value: 2335 },
      { name: 'ゴールド・ファンド(為替ヘッジなし)', asset_category: '投資信託', institution_name: '楽天証券', current_value: 1104 }
    ],
    summaries: [
      { month: '2026-09', income: [], expenses: [{ category_name: '食費', value_in_jpy: 100 }] },
      { month: '2026-10', income: [{ category_name: '収入', value_in_jpy: 6 }], expenses: [{ category_name: '通信費', value_in_jpy: 10749 }, { category_name: '現金・カード', value_in_jpy: 14000 }] }
    ]
  };
  const sec = MoneyFeed.securities(data);
  assertEq(sec.list.length, 3, '証券は預金を除いた3件');
  assertEq(sec.total, 5798, '証券合計が 2359+2335+1104=5798');
  assertEq(MoneyFeed.pct(2359, 5798), 41, 'S&P500 の割合は約41%');
  assertEq(MoneyFeed.pct(10, 0), 0, '合計0の割合は0');
  const ms = MoneyFeed.monthSummary(data, '2026-10');
  assertEq(MoneyFeed.sumValues(ms.expenses), 24749, '10月の支出合計');
  assertEq(MoneyFeed.monthSummary(data, '2026-12').month, '2026-10', '無い月は最新の月で代用');
  assertEq(MoneyFeed.monthSummary({ summaries: [] }, '2026-10'), null, '集計が無ければ null');
});

SelfTest.add('お金: 家計簿の月別集計と明細描画', () => {
  const data = {
    total: 1000, categories: [], holdings: [], summaries: [],
    kakeibo: { months: {
      '2026-09': [
        { date: '2026-09-10', title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 520 }
      ],
      '2026-10': [
        { date: '2026-10-05', title: '給料', cat: '収入', src: '楽天銀行', io: 'in', amount: 40000 },
        { date: '2026-10-03', title: 'APPLE COM BILL', cat: '通信費', src: 'PayPay銀行', io: 'out', amount: 3499 },
        { date: '2026-10-01', title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 520 }
      ]
    }, truncated: [] }
  };
  assertEq(JSON.stringify(MoneyFeed.kakeiboMonths(data)), JSON.stringify(['2026-10', '2026-09']), '家計簿の月は新しい順');
  assertEq(MoneyFeed.kakeiboMonths({}), [], '家計簿が無ければ空');
  const tot = MoneyFeed.kakeiboTotals(MoneyFeed.kakeiboList(data, '2026-10'));
  assertEq(tot.out, 4019, '10月の支出は 3499+520=4019');
  assertEq(tot.inn, 40000, '10月の入金は40000');
  assertEq(tot.cats[0].name, '通信費', 'カテゴリ別は大きい順');
  const html = MoneyView.html(data);
  assert(html.includes('家計簿'), '家計簿セクションが出ること');
  assert(html.includes('APPLE COM BILL'), '明細のタイトルが出ること');
  assert(html.includes('PayPay銀行'), '明細の出所が出ること');
  assertEq(MoneyView.html({ total: 0, categories: [], holdings: [], summaries: [] }).includes('家計簿'), false, '家計簿データが無ければセクションを出さない');
});

SelfTest.add('お金: サブタブ切替でセクションが絞られる', () => {
  const data = {
    total: 28088,
    categories: [
      { name: '普通預金', amount: 22290, accounts: [{ name: '楽天銀行', amount: 15421 }, { name: 'PayPay銀行', amount: 6869 }] },
      { name: '投資信託', amount: 5798, accounts: [{ name: '楽天証券', amount: 5798 }] }
    ],
    holdings: [
      { name: '円預金(普通預金)', asset_category: '普通預金', institution_name: '楽天銀行', current_value: 15421 },
      { name: 'eMAXIS Slim 米国株式(S&P500)', asset_category: '投資信託', institution_name: '楽天証券', current_value: 2359 }
    ],
    summaries: [
      { month: '2026-10', income: [], expenses: [{ category_name: '通信費', value_in_jpy: 10749 }] }
    ],
    kakeibo: { months: { '2026-10': [{ date: '2026-10-01', title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 520 }] }, truncated: [] },
    paypay: { monthlyPayments: [{ month: '2026-10', amount: 13686, count: 30 }], topMerchants: [{ name: 'ローソン', count: 10, amount: 5000 }], periodFrom: '2024-10-27', periodTo: '2026-10-27', totalPayments: 247033, paymentCount: 100 }
  };
  const marks = { total: '💰 総資産', accounts: '🏦 口座・資産ごと', securities: '📈 証券・投資信託', expenses: 'の支出', paypay: '📱 PayPay の支払い', kakeibo: '📒 家計簿', subs: '🔁 サブスク' };
  try {
    // ホームは全セクションを含む
    const home = MoneyView.html(data, 'home');
    Object.values(marks).forEach(m => assert(home.includes(m), `ホームに ${m} が含まれること`));
    // 各タブは該当セクションのみ（口座タブは総資産＋口座）
    const only = (tab, yes, no) => {
      const h = MoneyView.html(data, tab);
      yes.forEach(m => assert(h.includes(marks[m]), `${tab} タブに ${m} が含まれること`));
      no.forEach(m => assert(!h.includes(marks[m]), `${tab} タブに ${m} が含まれないこと`));
    };
    only('accounts', ['total', 'accounts'], ['securities', 'expenses', 'paypay', 'kakeibo', 'subs']);
    only('securities', ['securities'], ['total', 'accounts', 'expenses', 'paypay', 'kakeibo', 'subs']);
    only('expenses', ['expenses'], ['total', 'accounts', 'securities', 'paypay', 'kakeibo', 'subs']);
    only('paypay', ['paypay'], ['total', 'accounts', 'securities', 'expenses', 'kakeibo', 'subs']);
    only('kakeibo', ['kakeibo'], ['total', 'accounts', 'securities', 'expenses', 'paypay', 'subs']);
    only('subs', ['subs'], ['total', 'accounts', 'securities', 'expenses', 'paypay', 'kakeibo']);
    // タブバー: 全タブが出て、アクティブは1つだけ。
    // 見た目はアプリ標準のページ内切替（模試表タブと同じ .btn btn-sm、アクティブ=btn-p / 他=btn-s）
    MoneyTab.current = 'paypay';
    const tabs = MoneyView.tabsHtml();
    MoneyTab.TABS.forEach(t => assert(tabs.includes(`MoneyTab.set('${t.id}')`), `タブバーに ${t.id} があること`));
    assertEq(tabs.split(' btn-p"').length - 1, 1, 'アクティブなタブ（btn-p）は1つだけ');
    assertEq(tabs.split(' btn-s"').length - 1, MoneyTab.TABS.length - 1, '非アクティブなタブは btn-s（アクティブ以外全部）');
    assert(!tabs.includes('border-radius:999px'), '独自のピル型スタイルを使っていないこと');
    // 現在のタブが保持される: 引数なしの描画は選択中タブ（PayPay）で描かれる
    const cur = MoneyView.html(data);
    assert(cur.includes(marks.paypay) && !cur.includes(marks.total), '再描画でタブがホームに戻らないこと');
    // 知らないタブ名は現在のタブで描く
    assert(MoneyView.html(data, 'unknown-tab').includes(marks.paypay), '不正なタブ名は現在のタブにフォールバック');
  } finally {
    MoneyTab.current = 'home';
  }
});

SelfTest.add('お金: ホームに家計簿とサブスクの両セクションが含まれる', () => {
  const saved = S.moneySubs;
  try {
    S.moneySubs = { seeded: true, items: [{ id: 'h1', name: 'ホーム確認用サブスク', amount: 1500, cycle: 'month', nextDate: '2026-11-15', memo: '' }] };
    const data = {
      total: 1000, categories: [], holdings: [],
      summaries: [{ month: '2026-10', income: [], expenses: [{ category_name: '通信費', value_in_jpy: 100 }] }],
      kakeibo: { months: { '2026-10': [{ date: '2026-10-01', title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 520 }] }, truncated: [] },
      paypay: { monthlyPayments: [{ month: '2026-10', amount: 520, count: 1 }], topMerchants: [], periodFrom: '2026-10-01', periodTo: '2026-10-27', totalPayments: 520, paymentCount: 1 }
    };
    const home = MoneyView.html(data, 'home');
    assert(home.includes('📒 家計簿'), 'ホームに家計簿セクションがあること');
    assert(home.includes('🔁 サブスク'), 'ホームにサブスクセクションがあること');
    assert(home.includes('ホーム確認用サブスク'), 'ホームのサブスクに登録内容が出ること');
    assert(home.includes('月額換算の合計'), 'ホームのサブスクに合計が出ること');
    assert(home.includes("MoneySubs.openEdit('h1')") && home.includes("MoneySubs.askRemove('h1')"), 'ホームのサブスクから編集・削除できること');
    assert(home.includes('MoneySubs.openNew()'), 'ホームのサブスクから追加できること');
    const iKb = home.indexOf('📒 家計簿'), iSub = home.indexOf('🔁 サブスク'), iPp = home.indexOf('📱 PayPay の支払い');
    assert(iKb >= 0 && iSub > iKb && iPp > iSub, 'ホームの並びが 家計簿→サブスク→PayPay であること');
  } finally { S.moneySubs = saved; }
});

SelfTest.add('お金: 支出は月ごとに切り替えられる', () => {
  const data = {
    total: 28088, categories: [], holdings: [],
    summaries: [
      { month: '2026-09', income: [{ category_name: '収入', value_in_jpy: 40000 }], expenses: [{ category_name: '食費', value_in_jpy: 5337 }] },
      { month: '2026-10', income: [], expenses: [{ category_name: '通信費', value_in_jpy: 10749 }] }
    ]
  };
  assertEq(JSON.stringify(MoneyFeed.summaryMonths(data)), JSON.stringify(['2026-10', '2026-09']), 'サマリの月は新しい順');
  try {
    MoneyExp.ym = '2026-09';
    const sep = MoneyView.html(data, 'expenses');
    assert(sep.includes('2026年9月の支出'), '選択した月の支出セクションになること');
    assert(sep.includes('¥5,337'), '9月の支出合計が出ること');
    assert(sep.includes('money-monthbar'), '月移動バーが出ること');
    assert(sep.includes(`onchange="MoneyExp.setYm(this.value)"`), '月のプルダウンが出ること');
    assert(sep.includes('<option value="2026-09" selected>2026年9月</option>'), 'プルダウンで選択中の月が選ばれていること');
    assert(!sep.includes(`MoneyExp.setYm('2026-10')`), '月チップのグリッドが無いこと');
    MoneyExp.ym = '2026-10';
    const oct = MoneyView.html(data, 'expenses');
    assert(oct.includes('2026年10月の支出') && oct.includes('¥10,749'), '10月に切り替えられること');
  } finally {
    MoneyExp.ym = null;
  }
});

SelfTest.add('お金: 月移動バーの‹›とプルダウンで月が切り替わる', () => {
  const data = {
    total: 28088, categories: [], holdings: [],
    summaries: [
      { month: '2026-09', income: [], expenses: [{ category_name: '食費', value_in_jpy: 5337 }] },
      { month: '2026-10', income: [], expenses: [{ category_name: '通信費', value_in_jpy: 10749 }] }
    ],
    kakeibo: { months: {
      '2026-09': [{ date: '2026-09-10', title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 520 }],
      '2026-10': [
        { date: '2026-10-03', title: 'APPLE COM BILL', cat: '通信費', src: 'PayPay銀行', io: 'out', amount: 3499 },
        { date: '2026-10-01', title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 520 }
      ]
    }, truncated: [] }
  };
  try {
    // 支出: バーは1行部品（select 1つ＋‹ › ボタン2つ）で、端では片方が disabled
    MoneyExp.ym = '2026-10';
    const exp = MoneyView.html(data, 'expenses');
    assertEq(exp.split('<select').length - 1, 1, '支出バーにプルダウンが1つだけあること');
    assert(exp.includes(`onclick="MoneyExp.stepYm(-1)"`) && exp.includes(`onclick="MoneyExp.stepYm(1)"`), '支出バーに‹ ›ボタンがあること');
    assert(exp.includes('aria-label="次の月" disabled'), '最新月では›が disabled のこと');
    assert(!exp.includes('aria-label="前の月" disabled'), '最新月では‹が押せること');
    // 支出: ‹（前の月）で 2026-09 に切り替わり、合計も変わる。端ではそれ以上動かない
    MoneyExp.stepYm(-1);
    assertEq(MoneyExp.ym, '2026-09', '支出: ‹で前月へ移動');
    const expSep = MoneyView.html(data, 'expenses');
    assert(expSep.includes('2026年9月の支出') && expSep.includes('¥5,337'), '支出: 前月に切り替わると合計も変わること');
    assert(expSep.includes('aria-label="前の月" disabled'), '最古月では‹が disabled のこと');
    MoneyExp.stepYm(-1);
    assertEq(MoneyExp.ym, '2026-09', '支出: 最古月で‹を押しても動かないこと');
    MoneyExp.stepYm(1);
    assertEq(MoneyExp.ym, '2026-10', '支出: ›で次月へ戻ること');
    // 家計簿: バーが出て、チップグリッドが無いこと
    MoneyKb.ym = '2026-10'; MoneyKb.showAll = false;
    const kb = MoneyView.html(data, 'kakeibo');
    assert(kb.includes('money-monthbar'), '家計簿に月移動バーが出ること');
    assert(kb.includes(`onchange="MoneyKb.setYm(this.value)"`), '家計簿に月のプルダウンが出ること');
    assert(kb.includes('<option value="2026-10" selected>2026年10月</option>'), '家計簿のプルダウンで選択月が選ばれていること');
    assert(!kb.includes(`MoneyKb.setYm('2026-09')`), '家計簿に月チップのグリッドが無いこと');
    // 家計簿: ‹で前月へ。合計（支出）が 4019→520 に変わる
    MoneyKb.stepYm(-1);
    assertEq(MoneyKb.ym, '2026-09', '家計簿: ‹で前月へ移動');
    const kbSep = MoneyView.html(data, 'kakeibo');
    assert(kbSep.includes('¥520') && !kbSep.includes('¥4,019'), '家計簿: 前月に切り替わると合計も変わること');
    MoneyKb.stepYm(1);
    assertEq(MoneyKb.ym, '2026-10', '家計簿: ›で次月へ戻ること');
    MoneyKb.stepYm(1);
    assertEq(MoneyKb.ym, '2026-10', '家計簿: 最新月で›を押しても動かないこと');
  } finally {
    MoneyExp.ym = null;
    MoneyKb.ym = null; MoneyKb.showAll = false;
  }
});

SelfTest.add('お金: 金額マスクは描画から金額を消す', () => {
  const data = {
    total: 28088,
    categories: [{ name: '普通預金', amount: 22290, accounts: [{ name: '楽天銀行', amount: 15421 }] }],
    holdings: [{ name: 'eMAXIS Slim 米国株式(S&P500)', asset_category: '投資信託', institution_name: '楽天証券', current_value: 2359 }],
    summaries: [{ month: '2026-10', income: [], expenses: [{ category_name: '通信費', value_in_jpy: 10749 }] }],
    kakeibo: { months: { '2026-10': [{ date: '2026-10-01', title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 520 }] }, truncated: [] },
    paypay: { monthlyPayments: [{ month: '2026-10', amount: 13686, count: 30 }], topMerchants: [{ name: 'ローソン', count: 10, amount: 5000 }], periodFrom: '2024-10-27', periodTo: '2026-10-27', totalPayments: 247033, paymentCount: 100 }
  };
  const saved = MoneyUi.masked;
  try {
    MoneyUi.masked = true;
    const html = MoneyView.html(data, 'home');
    ['¥28,088', '¥22,290', '¥15,421', '¥2,359', '¥10,749', '¥520', '¥13,686', '¥5,000', '¥247,033'].forEach(a =>
      assert(!html.includes(a), `マスク時は ${a} が描画されないこと`));
    assert(html.includes('¥•••'), 'マスク時は ¥••• が出ること');
    assert(html.includes('ローソン') && html.includes('食費'), 'マスクしても銘柄・カテゴリ・件名は残ること');
    MoneyUi.masked = false;
    assert(MoneyView.html(data, 'home').includes('¥28,088'), 'マスクOFFでは総資産が出ること');
  } finally { MoneyUi.masked = saved; }
});

SelfTest.add('お金: 家計簿の検索・出所フィルタ', () => {
  const list = [
    { date: '2026-10-03', title: 'APPLE COM BILL', cat: '通信費', src: 'PayPay銀行', io: 'out', amount: 3499 },
    { date: '2026-10-01', title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 520 },
    { date: '2026-10-05', title: '給料', cat: '収入', src: '楽天銀行', io: 'in', amount: 40000 }
  ];
  assertEq(JSON.stringify(MoneyFeed.kakeiboSources(list)), JSON.stringify(['PayPay銀行', 'PayPay', '楽天銀行']), '出所一覧が出現順');
  assertEq(MoneyFeed.kakeiboFilter(list, '', 'all').length, 3, 'フィルタ無しは全件');
  assertEq(MoneyFeed.kakeiboFilter(list, 'ローソン', 'all').length, 1, 'タイトル部分一致で絞れること');
  assertEq(MoneyFeed.kakeiboFilter(list, 'apple', 'all').length, 1, '検索は大小文字を区別しないこと');
  assertEq(MoneyFeed.kakeiboFilter(list, '', 'PayPay').length, 1, '出所で絞れること');
  assertEq(MoneyFeed.kakeiboFilter(list, 'ローソン', 'PayPay銀行').length, 0, '検索と出所はAND条件');
  assertEq(MoneyFeed.kakeiboTotals(MoneyFeed.kakeiboFilter(list, 'ローソン', 'all')).out, 520, 'フィルタ後の支出合計が追従すること');
  const data = { total: 0, categories: [], holdings: [], summaries: [], kakeibo: { months: { '2026-10': list }, truncated: [] } };
  try {
    MoneyKb.ym = '2026-10'; MoneyKb.query = 'ローソン'; MoneyKb.src = 'all'; MoneyKb.showAll = false;
    const html = MoneyView.html(data, 'kakeibo');
    assert(html.includes('ローソン') && !html.includes('APPLE COM BILL'), '描画が検索で絞られること');
    assert(html.includes('絞り込み中') && html.includes('MoneyKb.clearFilter()'), '絞り込み中の表示と解除方法が出ること');
    assert(html.includes('1件（全3件中）'), 'フィルタ後の件数が追従すること');
  } finally { MoneyKb.query = ''; MoneyKb.src = 'all'; MoneyKb.ym = null; MoneyKb.showAll = false; }
});

SelfTest.add('お金: 支出カテゴリに割合バー・前月比が出る', () => {
  const data = {
    total: 0, categories: [], holdings: [],
    summaries: [
      { month: '2026-09', income: [], expenses: [{ category_name: '食費', value_in_jpy: 5337 }, { category_name: '通信費', value_in_jpy: 9000 }] },
      { month: '2026-10', income: [], expenses: [{ category_name: '通信費', value_in_jpy: 10749 }, { category_name: '現金・カード', value_in_jpy: 14000 }] }
    ]
  };
  const cmp = MoneyFeed.prevMonthCompare(data, '2026-10');
  assertEq(cmp.prevYm, '2026-09', '前月は2026-09');
  assertEq(cmp.diff, 24749 - 14337, '前月比の差額');
  assertEq(MoneyFeed.prevMonthCompare(data, '2026-09'), null, '前月データが無い月は前月比が出ないこと');
  try {
    MoneyExp.ym = '2026-10';
    const html = MoneyView.html(data, 'expenses');
    assert(html.includes('前月比') && html.includes('+¥10,412'), '支出セクションに前月比が出ること');
    assert(html.includes('height:6px'), '支出カテゴリに割合バーが出ること');
    assert(html.includes('57%') || html.includes('43%'), '支出カテゴリに割合%が出ること');
  } finally { MoneyExp.ym = null; }
});

SelfTest.add('カレンダー: 今月ボタンで現在月へ戻れる', () => {
  const saved = S.calMonth;
  try {
    S.calMonth = new Date(2025, 0, 1);
    chCalToday();
    const now = new Date();
    assertEq(S.calMonth.getFullYear(), now.getFullYear(), '今月ボタンの年');
    assertEq(S.calMonth.getMonth(), now.getMonth(), '今月ボタンの月');
  } finally { S.calMonth = saved; if (typeof renderCal === 'function') renderCal(); }
});

SelfTest.add('カレンダー: 今週ボタンで現在週へ戻れる', () => {
  const saved = weekOffset;
  try {
    weekOffset = 3;
    chWeekToday();
    assertEq(weekOffset, 0, '今週ボタンで weekOffset が 0 に戻ること');
    weekOffset = -2;
    chWeekToday();
    assertEq(weekOffset, 0, '過去の週からも今週へ戻れること');
  } finally { weekOffset = saved; if (typeof renderWeek === 'function') renderWeek(); }
});

SelfTest.add('分析: AI評価カレンダーの今月ボタンで現在月へ戻れる', () => {
  const saved = evalCalMonth;
  try {
    evalCalMonth = new Date(2025, 0, 1);
    chEvalToday();
    const now = new Date();
    assertEq(evalCalMonth.getFullYear(), now.getFullYear(), '今月ボタンの年');
    assertEq(evalCalMonth.getMonth(), now.getMonth(), '今月ボタンの月');
  } finally { evalCalMonth = saved; if (typeof renderCoachHistory === 'function') renderCoachHistory(); }
});

SelfTest.add('サブスク: 初期投入は1回だけ・削除は復活しない', () => {
  const saved = S.moneySubs;
  try {
    S.moneySubs = null;
    assertEq(MoneySubs.ensureSeed(false), true, '未投入なら投入されること');
    assertEq(S.moneySubs.seeded, true, '投入済みフラグが立つこと');
    assertEq(S.moneySubs.items.length, 3, '初期データは3件');
    const names = S.moneySubs.items.map(x => x.name);
    assert(names.includes('Muse Power') && names.includes('Claude Pro') && names.includes('Google AI Pro'), '既知の契約が入ること');
    const g = S.moneySubs.items.find(x => x.name === 'Google AI Pro');
    assertEq(g.amount, 2900, 'Google AI Pro は現行の月額');
    assert(g.memo.includes('1,450'), 'メモに AI Plus への切替予定が分かること');
    assert(S.moneySubs.items.every(x => x.nextDate === ''), '次回支払日は推測で入れない（全て空欄）');
    assertEq(MoneySubs.ensureSeed(false), false, '2回目は投入されないこと');
    assertEq(S.moneySubs.items.length, 3, '再投入で重複しないこと');
    S.moneySubs.items = [];
    assertEq(MoneySubs.ensureSeed(false), false, '全削除後も再投入されないこと');
    assertEq(S.moneySubs.items.length, 0, '削除した項目が復活しないこと');
  } finally { S.moneySubs = saved; }
});

SelfTest.add('サブスク: CRUDと合計計算', () => {
  const saved = S.moneySubs;
  try {
    S.moneySubs = { seeded: true, items: [] };
    const a = MoneySubs.add({ name: 'テスト月額', amount: 3499, cycle: 'month', nextDate: '2026-11-01', memo: '' }, false);
    const c = MoneySubs.add({ name: 'テスト年額', amount: 12000, cycle: 'year', nextDate: '', memo: 'x' }, false);
    assertEq(S.moneySubs.items.length, 2, '追加できること');
    const t = MoneySubs.totals(S.moneySubs.items);
    assertEq(t.monthlyEq, 4499, '月額換算 = 3499 + 12000/12');
    assertEq(t.yearlyEq, 53988, '年額換算 = 3499*12 + 12000');
    assertEq(MoneySubs.update(a.id, { name: 'テスト月額2', amount: 1000, cycle: 'month', nextDate: '', memo: '' }, false), true, '編集できること');
    assertEq(S.moneySubs.items.find(x => x.id === a.id).amount, 1000, '編集が反映されること');
    assertEq(MoneySubs.remove(c.id, false), true, '削除できること');
    assertEq(S.moneySubs.items.length, 1, '削除が反映されること');
    const p = profileForServer();
    assert('moneySubs' in p, 'moneySubs はプロフィール側で同期されること（profileForServerで落ちない）');
  } finally { S.moneySubs = saved; }
});

SelfTest.add('サブスク: 一覧と合計が描画され、候補欄は出ない', () => {
  const saved = S.moneySubs;
  try {
    S.moneySubs = { seeded: true, items: [{ id: 'x1', name: 'CLAUDE.AI', amount: 3499, cycle: 'month', nextDate: '', memo: '' }] };
    const data = {
      total: 0, categories: [], holdings: [], summaries: [],
      kakeibo: { months: {
        '2026-09': [
          { date: '2026-09-03', title: 'APPLE COM BILL', cat: '通信費', src: 'PayPay銀行', io: 'out', amount: 600 },
          { date: '2026-09-05', title: 'CLAUDE.AI', cat: '通信費', src: 'PayPay銀行', io: 'out', amount: 3499 }
        ],
        '2026-10': [
          { date: '2026-10-03', title: 'APPLE COM BILL', cat: '通信費', src: 'PayPay銀行', io: 'out', amount: 600 },
          { date: '2026-10-05', title: 'CLAUDE.AI', cat: '通信費', src: 'PayPay銀行', io: 'out', amount: 3499 }
        ]
      }, truncated: [] }
    };
    const html = MoneyView.html(data, 'subs');
    assert(html.includes('CLAUDE.AI') && html.includes('月額換算の合計') && html.includes('¥41,988'), 'サブスクタブに登録済みと年額換算が出ること');
    assert(!html.includes('定期支払いの候補'), '定期支払いの候補欄は描画されないこと');
    assert(!html.includes('openCandidate'), '候補の追加ボタンは描画されないこと');
    assert(!('detectCandidates' in MoneySubs), '候補検出ロジックが存在しないこと');
    assert(MoneyTab.TABS.some(t => t.id === 'subs'), 'サブタブにサブスクがあること');
  } finally { S.moneySubs = saved; }
});

SelfTest.add('お金: 家計簿は12か月以上の月と要約月を扱える', () => {
  // 14か月分の明細があるデータ（2025-09〜2026-10）
  const months = {};
  for (let i = 0; i < 14; i++) {
    const d = new Date(2025, 8 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months[ym] = [{ date: `${ym}-05`, title: 'ローソン', cat: '食費', src: 'PayPay', io: 'out', amount: 500 }];
  }
  const data = { total: 0, categories: [], holdings: [], summaries: [], kakeibo: { months, truncated: [] } };
  const ms = MoneyFeed.kakeiboMonths(data);
  assertEq(ms.length, 14, '家計簿の月が14か月分あること');
  assertEq(ms[0], '2026-10', '先頭は最新の月');
  assertEq(ms[13], '2025-09', '末尾は最古の月');
  // 明細が要約に置き換わった月も、月として選べて合計とカテゴリ別が出る
  const data2 = {
    total: 0, categories: [], holdings: [], summaries: [],
    kakeibo: { months: {}, monthlySummary: { '2024-11': { count: 40, out: 50000, in: 3000, cats: [{ name: '食費', amount: 20000 }] } }, truncated: [] }
  };
  assertEq(JSON.stringify(MoneyFeed.kakeiboMonths(data2)), JSON.stringify(['2024-11']), '要約だけの月も月一覧に入ること');
  const html = MoneyView.html(data2, 'kakeibo');
  assert(html.includes('¥50,000'), '要約月の支出合計が出ること');
  assert(html.includes('合計とカテゴリ別だけを表示しています'), '要約月はその旨が出ること');
});

SelfTest.add('ページ遷移: 横スワイプではページが移らない', () => {
  // 横スワイプでのページ遷移は廃止した（ページ内の横スクロールと競合するため）。
  // main 要素に横スワイプ相当のタッチ列を送っても、ページが切り替わらないことを確かめる
  const main = document.querySelector('.main');
  assert(!!main, 'main 要素があること');
  const before = S.currentPage;
  const fire = (type, x, y) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    ev.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
    ev.changedTouches = [{ clientX: x, clientY: y }];
    main.dispatchEvent(ev);
  };
  fire('touchstart', 320, 200);
  fire('touchmove', 160, 200);
  fire('touchend', 60, 200);
  assertEq(S.currentPage, before, '横スワイプでページが切り替わらないこと');
});

SelfTest.add('見た目のスタイル: ぷっくりポップの切替', () => {
  const html = document.documentElement;
  const before = html.getAttribute('data-style');
  try {
    applyUiStyle('pop');
    assertEq(html.getAttribute('data-style'), 'pop', 'ぷっくりポップで data-style="pop" になること');
    applyUiStyle('glass');
    assert(!html.hasAttribute('data-style'), 'いつもの見た目では属性を外すこと');
    applyUiStyle('unknown-style');
    assert(!html.hasAttribute('data-style'), '知らないスタイル名はいつもの見た目にすること');
  } finally {
    applyUiStyle(before || S.userStyle);
  }
});

SelfTest.add('見た目のスタイル: すっきりモダンが増えて既存2つと選択が保持される', () => {
  const html = document.documentElement;
  const before = html.getAttribute('data-style');
  try {
    assertEq(UI_STYLES.length, 3, 'スタイルの選択肢は3つ');
    ['glass', 'pop', 'modern'].forEach(id => assert(UI_STYLES.some(x => x.id === id), `スタイル ${id} があること`));
    applyUiStyle('modern');
    assertEq(html.getAttribute('data-style'), 'modern', 'すっきりモダンで data-style="modern" になること');
    applyUiStyle('pop');
    assertEq(html.getAttribute('data-style'), 'pop', 'ぷっくりポップも従来どおり選べること');
    applyUiStyle('glass');
    assert(!html.hasAttribute('data-style'), 'いつもの見た目では属性を外すこと');
  } finally {
    applyUiStyle(before || S.userStyle);
  }
});

SelfTest.add('ナビ: 上部ナビから全ページへ遷移できる', () => {
  const nav = document.querySelector('.top-nav');
  assert(!!nav, '上部ナビがあること');
  assert(!document.querySelector('.tabbar'), '下部タブバーが無いこと');
  assert(!document.getElementById('mo-more'), 'その他シートが無いこと');
  const all = ['home', 'timer', 'calendar', 'uni', 'apply', 'analytics', 'sunzemi', 'aicoach', 'money', 'settings'];
  all.forEach(id => assert(!!nav.querySelector(`.nav-btn[onclick*="'${id}'"]`), `上部ナビに ${id} のボタンがあること`));
  // 全ページへ実際に切り替えて、表示ページが合うこと（描画側で例外が出ても表示切替までは済んでいる）
  const beforePage = S.currentPage;
  all.forEach(id => {
    try { showPage(id); } catch (e) { /* 描画の例外はここでは見ない */ }
    assert(document.getElementById('page-' + id).classList.contains('active'), `${id} ページが表示されること`);
    assertEq(S.currentPage, id, `現在ページが ${id} になること`);
  });
  try { showPage(beforePage || 'home'); } catch (e) {}
});

SelfTest.add('ホーム: ベントグリッドの全ブロックが揃い、グリッドCSSがある', () => {
  ['today-ring-card', 'home-countdown', 'home-stats', 'home-subj-prog', 'home-uni-prob', 'home-tasks', 'home-ach', 'live-band'].forEach(id => {
    assert(!!document.getElementById(id), `ホームに #${id} があること`);
  });
  const halves = document.querySelectorAll('#page-home .card.bento-half');
  assertEq(halves.length, 2, '半幅タイル（得点目標・合可能性）が2つあること');
  const css = Array.from(document.querySelectorAll('style')).map(el => el.textContent).join('\n');
  assert(css.includes('#page-home.active') && css.includes('grid-template-columns:1fr 1fr'), 'ホームのベントグリッドCSSがあること');
  assert(css.includes('.top-nav{'), '上部ナビのCSSがあること');
  assert(css.includes('.seg-row'), 'お金サブタブのセグメントCSSがあること');
  assert(css.includes('[data-style="modern"]'), 'すっきりモダンのCSSスコープがあること');
});

SelfTest.add('モデル選択: 既定値と未知IDの扱い', () => {
  assert(AVAILABLE_MODELS.includes(DEFAULT_MODEL), '既定モデルが一覧に含まれること');
  assert(!AVAILABLE_MODELS.includes('gemini-2.0-flash'), '提供終了モデルが一覧にないこと');
  assert(FALLBACK_MODELS.every(m => AVAILABLE_MODELS.includes(m)), 'フォールバック先が全て有効なモデルであること');
});

SelfTest.add('AI応答: thoughtパートを除いて本文を結合', () => {
  assertEq(AiService.extractText({ content: { parts: [{ thought: true, text: 'X' }, { text: 'あ' }, { text: 'い' }] } }), 'あい');
  assertEq(AiService.extractText(undefined), '');
});

SelfTest.add('AI応答: 出典の重複を除去', () => {
  const s = AiService.extractSources({ groundingMetadata: { groundingChunks: [
    { web: { uri: 'https://a.example/1', title: 'A' } },
    { web: { uri: 'https://a.example/1', title: 'A' } },
    { web: { uri: 'https://b.example/2', title: 'B' } }
  ] } });
  assertEq(s.length, 2, '同じURLは1件にまとめること');
});

SelfTest.add('チャット履歴: 件数制限・エラー除去・role結合', () => {
  const msgs = [
    { role: 'ai', text: '先頭のAIは捨てる' },
    { role: 'user', text: 'q1' },
    { role: 'ai', text: 'エラー: なにか' },
    { role: 'user', text: 'q2' },
    { role: 'ai', text: 'a2' }
  ];
  const h = buildApiHistory(msgs);
  assertEq(h[0].role, 'user', '履歴はuserから始まること');
  assertEq(h.length, 2, 'role連続はまとめられること');
  assert(!JSON.stringify(h).includes('エラー:'), 'エラーメッセージは送らないこと');
  assertEq(buildApiHistory(Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', text: 'm' + i }))).length, 20, '直近20件に制限されること');
});

SelfTest.add('教材検索: 日本語の文から内容語を取り出す', () => {
  const t1 = TB.terms('仮定法過去完了の作り方を教えて');
  assert(t1.primary.includes(normalizeForSearch('仮定法過去完了')), '漢字のかたまりを語として取れること');
  const t2 = TB.terms('ヘレニズム文化ってどんな特徴があるの？');
  assert(t2.primary.some(w => w.includes('文化')), '漢字語を拾えること');
  assert(!t2.primary.includes('ってどんな'), 'ひらがなだけの語（助詞・語尾）は使わないこと');
  // 正規化でカタカナはひらがなになる。判定を正規化の後でやると、
  // 「ヘレニズム」が助詞と同じ扱いで捨てられてしまうので、必ず残ることを見張る
  assert(t2.primary.includes(normalizeForSearch('ヘレニズム')), 'カタカナ語を捨てないこと');
  assert(TB.terms('ベクトルの内積').primary.includes(normalizeForSearch('ベクトル')), 'カタカナ語が漢字語と併存できること');
  assert(TB.terms('仮定法過去完了').fallback.length > 0, '長い語は刻んだ予備の語も用意すること');
});

SelfTest.add('教材の自動添付: 雑談には教材を混ぜない', () => {
  const w = ['今日', 'タスク', 'ヘレニズム', '問題', '中和滴定', '指示薬'].map(normalizeForSearch);
  // 15000ページの蔵書で、語ごとの出現ページ数がこうだったとする
  const topic = TB.topicTerms(w, [269, 4, 56, 3051, 27, 19], 15000);
  assert(!topic.includes(0), '日常語（今日）は話題語にしないこと');
  assert(!topic.includes(1), '教材にほとんど出ない語（タスク）は話題語にしないこと');
  assert(!topic.includes(3), 'どのページにも出る語（問題）は話題語にしないこと');
  assert(topic.includes(2) && topic.includes(4) && topic.includes(5), '教科の用語は話題語になること');
  assertEq(TB.topicTerms([normalizeForSearch('光合成')], [1], 200).length, 1, '蔵書が少ないときは1ページだけの語も話題語にすること');
  // 採用の判定
  assert(TB.autoQualifies([0, 0, 0, 0, 1, 1], [4, 5]), '話題語が2つそろったページは採用');
  assert(!TB.autoQualifies([0, 0, 0, 0, 1, 0], [4, 5]), '2つのうち1つだけでは採用しない');
  assert(TB.autoQualifies([0, 0, 3, 0, 0, 0], [2]), '話題語が1つだけの質問は、3回以上出るページなら採用');
  assert(!TB.autoQualifies([0, 0, 2, 0, 0, 0], [2]), '1〜2回出るだけのページは偶然かもしれないので採用しない');
  // 語の取り出し
  const at = TB.autoTerms('フランス革命の原因と係り結びの使い方').map(t => t.n);
  assert(at.includes(normalizeForSearch('フランス革命')), '隣り合う語はつないだ形も作ること');
  assert(at.includes(normalizeForSearch('係り結')), '送り仮名をはさむ語を拾うこと');
  assert(!at.some(t => t.includes('原因と')), '助詞でつながないこと');
  assert(TB.autoTerms('使い方').every(t => t.weak), '「〜方」は採否に使わないこと');
  assertEq(TB.autoTerms('いつも眠いんだけどどうすればいい？').length, 0, 'ひらがなだけの雑談からは語を取らないこと');
  // 同じ本のコピーが複数入っていても、同じページを何度もAIに渡さない
  const idxBackup = TB.index;
  try {
    TB.index = [{ id: 'a', chars: 1000 }, { id: 'b', chars: 1010 }, { id: 'c', chars: 400 }];
    const dd = TB.dedupeHits([
      { bookId: 'a', title: '世界史テキスト (1)', n: 22 }, { bookId: 'b', title: '世界史テキスト', n: 22 },
      { bookId: 'c', title: '世界史テキスト', n: 22 }, { bookId: 'a', title: '世界史テキスト (1)', n: 23 }]);
    assertEq(dd.map(h => h.bookId + h.n).join(','), 'a22,c22,a23', '同じ本のコピーの同じページは1つにまとめ、別の本（分量が違う）は残すこと');
  } finally { TB.index = idxBackup; }
  assert(TB.autoQualifies([0, 0, 0, 0, 3, 0], [4, 5], { loose: true }), '救済: そろうページが無いときは、1語が3回以上出るページを採用');
  assert(!TB.autoQualifies([0, 0, 0, 0, 2, 0], [4, 5], { loose: true }), '救済でも2回以下では採用しない');
  // 「優先」「休憩」のように全教科に散らばる一般語だけが当たったページは採用しない
  assert(!TB.autoQualifies([0, 0, 5, 0, 0, 0], [2], { focused: new Set() }), '特定の教科に集中する語が当たっていなければ採用しない');
  assert(TB.autoQualifies([0, 0, 1, 0, 1, 0], [2, 4], { focused: new Set([4]) }), '集中する語が1つでも当たっていれば採用');
  assert(TB.autoTerms('助動詞「けり」の意味').some(t => t.n === normalizeForSearch('けり')), 'かぎかっこの中の語はひらがなでも拾うこと');
});

SelfTest.add('AIコンテキスト: 不変部分と変動部分に分かれる', () => {
  const p = getContextParts();
  assert(p.stable.length > 0 && p.volatile.length > 0, '両方が作られること');
  assert(p.stable.includes('【1. 時間割】'), '不変部分が先頭に来ること（キャッシュを効かせるため）');
  assert(/今日は\d{4}-\d{2}-\d{2}/.test(p.volatile), '今日の日付は変動部分にあること');
  assert(!/今日は\d{4}-\d{2}-\d{2}/.test(p.stable), '不変部分に今日の日付が混ざらないこと');
  assert(getLightContext().length < p.stable.length + p.volatile.length, '軽いコンテキストは全体より短いこと');
  // 量が多くて切り詰めるときも、今日の情報（volatile）は必ず残すこと。
  // 末尾から単純に切ると「今日の評価」なのに今日の情報が無いプロンプトになる
  assert(/今日は\d{4}-\d{2}-\d{2}/.test(getComprehensiveContext()), '切り詰めても今日の情報が残ること');
});

SelfTest.add('AI送信: キャッシュを使っても毎回の前提が落ちない', () => {
  const pay = AiService.buildPayload({
    prompt: '質問本文', system: '今日の情報', history: [], model: 'gemini-3.8-flash',
    cachedContent: 'cachedContents/dummy'
  });
  assert(!pay.systemInstruction, 'キャッシュ使用時は systemInstruction を送らないこと');
  assert(JSON.stringify(pay).includes('今日の情報'), '毎回変わる前提は本文に載せること');
  const plain = AiService.buildPayload({ prompt: 'q', system: 'sys', history: [], model: 'gemini-3.8-flash' });
  assert(plain.systemInstruction.parts[0].text === 'sys', '通常時は systemInstruction で送ること');
});

SelfTest.add('Gemini 4 Argon: 思考レベル・キャッシュ・代替先・無料枠エラー', () => {
  assert(AVAILABLE_MODELS.includes('gemini-4-argon'), '選べるモデルに入っていること');
  assert(!FALLBACK_MODELS.includes('gemini-4-argon'), '混雑時の代替先に高いモデルを入れないこと');
  assert(DEFAULT_MODEL !== 'gemini-4-argon', '既定は有料専用モデルにしないこと');
  const p = AiService.buildPayload({ prompt: 'q', system: 's', history: [], model: 'gemini-4-argon', thinkingLevel: 'high' });
  assertEq(p.generationConfig?.thinkingConfig, { thinkingLevel: 'high' }, 'Argon にも思考レベルを送ること');
  const old = AiService.buildPayload({ prompt: 'q', system: 's', history: [], model: 'gemini-2.5-flash', thinkingLevel: 'high' });
  assert(!old.generationConfig?.thinkingConfig, '2.5 系には思考レベルを送らないこと');
  assert(NO_EXPLICIT_CACHE_MODELS.includes('gemini-4-argon'), 'Argon は明示キャッシュを作らないこと');
  const e = AiService.classifyError(429, 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-4-argon', {});
  assert(/無料枠/.test(e.msg || ''), '無料枠のキーで呼んだときは「1分待って」ではなくモデル変更を案内すること');
  const busy = AiService.classifyError(429, 'Resource has been exhausted (e.g. check quota).', {});
  assert(/1分/.test(busy.msg || ''), '普通の回数オーバーは従来どおり待つよう案内すること');
});

SelfTest.add('Web検索: AIに道具は渡しつつ、念押しは必要なときだけ', () => {
  const before = window._chatForceSearch;
  window._chatForceSearch = null;
  // 道具は既定で渡す（AIがアプリ外の情報も読めるように）。使うかどうかはAIが決める
  assert(shouldUseWebSearch('やる気が出ないときどうすればいい', false), '既定では検索ツールを渡すこと');
  assert(!shouldUseWebSearch('阪大の倍率は？', true), '教材を自分で添付したときは渡さないこと');
  // 「必ず調べて」と念を押すのは、外の・変わる情報を聞かれたときだけ
  assert(shouldUrgeWebSearch('阪大の倍率はどれくらい？'), '入試情報は必ず調べさせること');
  assert(shouldUrgeWebSearch('出願の締切はいつまで？'), '日程の質問は必ず調べさせること');
  assert(!shouldUrgeWebSearch('いつも眠いんだけどどうすればいい？'), '日常の相談で念押ししないこと');
  window._chatForceSearch = false;
  assert(!shouldUseWebSearch('阪大の倍率は？', false), '手動でオフにしたら渡さないこと');
  assert(!shouldUrgeWebSearch('阪大の倍率は？'), '手動でオフなら念押しもしないこと');
  window._chatForceSearch = true;
  assert(shouldUseWebSearch('なんでもいい', true) && shouldUrgeWebSearch('なんでもいい'), '手動でオンなら必ず調べさせること');
  window._chatForceSearch = before;
});

SelfTest.add('あいまい検索: 表記ゆれを吸収', () => {
  assert(fuzzyMatch('ベクトルの内積', 'べくとる'), 'カタカナとひらがなを同一視すること');
  assert(fuzzyMatch('数学ⅡＢ', '数学2b'), '全角と半角を同一視すること');
  assert(!fuzzyMatch('英語長文', 'ぜんぜん関係ない語'), '無関係な語は一致しないこと');
});

SelfTest.add('出願: 受験日の重複検出', () => {
  const backup = S.applications;
  S.applications = [
    { id: '1', name: 'A大', method: '前期', examDate: '2027-02-25' },
    { id: '2', name: 'B大', method: '前期', examDate: '2027-02-25' },
    { id: '3', name: 'C大', method: '後期', examDate: '2027-03-12' }
  ];
  const c = findDateConflicts();
  assertEq(c.length, 1, '重複している日が1つ検出されること');
  assertEq(c[0].items.length, 2);
  assert(!c[0].soft, '1日だけの試験どうしは、どちらかしか受けられない重複として扱うこと');
  assertEq(calcFeeTotal(), 0, '受験料未入力なら合計0円');
  // 期間の中から受験日を選ぶ方式どうしは「期間が重なるだけ」として区別する
  S.applications = [
    { id: '1', name: 'R大', method: '前期', examDate: '2027-02-01', examDateEnd: '2027-02-04' },
    { id: '2', name: 'R大', method: '前期', examDate: '2027-02-01', examDateEnd: '2027-02-04' },
    { id: '3', name: 'D大', method: '前期', examDate: '2027-02-03' }
  ];
  const c2 = findDateConflicts();
  assertEq(c2.length, 4, '重なっている4日がすべて検出されること');
  assert(c2.every(x => x.soft), '1日だけの試験が1つ以下なら、期間の重なりとして扱うこと');
  S.applications = backup;
});

// 実データとDB書き込みを隔離して走らせる（withIsolatedStudyData）。
// 以前は本物の recordStudy をそのまま呼んでいたため、セルフチェックを押すたびに
// クラウドへ「2000-01-01」の空の学習ログが書き込まれ、グラフに残り続けていた。
SelfTest.add('学習時間: 記録と取り消しで収支が合う', () => withIsolatedStudyData(() => {
  const d = '2000-01-01';   // テスト専用の過去日
  S.dailyLogs = {}; S.studyTime = {}; S.totalMinutes = 0;
  recordStudy('英語', 30, d);
  assertEq(S.totalMinutes, 30, '記録すると合計が増えること');
  assertEq(S.dailyLogs[d].total, 30);
  recordStudy('英語', '15', d);
  assertEq(S.dailyLogs[d].total, 45, '文字列の分数も数値として足されること');
  unrecordStudy('英語', 45, d);
  assertEq(S.totalMinutes, 0, '取り消すと合計が元に戻ること');
  assertEq(S.studyTime['英語'] || 0, 0, '科目別も元に戻ること');
  assertEq(S.dailyLogs[d].total, 0);
}));

SelfTest.add('出願: AIの値の検査と空欄判定', () => {
  const F = APP_FIELD_BY_KEY;
  assertEq(normalizeAppAiValue(F.examDate, '2027-02-25'), '2027-02-25', '正しい日付は通すこと');
  assertEq(normalizeAppAiValue(F.examDate, '2027-02-30'), '', '存在しない日付は弾くこと');
  assertEq(normalizeAppAiValue(F.examDate, '2月25日'), '', '年のない日付は弾くこと');
  assertEq(normalizeAppAiValue(F.fee, '17,000円'), 17000, '金額は数値にすること');
  assertEq(normalizeAppAiValue(F.url, 'javascript:alert(1)'), '', '危険なURLは弾くこと');
  assertEq(normalizeAppAiValue(F.venue, '不明'), '', '「不明」は空欄として扱うこと');
  const blanks = appBlankFields({ method: '共テ利用', dep: '経済学部' }).map(f => f.key);
  assert(!blanks.includes('examDate') && !blanks.includes('venue'), '共テ利用では個別試験の項目を求めないこと');
  assert(blanks.includes('applyEnd') && blanks.includes('fee'), '出願締切と受験料は求めること');
  assertEq(appExamDays({ examDate: '2027-02-25', examDateEnd: '2027-02-26' }), ['2027-02-25', '2027-02-26'], '複数日の試験は全日程を返すこと');
  assertEq(AiService.admissionYear(new Date(2026, 8, 20)), 2027, '9月は翌年度入試');
  assertEq(AiService.admissionYear(new Date(2027, 1, 25)), 2027, '2月はその年度入試');
});

SelfTest.add('同期: サーバーへ送る形に整える', () => {
  const msg = { id: 'm1', _dirty: true, fileData: { mimeType: 'image/png', base64: 'AAAA', isImage: true } };
  const out = DbService._forServer('chatHistory', msg);
  assertEq(out.fileData.base64, undefined, '添付の中身はメッセージ本体に載せないこと');
  assertEq(out.fileData.hasFile, true);
  assertEq(out._dirty, undefined, '端末内だけの印は送らないこと');
  assertEq(msg.fileData.base64, 'AAAA', '元のオブジェクトは書き換えないこと');
  const p = profileForServer();
  assert(!('currentPage' in p) && !('calMonth' in p), '画面の状態は同期しないこと');
  assert(!('applications' in p) && !('trash' in p), '一覧データはプロフィールに入れないこと');
});

SelfTest.add('バックアップ検証: 正しいスナップショットを通す', () => {
  // 本物のスナップショットと同じく、すべての項目がそろった形で検査する
  const full = (extra = {}) => ({ tasks: [{ id: 't1' }], unis: [], mocks: [], events: [], dailyLogs: {}, studyTime: {}, scoreTargets: {}, timerLogs: [], timetable: {}, homework: [], mockSchedule: [], specials: [], extras: [], repeatEvents: [], chatHistory: [], chatThreads: [], notes: [], heatmapData: {}, applications: [], pastExams: [], trash: [], userName: '', userGrade: '', nijiDate: '', aiModel: '', ...extra });
  const snap = validateBackupSnapshot({ version: '2027.10.24-4', createdAt: 1760000000000, date: '2026-10-24', data: full() });
  assertEq(snap.version, '2027.10.24-4');
  assertEq(snap.createdAt, 1760000000000);
  assertEq(snap.date, '2026-10-24');
  assertEq(snap.data.tasks.length, 1);
  const bare = validateBackupSnapshot(full({ tasks: [], unis: [] }));
  assert(Array.isArray(bare.data.tasks), 'データ本体だけの形も受け付けること');
});

SelfTest.add('バックアップ検証: おかしなデータは弾く', () => {
  const bad = [null, undefined, '文字列', 42, [], {}, { data: null }, { data: '文字列' }, { data: {} }, { foo: 1 }];
  for (const b of bad) {
    let threw = false;
    try { validateBackupSnapshot(b); } catch (e) { threw = true; assert(e.message && e.message.length > 0, '日本語のエラーメッセージがあること'); }
    assert(threw, `弾くべきデータを素通ししました: ${JSON.stringify(b)}`);
  }
});

SelfTest.add('バックアップ検証: 一部の項目だけのスナップショットは弾く', () => {
  for (const b of [{ version: 'x', data: { tasks: [] } }, { tasks: [] }]) {
    let threw = false;
    try { validateBackupSnapshot(b); } catch (e) { threw = true; }
    assert(threw, `一部だけのデータを素通ししました: ${JSON.stringify(b)}`);
  }
});

SelfTest.add('日付ユーティリティ: 壊れた日付は「今日」にならず無効になる', () => {
  assert(isNaN(DateManager.parseSafe('2027-02-30')), '存在しない日付は無効になること');
  assert(isNaN(DateManager.parseSafe('garbage')), '日付でない文字列は無効になること');
  assert(isNaN(DateManager.parseSafe('')), '空文字は無効になること');
  assert(!isNaN(DateManager.parseSafe('2027-02-28')), '正しい日付は読めること');
});

SelfTest.add('バックアップ容量: 文字数でなくバイト数で判定する', () => {
  assert(Backup._tooBigForCloud('あ'.repeat(300000)) === true, '30万文字でも日本語なら90万バイトで上限超え');
  assert(Backup._tooBigForCloud('a'.repeat(700000)) === false, '70万バイトは上限内');
  assert(Backup._tooBigForCloud('a'.repeat(900000)) === true, '90万バイトは上限超え');
});

SelfTest.add('同期: 保留キューは覗くだけでは消えず、成功後にだけ消える', () => {
  const id = 'selftest-x', dKey = '2000-01-01';
  const hasDel = () => Pending.peekDels().some(d => d.col === 'tasks' && d.id === id);
  const hasLog = () => Pending.peekLogs().includes(dKey);
  try {
    Pending.addDel('tasks', id);
    assert(hasDel(), '削除の控えが積まれること');
    assert(hasDel(), '覗いただけでは削除の控えが消えないこと');
    Pending.removeDel('tasks', id);
    assert(!hasDel(), '成功後に削除の控えが消えること');
    Pending.addLog(dKey);
    assert(hasLog(), '日別ログの控えが積まれること');
    assert(hasLog(), '覗いただけでは日別ログの控えが消えないこと');
    Pending.removeLog(dKey);
    assert(!hasLog(), '成功後に日別ログの控えが消えること');
  } finally {
    // 失敗しても試験用の控えを残さない
    Pending.removeDel('tasks', id); Pending.removeLog(dKey);
  }
});

SelfTest.add('バス: 出発した直後のバスは次便に残らない', () => {
  const sched = ['10:00', '10:30', '11:00'];
  assertEq(window.nextBusDeps(sched, new Date(2026, 9, 26, 10, 0, 30)), ['10:30', '11:00'], '10:00:30 には10:00の便を出さないこと');
  assertEq(window.nextBusDeps(sched, new Date(2026, 9, 26, 10, 0, 0))[0], '10:00', 'ちょうど10:00:00 なら10:00の便を出すこと');
});

SelfTest.add('エスケープ: HTMLタグを無害化', () => {
  assertEq(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assertEq(esc(null), '');
});

SelfTest.add('出典URL: 危険なスキームをリンクにしない', () => {
  assert(safeUrl('https://example.com/a').startsWith('https://'), 'httpsは通すこと');
  assertEq(safeUrl('javascript:alert(1)'), '', 'javascript: は弾くこと');
  assertEq(safeUrl('data:text/html,<script>'), '', 'data: は弾くこと');
  assertEq(safeUrl(''), '');
  const html = renderSources([{ title: 'x', uri: 'javascript:alert(1)' }]);
  assert(!/href=/.test(html), '危険なURLはaタグにしないこと');
});

// 集計まわりのテストは、実データとDB書き込みを隔離して走らせる
const withIsolatedStudyData = (fn) => {
  const backup = JSON.parse(JSON.stringify({ st: S.studyTime, dl: S.dailyLogs, tl: S.timerLogs, tm: S.totalMinutes, wt: S.weekdayTime, mt: S.monthlyTime, ua: S.unlockedAchs || [] }));
  const real = { s: DbService.set, d: DbService.del, p: DbService.setMainProfile, l: DbService.setDailyLog, r: DbService.replaceField };
  DbService.set = async () => {}; DbService.del = async () => {}; DbService.setMainProfile = async () => {}; DbService.setDailyLog = async () => {}; DbService.replaceField = async () => {};
  try { fn(); }
  finally {
    S.studyTime = backup.st; S.dailyLogs = backup.dl; S.timerLogs = backup.tl;
    S.totalMinutes = backup.tm; S.weekdayTime = backup.wt; S.monthlyTime = backup.mt; S.unlockedAchs = backup.ua;
    DbService.set = real.s; DbService.del = real.d; DbService.setMainProfile = real.p; DbService.setDailyLog = real.l; DbService.replaceField = real.r;
    lsSave();   // テスト中の値が端末内に保存されていた場合に備えて、元の状態で保存し直す
  }
};

SelfTest.add('科目の統合: 合計を変えずに寄せられる', () => withIsolatedStudyData(() => {
  S.studyTime = { '英語': 60, '英文読解S': 30 };
  S.dailyLogs = { '2000-01-01': { total: 90, subjects: { '英語': 60, '英文読解S': 30 } } };
  S.timerLogs = [{ id: 'z1', subj: '英語', min: 60, date: '2000-01-01' }];
  mergeSubject('英語', '英文読解S');
  assertEq(S.studyTime['英語'], undefined, '統合元は消えること');
  assertEq(S.studyTime['英文読解S'], 90, '統合先に合算されること');
  assertEq(S.dailyLogs['2000-01-01'].subjects['英文読解S'], 90, '日別ログも合算されること');
  assertEq(S.dailyLogs['2000-01-01'].total, 90, '合計学習時間は変わらないこと');
  assertEq(S.timerLogs[0].subj, '英文読解S', '個々の記録の科目名も書き換わること');
}));

SelfTest.add('集計の再構築: ズレた合計が日別ログから直る', () => withIsolatedStudyData(() => {
  S.dailyLogs = {
    '2027-01-04': { total: 90, subjects: { '英文読解S': 60, '数学YN 1': 30 } },   // 月曜
    '2027-02-06': { total: 60, subjects: { '英文読解S': 60 } }                    // 土曜
  };
  // わざと壊した状態から復元できるか
  S.studyTime = { '英文読解S': 999, '存在しない科目': 500 };
  S.totalMinutes = 0; S.weekdayTime = [9,9,9,9,9,9,9]; S.monthlyTime = new Array(12).fill(9);
  const r = rebuildStudyTotals({ persist: false });
  assertEq(S.totalMinutes, 150, '総学習時間が日別ログの合計になること');
  assertEq(S.studyTime['英文読解S'], 120, '科目別が正しく再計算されること');
  assertEq(S.studyTime['数学YN 1'], 30);
  assertEq(S.studyTime['存在しない科目'], undefined, '実体のない科目が消えること');
  assertEq(S.weekdayTime[1], 90, '月曜の合計が入ること');
  assertEq(S.weekdayTime[6], 60, '土曜の合計が入ること');
  assertEq(S.monthlyTime[0], 90, '1月の合計が入ること');
  assertEq(S.monthlyTime[1], 60, '2月の合計が入ること');
  assert(r.changed, '変化があったと報告されること');
}));

SelfTest.add('集計の再構築: 二重に走らせても値が増えない', () => withIsolatedStudyData(() => {
  S.dailyLogs = { '2027-01-04': { total: 90, subjects: { '英文読解S': 90 } } };
  rebuildStudyTotals({ persist: false });
  const first = JSON.stringify({ st: S.studyTime, tm: S.totalMinutes, wt: S.weekdayTime });
  rebuildStudyTotals({ persist: false });
  rebuildStudyTotals({ persist: false });
  assertEq(JSON.stringify({ st: S.studyTime, tm: S.totalMinutes, wt: S.weekdayTime }), first, '何度実行しても同じ結果になること');
}));

SelfTest.add('リンクからのAPIキー取り込み: 形式チェック', () => {
  // ここに本物のキーを書くと公開サイトのJSに載ってしまうので、必ずダミーを使うこと
  const valid = /^AIza[\w-]{30,}$/;
  assert(valid.test('AIza' + 'X'.repeat(35)), '正しい形式のキーを受け入れること');
  assert(!valid.test('AIza123'), '短すぎるキーを弾くこと');
  assert(!valid.test('javascript:alert(1)'), '不正な文字列を弾くこと');
  assert(!valid.test(''), '空文字を弾くこと');
});

SelfTest.add('科目名の正規化: 表記の違いだけを同一視する', () => {
  assertEq(subjectNorm('世界史2(欧米編)'), subjectNorm('世界史2（欧米編）'), '括弧の全半角は同じ科目とみなすこと');
  assertEq(subjectNorm('英文法S Part1'), subjectNorm('英文法Spart1'), '空白と大小文字を無視すること');
  assertEq(subjectNorm('数学YN 1'), subjectNorm('数学YN §1'), '節記号の有無は同じ科目とみなすこと');
  assertEq(subjectNorm('世界史2（欧米編）'), subjectNorm('世界史Ⅱ（欧米編）'), 'ローマ数字と算用数字を同一視すること');
  assertEq(subjectNorm('情報1'), subjectNorm('情報Ⅰ'));
  // 意味が変わりうるものは別物のまま
  assert(subjectNorm('数学YN §1') !== subjectNorm('数学YN §2'), '別の講座は区別すること');
  assert(subjectNorm('古文S（購読編）') !== subjectNorm('古文S（講読編）'), '漢字が違うものは自動統合しないこと');
});

SelfTest.add('時間割: 追加・編集・削除が往復する', () => {
  const snap = JSON.parse(JSON.stringify(S.timetable));
  const real = { p: DbService.setMainProfile, r: DbService.replaceField };
  DbService.setMainProfile = async () => {}; DbService.replaceField = async () => {};
  try {
    if (!S.timetable['月']) S.timetable['月'] = {};
    S.timetable['月']['8限'] = { subj: '__test__', room: '99号', teacher: 'テスト' };
    assertEq(S.timetable['月']['8限'].subj, '__test__', '追加できること');
    assert(getTimetableSubjects().includes('__test__'), '科目一覧に反映されること');
    delete S.timetable['月']['8限'];
    assertEq(S.timetable['月']['8限'], undefined, '削除できること');
    assert(!getTimetableSubjects().includes('__test__'), '削除が科目一覧に反映されること');
  } finally {
    S.timetable = snap;
    DbService.setMainProfile = real.p; DbService.replaceField = real.r;
  }
});

SelfTest.add('ノートのキーワードが配列でなくても壊れない', () => {
  assertEq(noteKeywords({ keywords: ['a', 'b'] }), ['a', 'b']);
  assertEq(noteKeywords({ keywords: '英語,文法' }), ['英語', '文法']);
  assertEq(noteKeywords({ keywords: 123 }), []);
  assertEq(noteKeywords({}), []);
  assertEq(noteKeywords(null), []);
});

SelfTest.add('プッシュ通知: VAPID公開鍵と購読データの形', () => {
  const keyBytes = _b64ToBytes(VAPID_PUBLIC_KEY);
  assertEq(keyBytes.length, 65, 'VAPID公開鍵は65バイト（非圧縮の楕円曲線点）');
  assertEq(keyBytes[0], 0x04, '先頭は非圧縮点の印 0x04');
  // 購読の保存形式（ブラウザの PushSubscription と同じ形のモックで確認）
  const fakeSub = { endpoint: 'https://push.example/abc', toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'PK', auth: 'AK' } }) };
  assertEq(PushUI._subPayload(fakeSub), { endpoint: 'https://push.example/abc', keys: { p256dh: 'PK', auth: 'AK' } }, '購読→保存形式の変換');
  assertEq(typeof PushUI.isSupported(), 'boolean', '対応判定が例外なく真偽値を返す');
  assertEq(typeof window.togglePush, 'function', 'オン／オフのトグル用ハンドラがあること');
});

SelfTest.add('入試情報ウォッチ: 未読の抽出とカード生成', () => {
  const ups = [
    { id: '1', uni: '同志社大学', url: 'https://www.doshisha.ac.jp/admission/', at: '2026-12-01T00:00:00Z', snippet: '出願要項を公開', read: false },
    { id: '2', uni: '立命館大学', url: 'https://admission.ritsumei.ac.jp/', at: '2026-12-02T00:00:00Z', snippet: '', read: true },
    { id: '3', uni: '<悪意>', url: 'https://kindai.jp/', at: '2026-12-03T00:00:00Z', snippet: 'x', read: false }
  ];
  assertEq(AdmWatchUI._unread(ups).map(u => u.id), ['1', '3'], '未読だけを順序そのままに');
  assertEq(AdmWatchUI._unread(null), [], 'null でも空配列');
  const html = AdmWatchUI._cardHtml(ups);
  assert(html.includes('同志社大学') && html.includes('出願要項を公開'), '未読の大学名と差分が出る');
  assert(!html.includes('立命館大学'), '既読は出さない');
  assert(html.includes('&lt;悪意&gt;'), '大学名はエスケープされる');
  assertEq(AdmWatchUI._cardHtml(ups.map(u => ({ ...u, read: true }))), '', '全部既読ならカードなし');
});

SelfTest.add('AIモデル: おまかせ自動の振り分けと手動の尊重', () => {
  const savedMode = localStorage.getItem('jukenAiModelMode');
  const savedModel = localStorage.getItem('geminiModel');
  try {
    // 自動: 軽い処理は Lite、本生成は既定モデル。高額モデルは自動で選ばれない
    AiModelMode.set('auto');
    assertEq(AiModelMode.autoModelFor('fast'), 'gemini-3.5-flash-lite', 'fast は最安モデルへ');
    assertEq(AiModelMode.autoModelFor('normal'), DEFAULT_MODEL, 'normal は既定モデル');
    assertEq(AiModelMode.autoModelFor('deep'), DEFAULT_MODEL, 'deep も既定モデル（Argonに化けない）');
    assertEq(AiModelMode.resolve('fast'), 'gemini-3.5-flash-lite', '自動モードで fast を解決');
    assertEq(AiModelMode.resolve('normal'), DEFAULT_MODEL, '自動モードで normal を解決');
    // 手動: 保存したモデル（Argon 含む）を常に尊重する
    AiModelMode.set('manual');
    localStorage.setItem('geminiModel', 'gemini-4-argon');
    const sel = document.getElementById('set-model');
    if (sel) sel.value = 'gemini-3.8-flash'; // 選択欄が別でも保存値が効く状況を作らないよう揃える対象外にする
    assertEq(AiModelMode.resolve('fast'), AiService.getModel(), '手動モードは getModel と一致');
    assertEq(AiModelMode.resolve('normal'), AiService.getModel(), '手動モードは用途で変えない');
  } finally {
    if (savedMode == null) localStorage.removeItem('jukenAiModelMode'); else localStorage.setItem('jukenAiModelMode', savedMode);
    if (savedModel == null) localStorage.removeItem('geminiModel'); else localStorage.setItem('geminiModel', savedModel);
    const sel = document.getElementById('set-model');
    if (sel && savedModel) sel.value = savedModel;
  }
});

SelfTest.add('AIコスト: 単価の期間切替と概算計算', () => {
  // Argon は 2026-11-30 まで $2/$10、12月から $4/$20
  assertEq(AiCost.priceFor('gemini-4-argon', '2026-11-30').input, 2, 'Argon 11月末までの入力単価');
  assertEq(AiCost.priceFor('gemini-4-argon', '2026-12-01').input, 4, 'Argon 12月からの入力単価');
  // 3.8 Flash は 2026-12-31 まで $0.75/$3.75、翌年から $1.50/$7.50
  assertEq(AiCost.priceFor('gemini-3.8-flash', '2026-12-31').output, 3.75, 'Flash 年内の出力単価');
  assertEq(AiCost.priceFor('gemini-3.8-flash', '2027-01-01').output, 7.5, 'Flash 年明けの出力単価');
  // 100万入力 + 100万出力（Flash・年内）= (0.75+3.75)ドル × 155円 = 697.5円
  const yen = AiCost.estimateYen('gemini-3.8-flash', 1000000, 1000000, '2026-10-27');
  assert(Math.abs(yen - 697.5) < 0.01, '概算コストの計算が合う（実際: ' + yen + '）');
  assertEq(AiCost.estimateYen('gemini-3.8-flash', 0, 0, '2026-10-27'), 0, 'トークン0なら0円');
});

SelfTest.add('AI利用量: 月次集計とモデル別内訳', () => {
  const usage = { days: {
    '2026-10-01': { 'gemini-3.8-flash': { calls: 2, in: 100, out: 50 } },
    '2026-10-31': { 'gemini-3.8-flash': { calls: 1, in: 10, out: 5 }, 'gemini-4-argon': { calls: 1, in: 1000, out: 2000 } },
    '2026-09-30': { 'gemini-3.8-flash': { calls: 9, in: 999, out: 999 } }
  } };
  const t = AiUsageUI._monthTotals(usage, '2026-10');
  assertEq(t.calls, 4, '対象月の回数だけ数える');
  assertEq(t.in, 1110, '入力トークンの合計');
  assertEq(t.out, 2055, '出力トークンの合計');
  assertEq(t.byModel['gemini-4-argon'].calls, 1, 'モデル別内訳');
  assertEq(AiUsageUI._monthTotals(null, '2026-10').calls, 0, 'null でも壊れない');
  const yen = AiUsageUI._monthCostYen(t, '2026-10');
  assert(yen > 0, '概算コストが正の値になる');
});

SelfTest.add('エラー自動送信: 送信ペイロードの整形', () => {
  const long = 'x'.repeat(500);
  const body = ErrorReport.build({ type: 'error', message: long, source: long, page: 'home' });
  assertEq(body.message.length, 300, 'メッセージは300字で切る');
  assertEq(body.source.length, 200, '発生箇所は200字で切る');
  assertEq(body.version, APP_VERSION, 'バージョンが入る');
  assertEq(Object.keys(body).sort(), ['message', 'page', 'source', 'type', 'version'], '送る項目はこの5つだけ（入力内容は含めない）');
});

SelfTest.add('朝ブリーフィング: 今日の分がある時だけ出る', () => {
  assertEq(LiveDocsUI._briefingCardHtml(null, '2026-10-28'), '', '未取得なら出さない');
  assertEq(LiveDocsUI._briefingCardHtml({ days: {} }, '2026-10-28'), '', '今日の分が無ければ出さない');
  assertEq(LiveDocsUI._briefingCardHtml({ days: { '2026-10-27': { text: '昨日の分' } } }, '2026-10-28'), '', '昨日の分は出さない');
  const html = LiveDocsUI._briefingCardHtml({ days: { '2026-10-28': { text: 'おはよう。今日は数学を中心に。' } } }, '2026-10-28');
  assert(html.includes('おはよう。今日は数学を中心に。'), '今日の文面が出る');
  assert(html.includes('今日のブリーフィング'), '見出しが出る');
});

SelfTest.add('サブスク価格アラート: 未読だけ出て、既読は消える', () => {
  const data = { alerts: [{ id: 'a1', kind: 'subs-price', subName: 'Google AI Pro', registeredAmount: 2900, chargedAmount: 3200, diff: 300, date: '2026-11-21', read: false }] };
  assertEq(LiveDocsUI._alertsCardHtml(null, new Set()), '', '未取得なら出さない');
  assertEq(LiveDocsUI._alertsCardHtml({ alerts: [] }, new Set()), '', 'アラートが無ければ出さない');
  const html = LiveDocsUI._alertsCardHtml(data, new Set());
  assert(html.includes('Google AI Pro'), 'サブスク名が出る');
  assert(html.includes('値上げの可能性'), '値上げの注記が出る');
  assertEq(LiveDocsUI._alertsCardHtml(data, new Set(['a1'])), '', '端末で既読にしたものは出ない');
  assertEq(LiveDocsUI._alertsCardHtml({ alerts: [{ ...data.alerts[0], read: true }] }, new Set()), '', 'サーバー側で既読のものは出ない');
});

SelfTest.add('週次レビューとチャット要約: データがある時だけ中身が出る', () => {
  assert(LiveDocsUI._weeklyHtml(null).includes('自動生成されます'), '未取得なら案内文');
  const w = LiveDocsUI._weeklyHtml({ latest: '2026-W44', entries: { '2026-W44': { text: '先週は英語が伸びた。', generatedAt: '2026-11-02T06:45:00+09:00' } } });
  assert(w.includes('先週は英語が伸びた。'), '最新の週次レビューが出る');
  assertEq(LiveDocsUI._chatSummaryHtml(null), '', '要約が無ければ出さない');
  const c = LiveDocsUI._chatSummaryHtml({ summary: '数学の勉強法を相談していた。', updatedAt: '2026-11-02T06:45:00+09:00' });
  assert(c.includes('数学の勉強法を相談していた。'), 'チャット要約が出る');
  assert(c.includes('前回までの要約'), '見出しが出る');
});

SelfTest.add('月次家計レポート: 集計と月切替の材料が描ける', () => {
  const data = { reports: {
    '2026-09': { month: '2026-09', expenseTotal: 41767, incomeTotal: 40027, totalAssets: 28088, prevDiff: 1000, prevPct: 2, byCategory: [{ name: '現金・カード', amount: 25000 }, { name: '通信費', amount: 9252 }], top: [{ date: '2026-09-01', title: 'GOOGLE*CLOUD', amount: 5000 }], comment: '先月は通信費が中心でした。' },
    '2026-08': { month: '2026-08', expenseTotal: 40767, incomeTotal: 0, totalAssets: 0, byCategory: [], top: [], comment: '' }
  } };
  assertEq(HouseholdReportUI._months(data), ['2026-09', '2026-08'], '月は新しい順');
  const html = HouseholdReportUI._html(data, '2026-09');
  assert(html.includes('月次家計レポート'), '見出しが出る');
  assert(html.includes('現金・カード'), 'カテゴリが出る');
  assert(html.includes('先月は通信費が中心でした'), 'AIコメントが出る');
  const old = HouseholdReportUI._html(data, '2026-08');
  assert(!old.includes('先月は通信費が中心でした'), '月の切替で別レポートになる');
  assert(HouseholdReportUI._html(null, null).includes('まだありません'), '未取得なら空の案内');
  assert(MoneyTab.TABS.some(t => t.id === 'report'), 'お金タブに月次レポートがある');
});

SelfTest.add('健全性カード: 異常があるときだけ出る', () => {
  assertEq(ServerDiagUI._healthCardHtml(null), '', '未取得なら出さない');
  assertEq(ServerDiagUI._healthCardHtml({ ok: true, issues: [] }), '', '正常なら出さない');
  const html = ServerDiagUI._healthCardHtml({ ok: false, issues: [{ key: 'money-stale', msg: 'お金タブの自動更新が止まっています' }] });
  assert(html.includes('お金タブの自動更新が止まっています'), '異常の文言が出る');
  const evil = ServerDiagUI._healthCardHtml({ ok: false, issues: [{ key: 'x', msg: '<script>悪意</script>' }] });
  assert(evil.includes('&lt;script&gt;'), '文言はエスケープされる');
});

window.runSelfTest = () => {
  const el = document.getElementById('selftest-c');
  const results = SelfTest.run();
  const failed = results.filter(r => !r.ok);
  if (el) {
    el.innerHTML = `<div style="font-size:13px;font-weight:700;margin-bottom:8px;color:${failed.length ? 'var(--a2)' : 'var(--accent)'}">
        ${failed.length ? `❌ ${failed.length}件 失敗` : '✅ すべて成功'}（${results.length}件中）
      </div>`
      + results.map(r => `<div style="font-size:12px;padding:3px 0;color:${r.ok ? 'var(--muted)' : 'var(--a2)'}">
          ${r.ok ? '✅' : '❌'} ${esc(r.name)}${r.ok ? '' : '<br><span style="padding-left:20px">' + esc(r.error) + '</span>'}
        </div>`).join('');
  }
  console.table(results);
  return results;
};

// ------------------------------------------------------------
// 🔑 リンクからのAPIキー設定
// URLの「#key=...」でキーを渡せるようにする。入力の手間を省きつつ、
// キーをアプリのソースに埋め込まずに済む（埋め込むと公開サイトなので誰でも読めてしまう）。
// # より後ろはサーバーに送信されないため、通信ログにも残らない。
// 取り込んだ直後にURLから消すので、履歴や共有時にも残らない。
// ------------------------------------------------------------
const applyKeyFromUrl = () => {
  const m = location.hash.match(/[#&]key=([^&]*)/);
  if (!m) return;
  const key = decodeURIComponent(m[1] || '').trim();
  // 何よりも先にURLから消す（あとで失敗しても残らないように）
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  if (!key) return;
  if (!/^AIza[\w-]{30,}$/.test(key)) { showToast('APIキーの形式が正しくないため取り込みませんでした', 'error', 5000); return; }
  // 他人が作ったリンクを踏まされる可能性もあるので、必ず本人に確認する
  showConfirm('🔑 APIキーを設定',
    `リンクに含まれていたAPIキー（${esc(key.slice(0, 8))}…）をこの端末に保存しますか？\nこの端末にのみ保存され、他の人には共有されません。`,
    '保存する',
    () => {
      try {
        localStorage.setItem('geminiApiKey', key);
        const el = document.getElementById('set-api-key');
        if (el) el.value = key;
        showToast('✅ APIキーを保存しました。AI機能が使えます', 'success', 5000);
      } catch (e) { showToast('保存に失敗しました: ' + e.message, 'error'); }
    });
};

// すでにアプリを開いている状態でリンクを踏むと、ページは再読み込みされず
// URLの「#」だけが変わる。その場合もここで拾う。
window.addEventListener('hashchange', () => { try { applyKeyFromUrl(); } catch (e) {} });

// ------------------------------------------------------------
// 起動
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // バージョン表示
  const vEl = document.getElementById('app-version');
  if (vEl) vEl.textContent = `v${APP_VERSION}（${APP_BUILT_AT}）`;

  registerServiceWorker();
  applyKeyFromUrl();
  // 全ファイルの読み込みが終わる前に届いた同期データを、ここで画面に反映する
  if (typeof flushPendingRefresh === 'function') flushPendingRefresh();
  // 機能追加より前から積み上がっている時間ぶんは、通知なしで既達扱いにする
  if (typeof checkAchievements === 'function' && !localStorage.getItem('jukenAchBackfilled')) {
    checkAchievements(true);
    localStorage.setItem('jukenAchBackfilled', '1');
  }
  if (typeof window.restoreRunningTimer === 'function') window.restoreRunningTimer();
  if (typeof window.renderApplications === 'function') window.renderApplications();
  if (typeof window.renderExamPlan === 'function') window.renderExamPlan();
  if (typeof window.renderKyotsu === 'function') window.renderKyotsu();
  if (typeof window.renderPrivSim === 'function') window.renderPrivSim();
  if (typeof window.renderPastExams === 'function') window.renderPastExams();
  if (typeof window.renderTextbooks === 'function') window.renderTextbooks();
  // 新しい端末では、クラウドに上がっている教材を自動で降ろす（Firestoreの接続を待つ）
  if (typeof window.tbAutoPull === 'function') setTimeout(window.tbAutoPull, 6000);
  if (typeof renderMilestones === 'function') renderMilestones();
  if (typeof renderComparison === 'function') renderComparison();
  window.renderTrash();
  window.renderBackups();
  window.renderErrorLog();

  // 表記ゆれ（全角半角の違いなど）だけの科目名は、同期が落ち着いてから自動で寄せる。
  // 意味が同じものだけが対象で、「英語」→「英文読解S」のような判断が要るものは触らない。
  //
  // 「一度やったら二度とやらない」フラグは使わない。
  // 寄せるものが無ければ何も起きない（冪等）ので毎回動かして問題なく、
  // むしろフラグだけ立って統合が終わっていない状態を作るほうが危険。
  // 時間割を変えた後に出てくる新しい表記ゆれにも、これで対応できる。
  setTimeout(() => {
    // 旧版のセルフチェックがクラウドに残した空の学習ログ（2000-01-01）を片付ける
    try {
      const junk = S.dailyLogs['2000-01-01'];
      if (junk && !(junk.total > 0)) { delete S.dailyLogs['2000-01-01']; DbService.setDailyLog('2000-01-01'); }
    } catch (e) {}
    // ゴミ箱からも消えたノートの元画像を片付ける
    if (typeof cleanupOrphanNoteBlobs === 'function') setTimeout(cleanupOrphanNoteBlobs, 30000);

    // 科目別合計・総学習時間は日別ログから作り直す（ズレの自動修復）
    try {
      const r = rebuildStudyTotals();
      if (r.changed) { console.log('📊 学習時間の集計を日別ログから作り直しました:', r); initAllCharts(); renderHome(); }
    } catch (e) { console.warn('集計の再構築に失敗', e); }

    try {
      const fixed = autoFixSubjectVariants();
      if (fixed.length) {
        console.log('🧹 科目名の表記ゆれを統合:', fixed.join(', '));
        showToast('🧹 科目名の表記ゆれを統合しました（' + fixed.join('、') + '）', 'success', 6000);
        initAllCharts(); renderHome();
      }
    } catch (e) { console.warn('科目名の自動統合に失敗', e); }
    window.renderSubjectMerge?.();
  }, 6000);

  // 音声入力に対応していればマイクボタンを出す
  if (window.SpeechRecognition || window.webkitSpeechRecognition) {
    const mic = document.getElementById('chat-mic-btn');
    if (mic) mic.style.display = '';
  }
});
