// ============================================================
// 科目セレクト：時間割から動的生成
// ============================================================
const DEFAULT_SUBJECTS = ['英語','国語（現代文）','国語（古文）','国語（漢文）','数学1A','数学2B','数学C','世界史','政治経済','化学基礎','生物基礎','情報'];

const getTimetableSubjects = () => {
  const subjs = new Set();
  Object.values(S.timetable).forEach(dayData => {
    Object.values(dayData).forEach(cell => {
      const s = typeof cell === 'string' ? cell : (cell?.subj || '');
      if (s && s.trim()) subjs.add(s.trim());
    });
  });
  return subjs.size > 0 ? [...subjs].sort() : [...DEFAULT_SUBJECTS];
};

const refreshSubjectSelects = () => {
  const subjs = getTimetableSubjects();
  // セレクトID → 先頭に空オプションを付けるか
  const targets = [
    { id: 'timer-subj',    blank: '科目を選択' },
    { id: 'add-subj',      blank: null },
    { id: 'qs-subj',       blank: null },
    { id: 'hw-subj',       blank: null },
    { id: 'log-edit-subj', blank: null },
    { id: 'task-subj',     blank: 'なし' },
  ];
  targets.forEach(({ id, blank }) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value; // 現在の選択値を保持
    sel.innerHTML = (blank ? '<option value="">' + blank + '</option>' : '')
      + subjs.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    // 以前選んでいた値が残っているなら復元
    if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  });
};
window.refreshSubjectSelects = refreshSubjectSelects;


window.addTT = () => { 
  const d = document.getElementById('tt-day').value; const p = document.getElementById('tt-period').value;
  const s = document.getElementById('tt-subj').value.trim(); const r = document.getElementById('tt-room').value.trim(); const t = document.getElementById('tt-teacher').value.trim();
  if(!s && !r && !t) { window.deleteTT(); return; }
  if(!S.timetable[d]) S.timetable[d]={}; 
  S.timetable[d][p] = { subj: s, room: r, teacher: t }; 
  DbService.setMainProfile(); window.closeMo('mo-tt'); renderTT(); renderWeek(); populateSubjectSelects(); refreshSubjectSelects();
};

window.deleteTT = () => {
  const d = document.getElementById('tt-day').value; const p = document.getElementById('tt-period').value;
  // setMainProfile は merge 保存なので、消したコマがサーバーに残って数秒後に復活してしまう。
  // 時間割ごと差し替えて、削除を確実に伝える。
  if(S.timetable[d] && S.timetable[d][p]) { delete S.timetable[d][p]; DbService.replaceField('timetable', S.timetable); }
  window.closeMo('mo-tt'); renderTT(); renderWeek(); populateSubjectSelects(); refreshSubjectSelects();
};

window.tglHw = (id, checked) => {
  const h = S.homework.find(x=>x.id===id);
  if(h){
    h.done = checked;
    if (checked) h.doneAt = DateManager.getTodayStr(); else delete h.doneAt;
    DbService.set('homework', h);
    renderHwList();
  }
};
window.rmHw = (id) => { DbService.del('homework', id); S.homework = S.homework.filter(x=>x.id!==id); renderHwList(); };

let _hwFilter = '';
let _hwShowArchive = false;
window.setHwFilter = (filter, btn) => {
  _hwFilter = filter;
  document.querySelectorAll('#hw-filter-bar .tag').forEach(b => { b.style.background = ''; b.style.color = ''; b.style.borderColor = ''; });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--accent)'; }
  renderHwList();
};

