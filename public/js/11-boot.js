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
      if (db) {
        try {
          const root = db.collection('appData').doc(DOC_ID);
          const jobs = [];
          for (const col of [...SYNC_COLS, 'dailyLogs', 'blobChunks']) {
            const snap = await root.collection(col).get();
            snap.docs.forEach(d => jobs.push(d.ref.delete()));
          }
          jobs.push(root.delete());
          if (navigator.onLine) await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(r, 20000))]);
        } catch (e) { console.warn('クラウドの削除に失敗', e); }
      }
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

window.renderBackups = async () => {
  const el = document.getElementById('backup-c');
  if (!el) return;
  const list = await Backup.list();
  const last = +(localStorage.getItem('jukenLastBackupAt') || 0);
  el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">
      週に1回、自動でこの端末に保存します（最新4件）${last ? '<br>最終バックアップ: ' + new Date(last).toLocaleString('ja-JP') : ''}
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
    + `<button class="btn btn-s btn-sm mt12" onclick="runBackupNow()">💾 いますぐバックアップを作る</button>`;
};
window.runBackupNow = async () => {
  await Backup.run(true);
  await window.renderBackups();
  showToast('💾 バックアップを作成しました');
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
      if (navigator.onLine) await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(r, 20000))]);
      try { rebuildStudyTotals({ persist: false }); } catch (e) {}
      refreshAllViews(); initAllCharts();
      showToast('⏪ 復元しました');
    });
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