const renderHwList = () => {
  const el = document.getElementById('hw-list'); if (!el) return;
  const prioOrder = {high:0, mid:1, low:2};
  const prioLabel = {high:'🔴', mid:'🟡', low:'🟢'};
  const prioColor = {high:'#dc4f1e', mid:'#c07010', low:'#16a05a'};
  const todayStr = DateManager.getTodayStr();

  let active = S.homework.filter(h => !h.done);
  let archived = S.homework.filter(h => h.done);

  if (_hwFilter === '未完了') { /* already filtered */ }
  else if (_hwFilter === '🔴') active = active.filter(h => (h.priority||'mid') === 'high');
  else if (_hwFilter === '🟡') active = active.filter(h => (h.priority||'mid') === 'mid');
  else if (_hwFilter === '🟢') active = active.filter(h => (h.priority||'mid') === 'low');

  active.sort((a,b) => {
    const pa = prioOrder[a.priority||'mid'], pb = prioOrder[b.priority||'mid'];
    if (pa !== pb) return pa - pb;
    return (a.due||'').localeCompare(b.due||'');
  });

  const makeCard = (h) => {
    const isOverdue = !h.done && h.due && h.due < todayStr;
    const daysLeft = h.due ? DateManager.daysBetween(h.due) : null;
    const dueLabel = h.due
      ? isOverdue ? `⚠️ 期限切れ (${h.due})` : daysLeft === 0 ? `📅 今日まで` : `📅 ${h.due} (あと${daysLeft}日)`
      : '';
    return `<div class="hw-card${h.done?' done-card':''}">
      <div class="hw-card-top">
        <input type="checkbox" ${h.done?'checked':''} onchange="tglHw('${h.id}',this.checked)">
        <div class="hw-card-body">
          <div class="hw-card-title${h.done?' strikethrough':''}">${esc(h.subj)}：${esc(h.cont)}</div>
          <div class="hw-card-meta">
            <span class="badge" style="background:${prioColor[h.priority||'mid']}22;color:${prioColor[h.priority||'mid']};font-size:11px">${prioLabel[h.priority||'mid']} ${h.priority==='high'?'高':h.priority==='low'?'低':'中'}</span>
            ${h.due ? `<span class="hw-card-due${isOverdue?' overdue':''}">${dueLabel}</span>` : ''}
          </div>
        </div>
        <button class="icon-btn" onclick="rmHw('${h.id}')">×</button>
      </div>
    </div>`;
  };

  let html = '';
  if (active.length === 0 && _hwFilter) {
    html = '<div class="empty">該当する宿題がありません</div>';
  } else if (active.length === 0) {
    html = '<div class="empty">宿題がありません 🎉</div>';
  } else {
    html = active.map(makeCard).join('');
  }

  if (archived.length > 0 && _hwFilter !== '未完了' && !_hwFilter.startsWith('🔴') && !_hwFilter.startsWith('🟡') && !_hwFilter.startsWith('🟢')) {
    html += `<div class="divider"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:12px;color:var(--muted);font-weight:700">✅ 完了済み (${archived.length}件)</span>
      <button class="btn btn-s btn-sm" style="font-size:11px" onclick="_hwShowArchive=!_hwShowArchive;renderHwList()">${_hwShowArchive?'▲ 閉じる':'▼ 表示'}</button>
    </div>`;
    if (_hwShowArchive) html += archived.map(makeCard).join('');
  }

  el.innerHTML = html;
};
window.addHw = () => { const obj={id:generateId(), subj:document.getElementById('hw-subj').value, cont:document.getElementById('hw-cont').value, due:document.getElementById('hw-due').value, done:false, priority:document.getElementById('hw-prio')?.value||'mid'}; S.homework.push(obj); DbService.set('homework', obj); window.closeMo('mo-hw'); renderHwList(); showToast('📝 宿題を追加しました'); };

// ⑧ 繰り返し予定
window.addRepeatEvent = () => {
  const title = document.getElementById('rp-title').value.trim();
  const dow = document.getElementById('rp-dow').value;
  const time = document.getElementById('rp-time').value;
  if (!title) { showToast('タイトルを入力してください', 'warn'); return; }
  const obj = { id: generateId(), title, dow, time };
  if (!S.repeatEvents) S.repeatEvents = [];
  S.repeatEvents.push(obj);
  DbService.setMainProfile();
  window.closeMo('mo-repeat');
  renderRepeatList();
  renderCal();
  showToast(`🔁 毎週${dow}曜「${title}」を追加しました`);
};
window.rmRepeatEvent = (id) => {
  S.repeatEvents = (S.repeatEvents || []).filter(x => x.id !== id);
  DbService.setMainProfile();
  renderRepeatList();
  renderCal();
};
const renderRepeatList = () => {
  const el = document.getElementById('repeat-ev-list');
  if (!el) return;
  const list = S.repeatEvents || [];
  el.innerHTML = list.length === 0
    ? '<div class="empty">繰り返し予定はありません</div>'
    : list.map(re => `<div class="row"><div><div class="row-title"><span class="badge by" style="margin-right:6px">毎週${esc(re.dow)}曜</span>${esc(re.title)}</div>${re.time ? `<div class="row-sub">${esc(re.time)}</div>` : ''}</div><button class="icon-btn" onclick="rmRepeatEvent('${re.id}')">×</button></div>`).join('');
};

window.rmMs = (id) => { DbService.del('mockSchedule', id); S.mockSchedule = S.mockSchedule.filter(x=>x.id!==id); renderMockCalList(); renderCal(); };
const renderMockCalList = () => { const el=document.getElementById('mock-cal-list'); if(el) el.innerHTML=S.mockSchedule.map(m=>`<div class="row"><div>${esc(m.name)} <span class="muted">${esc(m.date)}</span></div><button class="icon-btn" onclick="rmMs('${m.id}')">×</button></div>`).join(''); };
window.addMockSched = () => { const obj={id:generateId(), name:document.getElementById('ms-name').value, date:document.getElementById('ms-date').value}; S.mockSchedule.push(obj); DbService.set('mockSchedule', obj); window.closeMo('mo-mock-sched'); renderMockCalList(); renderCal(); };
const renderMockRecTbl = () => { renderMockTbl(); };

window.rmSp = (id) => { DbService.del('specials', id); S.specials = S.specials.filter(x=>x.id!==id); renderSpList(); renderCal(); };
const renderSpList = () => { const el=document.getElementById('sp-list'); if(el) el.innerHTML=S.specials.map(s=>`<div class="row"><div>${esc(s.name)}</div><button class="icon-btn" onclick="rmSp('${s.id}')">×</button></div>`).join(''); };
window.addSp = () => { const obj={id:generateId(), name:document.getElementById('sp-name').value, start:document.getElementById('sp-s').value, end:document.getElementById('sp-e').value, status:document.getElementById('sp-st').value}; S.specials.push(obj); DbService.set('specials', obj); window.closeMo('mo-sp'); renderSpList(); renderCal(); };

window.rmEx = (id) => { DbService.del('extras', id); S.extras = S.extras.filter(x=>x.id!==id); renderExtraList(); };
const renderExtraList = () => { const el=document.getElementById('extra-list'); if(el) el.innerHTML=S.extras.map(e=>`<div class="row"><div>${esc(e.title)}</div><button class="icon-btn" onclick="rmEx('${e.id}')">×</button></div>`).join(''); };
window.addExtra = () => { const obj={id:generateId(), title:document.getElementById('extra-title').value, date:document.getElementById('extra-date').value, note:document.getElementById('extra-note').value}; S.extras.push(obj); DbService.set('extras', obj); window.closeMo('mo-extra'); renderExtraList(); };

const renderSettings = () => {
  const nameEl = document.getElementById('set-name');
  const gradeEl = document.getElementById('set-grade');
  const nijiEl = document.getElementById('set-niji');
  if (nameEl) nameEl.value = S.userName || '';
  if (gradeEl) gradeEl.value = S.userGrade || '高校3年';
  if (nijiEl) nijiEl.value = S.nijiDate || '2027-02-25';
  // 別の端末で変えた見た目のスタイルもこの端末に反映する
  if (typeof applyUiStyle === 'function') applyUiStyle(S.userStyle);
  // 別の端末で変更したAIモデルの設定をこの端末にも反映する（手動モードのときだけ。
  // おまかせ中は選択欄を「おまかせ」のままにし、保存済みモデルも書き換えない）
  const modelEl = document.getElementById('set-model');
  if (modelEl) {
    if (typeof AiModelMode !== 'undefined' && AiModelMode.get() === 'auto') {
      modelEl.value = 'auto';
    } else if (S.aiModel && AVAILABLE_MODELS.includes(S.aiModel) && localStorage.getItem('geminiModel') !== S.aiModel) {
      localStorage.setItem('geminiModel', S.aiModel);
      modelEl.value = S.aiModel;
    }
  }
  if (typeof window.renderModelModeNote === 'function') window.renderModelModeNote();
};

// 設定画面のモデル欄の下に出す「今の振り分け状態」の説明
window.renderModelModeNote = () => {
  const el = document.getElementById('model-mode-note');
  if (!el || typeof AiModelMode === 'undefined') return;
  el.textContent = '🤖 ' + AiModelMode.describe();
};
window.saveSettings = () => {
  const ak = document.getElementById('set-api-key')?.value.trim() || '';
  if(ak) localStorage.setItem('geminiApiKey', ak); else localStorage.removeItem('geminiApiKey');
  const modelEl = document.getElementById('set-model');
  if (modelEl && modelEl.value === 'auto') {
    // おまかせ: モードだけ記録し、保存済みの手動モデルは消さない（手動に戻したとき復活する）
    if (typeof AiModelMode !== 'undefined') AiModelMode.set('auto');
  } else if (modelEl && AVAILABLE_MODELS.includes(modelEl.value)) {
    if (typeof AiModelMode !== 'undefined') AiModelMode.set('manual');
    localStorage.setItem('geminiModel', modelEl.value); S.aiModel = modelEl.value;
  }
  if (typeof window.renderModelModeNote === 'function') window.renderModelModeNote();
  const nameEl = document.getElementById('set-name');
  if(nameEl) S.userName = nameEl.value;
  const gradeEl = document.getElementById('set-grade');
  if(gradeEl) S.userGrade = gradeEl.value;
  const nijiEl = document.getElementById('set-niji');
  if(nijiEl) S.nijiDate = nijiEl.value;
  DbService.setMainProfile();
  showToast('設定を保存しました！');
  renderHome();
};
const renderScoreTargetSettings = () => { const el=document.getElementById('mo-score-content'); if(el) el.innerHTML=Object.keys(S.scoreTargets).map(k=>`<div class="g2" style="margin-bottom:10px"><div><label class="lbl">${esc(k)} 現在</label><input type="number" id="stc-${k}" value="${S.scoreTargets[k].current}"></div><div><label class="lbl">目標</label><input type="number" id="stt-${k}" value="${S.scoreTargets[k].target}"></div></div>`).join(''); };
window.saveScoreTargets = () => { Object.keys(S.scoreTargets).forEach(k=>{ S.scoreTargets[k].current=+(document.getElementById('stc-'+k)?.value ?? 0); S.scoreTargets[k].target=+(document.getElementById('stt-'+k)?.value ?? 80); }); DbService.setMainProfile(); renderHome(); window.closeMo('mo-score-target'); };
document.addEventListener('DOMContentLoaded', () => {
  // 旧モデルIDの自動マイグレーション（提供終了・プレビュー卒業したモデル名を最新へ寄せる）
  const modelMigration = {
    'gemini-2.0-flash': DEFAULT_MODEL,
    'gemini-2.0-flash-lite': DEFAULT_MODEL,
    'gemini-3-flash': DEFAULT_MODEL,
    'gemini-3-flash-preview': DEFAULT_MODEL,
    'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite-preview': 'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite-preview-09-2025': 'gemini-3.5-flash-lite',
    'gemini-2.5-pro': 'gemini-3.1-pro-preview',
    // Google側で別モデルへの転送になったID（2026-10 確認）
    'gemini-3.7-flash': 'gemini-3.8-flash',
    'gemini-3.5-flash': 'gemini-3.6-flash'
  };
  const savedModel = localStorage.getItem('geminiModel');
  if (savedModel && modelMigration[savedModel]) {
    localStorage.setItem('geminiModel', modelMigration[savedModel]);
    console.log(`🔄 モデルIDを自動更新: ${savedModel} → ${modelMigration[savedModel]}`);
  } else if (savedModel && !AVAILABLE_MODELS.includes(savedModel)) {
    // 一覧にない未知のモデルIDが残っていると、選択欄が空欄のまま使えないモデルを呼び続けてしまう
    localStorage.setItem('geminiModel', DEFAULT_MODEL);
    console.log(`🔄 不明なモデルIDのため既定値に戻しました: ${savedModel} → ${DEFAULT_MODEL}`);
  }
  populateSubjectSelects(); // 時間割から科目リストを初期生成
  refreshSubjectSelects();
  if (localStorage.getItem('geminiApiKey')) { const el = document.getElementById('set-api-key'); if(el) el.value = localStorage.getItem('geminiApiKey'); }
  {
    const el = document.getElementById('set-model');
    if (el) {
      // おまかせ中は選択欄も「おまかせ」にする（保存済みモデルは手動用に保持）
      if (typeof AiModelMode !== 'undefined' && AiModelMode.get() === 'auto') el.value = 'auto';
      else el.value = localStorage.getItem('geminiModel') || DEFAULT_MODEL;
      if (!el.value) el.value = DEFAULT_MODEL; // 選択肢に無い値だと空欄になるため保険
      el.addEventListener('change', () => { if (typeof window.renderModelModeNote === 'function') window.renderModelModeNote(); });
    }
    if (typeof window.renderModelModeNote === 'function') window.renderModelModeNote();
  }
  const t = DateManager.getTodayStr(); ['m-date','ev-date','ms-date','hw-due','extra-date','sp-s','sp-e','add-date','pie-daily-date'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=t;});
  renderSettings(); renderHome(); renderCal(); renderWeek(); renderHeatmaps(); renderScoreTargetSettings(); window.renderScoring(false); window.renderTrend(false); renderChat(); renderNotes(); renderRepeatList();
  
  // バス時刻の初期表示と1分ごと更新
  if(window.updateBusTimes) {
    window.updateBusTimes();
    setInterval(window.updateBusTimes, 60000);
  }

  // 🧹↓↓ ここから追加：古いタスクデータの自動クリーンナップ ↓↓🧹
  setTimeout(() => {
    let updated = false;
    S.tasks.forEach(task => {
      let taskChanged = false;
      if (task.carryover !== undefined) {
        delete task.carryover;
        taskChanged = true;
      }
      if (!task.createdDate) {
        task.createdDate = DateManager.getTodayStr();
        taskChanged = true;
      }
      if (taskChanged) {
        DbService.set('tasks', task);
        updated = true;
      }
    });
    if (updated) {
      DbService.setMainProfile();
      renderTasks();
      console.log("✨ 古いタスクデータのクリーンナップが完了しました！");
    }
  }, 3000);
  // 🧹↑↑ ここまで追加 ↑↑🧹
});
// 神姫バス 平日の主要な発車時刻（フラワータウンセンター ⇔ 三宮）
// 既定値。16-live.js が bus-timetable.json を取得できたら丸ごと差し替える
window.BUS_TIMETABLE = {
duration: 53,
durationReturn: 46,
toSan: [
  "05:58", "06:15", "06:25", "06:35", "06:45", "07:01", "07:15", "07:25", "07:35", "07:45",
  "08:00", "08:20", "08:40", "09:00", "09:20", "09:40", "10:00", "10:20", "10:40", "11:00",
  "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:40", "16:20",
  "16:50", "17:20", "17:50", "18:30", "19:30", "19:50", "20:35", "21:30", "21:55", "22:25"
],
toFlo: [
  "07:10", "07:45", "07:50", "07:55", "08:00", "08:20", "08:40", "09:00", "09:30", "09:50",
  "10:00", "10:30", "11:00", "11:45", "12:20", "12:30", "13:00", "13:30", "14:00", "14:30",
  "15:00", "15:20", "15:40", "16:00", "16:15", "16:30", "16:45", "17:00", "17:15", "17:30",
  "17:45", "18:00", "18:15", "18:30", "18:45", "19:00", "19:15", "19:30", "19:45", "20:00",
  "20:15", "20:30", "20:45", "21:00", "21:20", "21:40", "22:00", "22:20", "22:40", "23:00",
  "23:30"
],
toSanWeekend: [
  "06:05", "06:25", "06:45", "07:05", "07:25", "07:45", "08:00", "08:20", "08:40", "09:00",
  "09:20", "09:40", "10:00", "10:20", "10:40", "11:00", "11:30", "12:00", "12:30", "13:00",
  "13:30", "14:00", "14:30", "15:00", "15:40", "16:20", "16:50", "17:20", "18:00", "18:50",
  "19:30", "20:30", "21:30"
],
toFloWeekend: [
  "07:30", "08:20", "09:00", "09:30", "10:00", "10:30", "11:00", "12:00", "13:00", "13:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:20", "16:40", "17:00", "17:20", "17:40",
  "18:00", "18:20", "18:40", "19:00", "19:20", "19:40", "20:00", "20:20", "20:40", "21:00",
  "21:20", "21:40", "22:00", "22:30", "23:00"
]
};


// 土日祝ダイヤかどうか（祝日は 2026・2027 年の国民の祝日＋振替休日）
window.BUS_HOLIDAYS = ['2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06','2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23','2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-20','2027-04-29','2027-05-03','2027-05-04','2027-05-05','2027-07-19','2027-08-11','2027-09-20','2027-09-23','2027-10-11','2027-11-03','2027-11-23'];
window.busDayType = (d = new Date()) => {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 'weekend';
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return window.BUS_HOLIDAYS.includes(key) ? 'weekend' : 'weekday';
};

// 次のバス（出発時刻ベース）。秒まで見るので、出発した直後のバスが「次のバス」に残らない。
window.nextBusDeps = (schedule, now = new Date()) => {
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return (schedule || []).filter(timeStr => {
    const [h, m] = String(timeStr).split(':').map(Number);
    return (h * 3600 + m * 60) >= nowSec;
  });
};

window.updateBusTimes = () => {
  const now = new Date();

  // 出発時刻＋所要時間 → 到着時刻（日付をまたぐかも返す）
  const arrOf = (dep, duration) => {
    const [h, m] = dep.split(':').map(Number);
    const total = h * 60 + m + duration;
    const arrH = Math.floor(total / 60) % 24;
    const arrM = total % 60;
    return { total, arrStr: `${String(arrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}` };
  };
  const arrStrOf = (dep, duration) => arrOf(dep, duration).arrStr;

  // schedule: 今日の時刻表, tomorrowSchedule: 明日の時刻表, duration: 到着までの正確な所要時間(分)
  const getNext3 = (schedule, tomorrowSchedule, duration) => {
    const upcoming = window.nextBusDeps(schedule, now);

    // 今日の便が終わったら、明日の始発を案内する（明日が土日祝ならそのダイヤで）
    if (upcoming.length === 0 && tomorrowSchedule?.length) return `<span style='font-size:13px;font-weight:normal;color:var(--muted)'>本日の運行は終了しました</span><br><span style="font-size:13px">明日 <span style="font-weight:900">${tomorrowSchedule[0]}</span><span style="font-size:10px;font-weight:normal;color:var(--muted)">→${arrStrOf(tomorrowSchedule[0], duration)}着</span></span>`;
    if (upcoming.length === 0) return "<span style='font-size:13px;font-weight:normal;color:var(--muted)'>本日の運行は終了しました</span>";

    return upcoming.slice(0, 3).map(dep => {
      const { total, arrStr } = arrOf(dep, duration);
      // 到着が0時を過ぎる便は（翌日）と明示する
      return `<span style="font-weight:900">${dep}</span><span style="font-size:10px;font-weight:normal;color:var(--muted)">→${arrStr}着${total >= 1440 ? '（翌日）' : ''}</span>`;
    }).join(' <span style="color:var(--border);font-weight:normal;margin:0 4px">|</span> ');
  };

  const elSan = document.getElementById('bus-to-san');
  const elFlo = document.getElementById('bus-to-flo');
  // 神姫バス（特急）の所要時間は BUS_TIMETABLE.duration（フラワータウン⇔三宮 は平均で約53分）
  const tt = window.BUS_TIMETABLE;
  const weekend = window.busDayType(now) === 'weekend';
  const san = (weekend && tt.toSanWeekend?.length) ? tt.toSanWeekend : tt.toSan;
  const flo = (weekend && tt.toFloWeekend?.length) ? tt.toFloWeekend : tt.toFlo;
  // 明日のダイヤ（終バス後の「明日の始発」表示用）
  const tomorrow = new Date(now.getTime() + 86400000);
  const weekendTomorrow = window.busDayType(tomorrow) === 'weekend';
  const sanTomorrow = (weekendTomorrow && tt.toSanWeekend?.length) ? tt.toSanWeekend : tt.toSan;
  const floTomorrow = (weekendTomorrow && tt.toFloWeekend?.length) ? tt.toFloWeekend : tt.toFlo;
  if(elSan) elSan.innerHTML = getNext3(san, sanTomorrow, tt.duration);
  if(elFlo) elFlo.innerHTML = getNext3(flo, floTomorrow, tt.durationReturn || tt.duration);
};

// 🍎 Appleカレンダー（ICS形式）出力機能
window.exportToICS = () => {
  const hasEvents = S.events?.length > 0;
  const hasMocks = S.mockSchedule?.length > 0;
  const hasSpecials = S.specials?.length > 0;
  const hasRepeats = S.repeatEvents?.length > 0;

  if (!hasEvents && !hasMocks && !hasSpecials && !hasRepeats) {
    showToast('出力する予定がありません！', 'warn');
    return;
  }

  // RFC 5545準拠：改行はCRLF(\r\n)を使用
  const CRLF = "\r\n";

  // ICS形式のイベントブロックを生成するヘルパー
  const makeEvent = (title, dateStr, time, note) => {
    const ds = dateStr.replace(/-/g, '');
    let block = "BEGIN:VEVENT" + CRLF;
    block += `SUMMARY:${title}` + CRLF;
    if (note) block += `DESCRIPTION:${note}` + CRLF;
    if (time) {
      const timeStr = time.replace(/:/g, '') + '00';
      block += `DTSTART;TZID=Asia/Tokyo:${ds}T${timeStr}` + CRLF;
      let endHNum = parseInt(time.split(':')[0]) + 1;
      let endMinStr = time.split(':')[1] || '00';
      if (endHNum >= 24) { endHNum = 23; endMinStr = '59'; }
      block += `DTEND;TZID=Asia/Tokyo:${ds}T${String(endHNum).padStart(2,'0')}${endMinStr}00` + CRLF;
    } else {
      const nextDay = DateManager.parseSafe(dateStr);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDs = DateManager.getTodayStr(nextDay).replace(/-/g, '');
      block += `DTSTART;VALUE=DATE:${ds}` + CRLF;
      block += `DTEND;VALUE=DATE:${nextDs}` + CRLF;
    }
    block += "END:VEVENT" + CRLF;
    return block;
  };

  // カレンダーファイルのヘッダー
  let ics = "BEGIN:VCALENDAR" + CRLF + "VERSION:2.0" + CRLF + "PRODID:-//Juken App//JA" + CRLF + "CALSCALE:GREGORIAN" + CRLF;

  // ① 通常の予定
  (S.events || []).forEach(e => {
    ics += makeEvent(e.title, e.date, e.time || null, '');
  });

  // ② 模試スケジュール
  (S.mockSchedule || []).forEach(m => {
    ics += makeEvent(`📝 模試：${m.name}`, m.date, null, '');
  });

  // ③ 特別講習（開始日〜終了日を1日ずつ展開）
  (S.specials || []).forEach(sp => {
    if (sp.start && sp.end) {
      let cur = DateManager.parseSafe(sp.start);
      const end = DateManager.parseSafe(sp.end);
      while (cur <= end) {
        ics += makeEvent(`🌟 講習：${sp.name}`, DateManager.getTodayStr(cur), null, sp.status || '');
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      const d = sp.start || sp.end;
      if (d) ics += makeEvent(`🌟 講習：${sp.name}`, d, null, sp.status || '');
    }
  });

  // ④ 繰り返し予定（今日から365日分を展開）
  (S.repeatEvents || []).forEach(re => {
    const dowMap = {日:0,月:1,火:2,水:3,木:4,金:5,土:6};
    const targetDow = dowMap[re.dow];
    if (targetDow === undefined) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const limit = new Date(today); limit.setDate(limit.getDate() + 365);
    let cur = new Date(today);
    // 今週の該当曜日まで進める
    while (cur.getDay() !== targetDow) cur.setDate(cur.getDate() + 1);
    while (cur <= limit) {
      ics += makeEvent(`🔁 ${re.title}（毎週${re.dow}曜）`, DateManager.getTodayStr(cur), re.time || null, '');
      cur.setDate(cur.getDate() + 7);
    }
  });

  ics += "END:VCALENDAR";

  const totalCount = (S.events?.length||0) + (S.mockSchedule?.length||0) + (S.specials?.length||0) + (S.repeatEvents?.length||0);

  // ファイルとしてダウンロードさせる処理
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });

  // スマホ(iPhone)の場合は直接開く、PCの場合はダウンロード
  if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
    window.location.href = "data:text/calendar;charset=utf8," + encodeURIComponent(ics);
  } else {
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = "juken_schedule.ics";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(link.href);
  }
  showToast(`📅 ${totalCount}件の予定をカレンダーに出力しました！`, 'success');
};
// --- 🌓 Apple風 テーマ制御システム ---
window.setTheme = (mode) => {
  S.userTheme = mode; 
  if(typeof DbService !== 'undefined') DbService.setMainProfile();
  applyTheme(mode);
  ['light', 'dark', 'system'].forEach(m => {
    const btn = document.getElementById('th-' + m);
    if (btn) {
      if (m === mode) { btn.classList.add('btn-p'); btn.classList.remove('btn-s'); } 
      else { btn.classList.remove('btn-p'); btn.classList.add('btn-s'); }
    }
  });
  if(typeof showToast === 'function') showToast(`外観を「${mode === 'light' ? 'ライト' : mode === 'dark' ? 'ダーク' : '自動同期'}」に設定しました`);
};

// --- 🍬 見た目のスタイル（形や質感。ライト／ダークとは別に選べる）---
// くらしアプリの「画面のスタイル」と同じ考え方。html の data-style 属性で切り替え、CSS は index.html にある。
// 選んだスタイルは S.userStyle に入れて、ライト／ダークと同じく端末間で同期する。
const UI_STYLES = [
  { id: 'glass', name: '🪟 いつもの', desc: 'すりガラスのような、やわらかい見た目' },
  { id: 'pop',   name: '🍬 ぷっくりポップ', desc: 'くっきりした線と影。シールのよう' },
  { id: 'modern', name: '🌿 すっきりモダン', desc: '上品で落ち着いた、柔らかい影と整った余白' }
];
const applyUiStyle = (id) => {
  const st = UI_STYLES.find(s => s.id === id) || UI_STYLES[0];
  const html = document.documentElement;
  if (st.id === 'glass') html.removeAttribute('data-style'); else html.setAttribute('data-style', st.id);
  const box = document.getElementById('style-pick');
  if (box) box.innerHTML = UI_STYLES.map(s => `<button class="btn ${s.id === st.id ? 'btn-p' : 'btn-s'}" onclick="setUiStyle('${s.id}')" aria-pressed="${s.id === st.id}">
      <span class="sp-name">${s.name}${s.id === st.id ? ' ✓' : ''}</span><span class="sp-desc">${s.desc}</span></button>`).join('');
};
window.setUiStyle = (id) => {
  if (!UI_STYLES.some(s => s.id === id)) return;
  S.userStyle = id;
  if (typeof DbService !== 'undefined') DbService.setMainProfile();
  applyUiStyle(id);
  if (typeof showToast === 'function') showToast(`見た目を「${UI_STYLES.find(s => s.id === id).name.replace(/^\S+\s/, '')}」にしました`);
};
// 画面が一瞬いつもの見た目で出てから切り替わらないよう、読み込んだ時点ですぐ当てる（S は端末内の保存から読み込み済み）
applyUiStyle(S.userStyle);

const applyTheme = (mode) => {
  const html = document.documentElement;
  if (mode === 'dark') html.setAttribute('data-theme', 'dark');
  else if (mode === 'light') html.removeAttribute('data-theme');
  else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
  }
};

// --- 📱 iOS 26 流体ナビゲーション・統合制御システム ---
(function(){
  const indicator = document.getElementById('nav-indicator');
  const main = document.querySelector('.main');
  const tabOrder = ['home', 'timer', 'calendar', 'uni', 'apply', 'analytics', 'sunzemi', 'aicoach', 'money', 'settings'];

  // モーダルを閉じる
  window.closeAllMo = () => document.querySelectorAll('.mo').forEach(m => m.classList.remove('active'));

  // カプセルを動かす
  const syncIndicator = (id) => {
    const btn = document.querySelector(`.nav-btn[onclick*="'${id}'"]`);
    if(btn && indicator) {
      indicator.style.width = (btn.offsetWidth - 8) + 'px';
      indicator.style.transform = `translateX(${btn.offsetLeft + 4}px)`;
    }
  };

  // ページ切り替え（統合版 - 全ページ初期化を含む）
  window.showPage = (id, btn) => {
    // ページ表示切り替え（フェードアニメーション）
    document.querySelectorAll('.page').forEach(p => {
      p.style.opacity = '0';
      p.style.transform = 'scale(0.98) translateY(8px)';
      p.classList.remove('active');
    });
    const targetPage = document.getElementById('page-' + id);
    if (targetPage) {
      targetPage.classList.add('active');
      setTimeout(() => {
        targetPage.style.transition = 'opacity 0.3s ease, transform 0.3s cubic-bezier(0.1, 0.8, 0.2, 1)';
        targetPage.style.opacity = '1';
        targetPage.style.transform = 'scale(1) translateY(0)';
      }, 10);
    }

    // ナビボタン状態更新
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const targetBtn = btn || document.querySelector(`.nav-btn[onclick*="'${id}'"]`);
    if (targetBtn) {
      targetBtn.classList.add('active');
      // scrollIntoView はウィンドウごと横スクロールさせてしまうため、ナビ内だけをスクロールする
      const navEl = targetBtn.closest('.top-nav');
      if (navEl) navEl.scrollTo({ left: Math.max(0, targetBtn.offsetLeft - (navEl.clientWidth - targetBtn.offsetWidth) / 2), behavior: 'smooth' });
    }

    // ページごとの初期化（全ページ対応）
    if (id === 'home' && typeof renderHome === 'function') renderHome();
    if (id === 'timer' && typeof renderTimerLog === 'function') renderTimerLog();
    if (id === 'calendar') { weekOffset = 0; if(typeof renderCal === 'function') renderCal(); if(typeof renderWeek === 'function') renderWeek(); if(typeof renderRepeatList === 'function') renderRepeatList(); }
    if (id === 'uni') { if(typeof renderUniList === 'function') renderUniList(); if(typeof window.renderPrivSim === 'function') window.renderPrivSim(); if(typeof window.renderPastExams === 'function') window.renderPastExams(); if(typeof renderScoring === 'function') renderScoring(false); if(typeof renderTrend === 'function') renderTrend(false); }
    if (id === 'apply') { if(typeof window.renderApplications === 'function') window.renderApplications(); if(typeof window.renderExamPlan === 'function') window.renderExamPlan(); if(typeof window.renderKyotsu === 'function') window.renderKyotsu(); }
    if (id === 'analytics') { setTimeout(initAllCharts, 100); const wr = document.getElementById('weekly-rep'); if(wr && S.aiCoachLog.weeklyRepHtml) wr.innerHTML = S.aiCoachLog.weeklyRepHtml; if(typeof renderCoachHistory === 'function') renderCoachHistory(); if(typeof renderMilestones === 'function') renderMilestones(); if(typeof renderComparison === 'function') renderComparison(); }
    if (id === 'sunzemi') { if(typeof renderTT === 'function') renderTT(); if(typeof renderMockRecTbl === 'function') renderMockRecTbl(); if(typeof renderMockCalList === 'function') renderMockCalList(); if(typeof renderHwList === 'function') renderHwList(); if(typeof renderSpList === 'function') renderSpList(); if(typeof renderExtraList === 'function') renderExtraList(); if(typeof renderNotes === 'function') renderNotes(); }
    if (id === 'aicoach') { if(typeof window.evalDaily === 'function') window.evalDaily(false); if(typeof window.renderMorningPlan === 'function') window.renderMorningPlan(false); if(typeof renderChat === 'function') renderChat(); if(typeof window.renderTextbooks === 'function') window.renderTextbooks(); }
    if (id === 'money') { if(typeof renderMoney === 'function') renderMoney(); }
    if (id === 'settings') {
      if(typeof renderSettings === 'function') renderSettings();
      if(typeof PushUI !== 'undefined') PushUI.refreshSettings();
      if(typeof window.renderSubjectMerge === 'function') window.renderSubjectMerge();
      if(typeof window.renderTrash === 'function') window.renderTrash();
      if(typeof window.renderBackups === 'function') window.renderBackups();
      if(typeof window.renderErrorLog === 'function') window.renderErrorLog();
    }

    S.currentPage = id;
    window.closeAllMo();
    syncIndicator(id);
  };

  // 横スワイプでのページ遷移は廃止した（2026-10-27, v2027.10.27-4）。
  // ページ内の横スクロール要素（お金のサブタブや月のチップ列など）を触ると
  // ページ自体が切り替わってしまい使いにくいため。ページ遷移はタブのタップのみ。
  void tabOrder; // 並び順の定義は将来の参照用に残す（スワイプ遷移では使わない）

  // 起動時の初期化
  setTimeout(() => {
    applyTheme(S.userTheme || 'system');
    window.showPage(S.currentPage || 'home');
  }, 500);
})();
