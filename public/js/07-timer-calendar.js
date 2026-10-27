// 🔔 タイマー終了音・振動（Web Audio API）
const playTimerEndSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beepTimes = [0, 0.3, 0.6];
    beepTimes.forEach(t => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'sine';
      gain.gain.setValueAtTime(0.4, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.3);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch(e) {}
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
};

// 集中モードのボタンUIを同期する関数
const syncImmersiveBtn = (running) => {
  const imBtn = document.getElementById('timer-toggle-btn-im');
  if (!imBtn) return;
  if (running) { imBtn.textContent = 'ストップして記録'; imBtn.className = 't-btn t-stop'; }
  else { imBtn.textContent = 'スタート'; imBtn.className = 't-btn t-start'; }
};

// ⏱ 計測中の状態を端末に保存する。
// アプリを閉じたりリロードしたりしても、開始時刻から経過を計算し直して続きから復帰できる。
// （setInterval はバックグラウンドで間引かれるが、時刻から計算しているので値はズレない）
const TIMER_KEY = 'jukenRunningTimer';
const saveTimerState = () => {
  try {
    if (!window.T.running) { localStorage.removeItem(TIMER_KEY); return; }
    localStorage.setItem(TIMER_KEY, JSON.stringify({
      subj: document.getElementById('timer-subj')?.value || '',
      mode: window.T.mode, startTime: window.T.startTime, startElapsed: window.T.startElapsed
    }));
  } catch (e) {}
};

// 保存された状態から経過秒を計算し直して画面に反映する
const syncTimerFromClock = () => {
  if (!window.T.running) return;
  const diff = Math.floor((Date.now() - window.T.startTime) / 1000);
  if (window.T.mode === 'stopwatch') window.T.elapsed = window.T.startElapsed + diff;
  else window.T.elapsed = window.T.startElapsed - diff;
  window.updateTimerDisp(Math.max(0, window.T.elapsed));
};

window.restoreRunningTimer = () => {
  let st; try { st = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch (e) { return; }
  if (!st || !st.startTime) return;
  const subjEl = document.getElementById('timer-subj');
  if (subjEl && st.subj) subjEl.value = st.subj;
  window.T.mode = st.mode || 'stopwatch';
  // モード切替ボタンの見た目も復元する（しないと、カウントダウン中なのにストップウォッチが選ばれて見える）
  document.querySelectorAll('.tm-btn').forEach(b => b.classList.toggle('on', (b.getAttribute('onclick') || '').includes(`'${window.T.mode}'`)));
  window.T.startTime = st.startTime;
  window.T.startElapsed = st.startElapsed || 0;
  const diff = Math.floor((Date.now() - st.startTime) / 1000);

  if (window.T.mode !== 'stopwatch') {
    // カウントダウン系：離れている間に時間切れになっていたら、その分を記録して終了する
    if (st.startElapsed - diff <= 0) {
      localStorage.removeItem(TIMER_KEY);
      const min = Math.round(st.startElapsed / 60);
      if (min > 0 && st.subj) { saveTimerLog(st.subj, min); showToast('⏰ アプリを離れている間にタイマーが終了したため記録しました', 'success', 5000); }
      window.timerReset();
      return;
    }
  }
  window.T.running = true;
  const btn = document.getElementById('timer-toggle-btn');
  if (btn) { btn.textContent = 'ストップして記録'; btn.className = 't-btn t-stop'; }
  syncImmersiveBtn(true);
  startTimerTick();
  syncTimerFromClock();
  showToast('⏱ 計測中のタイマーを復元しました', 'success', 3000);
};

// バックグラウンドから戻ったら時刻から計算し直す（間引かれた分を即座に埋める）
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTimerFromClock(); });

const startTimerTick = () => {
  clearInterval(window.T.interval);
  window.T.interval = setInterval(() => {
    const subj = document.getElementById('timer-subj')?.value || '';
    const diffStr = Math.floor((Date.now() - window.T.startTime) / 1000);
    if (window.T.mode === 'stopwatch') { window.T.elapsed = window.T.startElapsed + diffStr; }
    else {
      window.T.elapsed = window.T.startElapsed - diffStr;
      if (window.T.elapsed <= 0) {
        clearInterval(window.T.interval); window.T.running = false; window.T.elapsed = 0;
        localStorage.removeItem(TIMER_KEY);
        window.updateTimerDisp(window.T.elapsed);
        playTimerEndSound();
        showToast('⏰ 時間です！お疲れ様でした！自動で記録します。', 'success', 4000);
        const doneMin = Math.round(window.T.startElapsed / 60);
        if (doneMin > 0 && subj) saveTimerLog(subj, doneMin);
        window.timerReset(); return;
      }
    }
    window.updateTimerDisp(window.T.elapsed);
  }, 1000);
};

window.timerToggle = () => {
  const subj = document.getElementById('timer-subj').value;
  if (!window.T.running) {
    if (!subj) { showToast('⚠️ まずは「記録する科目」を選択してください！', 'warn'); return; }
    if (window.T.mode === 'pomodoro' && window.T.elapsed === 0) window.T.elapsed = (parseInt(document.getElementById('pomo-min').value) || 25) * 60;
    // 時間をセットせずに始めると、即「時間です」になって0分の記録が残ってしまう
    if (window.T.mode === 'countdown' && window.T.elapsed <= 0) { showToast('先に時間を入力して「セット」を押してください', 'warn'); return; }
    window.T.running = true;
    document.getElementById('timer-toggle-btn').textContent = 'ストップして記録';
    document.getElementById('timer-toggle-btn').className = 't-btn t-stop';
    syncImmersiveBtn(true);
    window.T.startTime = Date.now(); window.T.startElapsed = window.T.elapsed;
    saveTimerState();
    startTimerTick();
  } else {
    clearInterval(window.T.interval); window.T.running = false; let min = 0;
    if (window.T.mode === 'stopwatch') min = Math.round(window.T.elapsed / 60);
    else if (window.T.mode === 'pomodoro') min = Math.round((window.T.startElapsed - window.T.elapsed) / 60);
    else min = Math.round((window.T.startElapsed - window.T.elapsed) / 60);
    if (min > 0) saveTimerLog(subj, min); else showToast('⚠️ 学習時間が1分未満のため記録されませんでした。', 'warn');
    window.timerReset();
  }
};
const saveTimerLog = (subj, min) => {
  const dStr = DateManager.getTodayStr();
  const logObj = {id: generateId(), subj, min, time:new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}), date: dStr};
  S.timerLogs.unshift(logObj); DbService.set('timerLogs', logObj);
  recordStudy(subj, min, dStr); renderTimerLog(); initAllCharts(); renderHome(); 
  // showToast は textContent で表示するので esc() は不要（付けると「R&amp;L」のように二重に変換される）
  showToast(`🎉 ${subj}の学習を ${DateManager.formatHours(min)} 記録しました！`);
};
window.updateTimerDisp = (s) => {
  const txt = `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  document.getElementById('timer-disp').textContent = txt;
  const im = document.getElementById('timer-immersive-disp');
  if (im) im.textContent = txt;
};

window.timerReset = () => {
  clearInterval(window.T.interval); window.T.running = false; window.T.elapsed = 0;
  try { localStorage.removeItem(TIMER_KEY); } catch (e) {}
  const txt = '00:00:00';
  document.getElementById('timer-disp').textContent = txt;
  const im = document.getElementById('timer-immersive-disp');
  if (im) im.textContent = txt;
  document.getElementById('timer-toggle-btn').className = 't-btn t-start';
  document.getElementById('timer-toggle-btn').textContent = 'スタート';
  syncImmersiveBtn(false);
};

let _immersiveOn = false;
window.toggleImmersive = () => {
  _immersiveOn = !_immersiveOn;
  let el = document.getElementById('timer-immersive-overlay');
  if (_immersiveOn) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'timer-immersive-overlay';
      el.className = 'timer-immersive';
      el.innerHTML = `
        <button class="timer-immersive-btn" onclick="toggleImmersive()">✕ 戻る</button>
        <div id="timer-immersive-subj" class="timer-immersive-subj"></div>
        <div id="timer-immersive-disp" class="timer-disp" style="font-size:88px;color:#fff;letter-spacing:-4px">${document.getElementById('timer-disp').textContent}</div>
        <div class="timer-btns" style="margin-top:0">
          <button class="t-btn t-reset" onclick="timerReset()">リセット</button>
          <button class="t-btn t-start" id="timer-toggle-btn-im" onclick="timerToggle()">スタート</button>
        </div>`;
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
    const subj = document.getElementById('timer-subj')?.value || '';
    const subjEl = document.getElementById('timer-immersive-subj');
    if (subjEl) subjEl.textContent = subj;
    document.getElementById('btn-immersive').textContent = '🔲 集中モード中';
    if (window.T.running) {
      const imBtn = document.getElementById('timer-toggle-btn-im');
      if (imBtn) { imBtn.textContent = 'ストップして記録'; imBtn.className = 't-btn t-stop'; }
    }
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(()=>{});
  } else {
    if (el) el.style.display = 'none';
    document.getElementById('btn-immersive').textContent = '🔲 集中モード';
    if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  }
};

const renderTimerLog = () => { 
  const elLog = document.getElementById('timer-log'); const elSubj = document.getElementById('timer-today-subj'); const todayTotalEl = document.getElementById('timer-today-total');
  const todayStr = DateManager.getTodayStr();
  if (elLog) {
    const todayLogs = S.timerLogs.filter(l => l.date === todayStr);
    if (!todayLogs.length) { elLog.innerHTML = '<div class="empty">まだ記録がありません</div>'; }
    else { elLog.innerHTML = todayLogs.slice(0,15).map(l => `<div class="row"><div class="row-title">${esc(l.subj)}</div><span class="muted" style="font-size:11px;margin-right:auto;margin-left:10px">${esc(l.time||'')}</span><strong>${DateManager.formatHours(l.min)}</strong><button class="log-edit-btn" onclick="openLogEdit('${l.id}')" title="編集">✏️</button></div>`).join(''); }
  }
  const lg = S.dailyLogs[todayStr]; let total = 0;
  if (elSubj) {
    if (lg && lg.subjects && Object.keys(lg.subjects).length > 0) {
      let h = ''; for(let s in lg.subjects) { if(lg.subjects[s] > 0) { h += `<div class="row"><div class="row-title">${esc(s)}</div><strong>${DateManager.formatHours(lg.subjects[s])}</strong></div>`; total += lg.subjects[s]; } }
      elSubj.innerHTML = h || '<div class="empty">まだ記録がありません</div>';
    } else { elSubj.innerHTML = '<div class="empty">まだ記録がありません</div>'; }
  }
  if (todayTotalEl) todayTotalEl.textContent = `${DateManager.formatHours(total)}`; 
};

const renderCal = () => { 
  const m = S.calMonth, y = m.getFullYear(), mo = m.getMonth(); 
  document.getElementById('cal-title').textContent = y + '年' + (mo+1) + '月'; 
  document.getElementById('cal-head').innerHTML = ['日','月','火','水','木','金','土'].map(d => `<div class="cal-head">${d}</div>`).join(''); 
  const first = new Date(y,mo,1).getDay(), last = new Date(y,mo+1,0).getDate(), today = new Date(); 
  const evDates = S.events.map(e => e.date); const mockDates = S.mockSchedule.map(m => m.date); const spDates = new Set();
  // ⑧ 繰り返し予定の日付展開
  const repeatEvDates = [];
  (S.repeatEvents || []).forEach(re => {
    const startD = DateManager.parseSafe(`${y}-${String(mo+1).padStart(2,'0')}-01`);
    const endD = new Date(y, mo+1, 0);
    let cur = new Date(startD);
    while (cur <= endD) {
      const dow = cur.getDay(); // 0=日,1=月...
      const dowMap = {日:0,月:1,火:2,水:3,木:4,金:5,土:6};
      if (dowMap[re.dow] === dow) repeatEvDates.push(DateManager.getTodayStr(cur));
      cur.setDate(cur.getDate() + 1);
    }
  });
  S.specials.forEach(sp => {
    if (sp.start && sp.end) {
      let curr = DateManager.parseSafe(sp.start); const endD = DateManager.parseSafe(sp.end);
      if (!isNaN(curr) && !isNaN(endD)) { while (curr <= endD) { spDates.add(DateManager.getTodayStr(curr)); curr.setDate(curr.getDate() + 1); } }
    } else if (sp.start) { spDates.add(sp.start); } else if (sp.end) { spDates.add(sp.end); }
  });
  let html = ''; for (let i = first-1; i >= 0; i--) html += `<div class="cal-day other-m"></div>`;
  for (let d = 1; d <= last; d++) {
    const ds = `${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isTd = today.getFullYear()===y && today.getMonth()===mo && today.getDate()===d;
    const hasMock = mockDates.includes(ds);
    const hasSp = spDates.has(ds);
    // ⑧ 繰り返し予定もevDatesに含める
    const allEvDates = [...evDates, ...repeatEvDates];
    const hasEv = allEvDates.includes(ds);
    // ⑦ 色別ドット生成
    let dots = '';
    if (hasMock || hasSp || hasEv) {
      dots = '<div class="cal-dots">';
      if (hasMock) dots += '<div class="cal-dot-mock"></div>';
      if (hasSp)   dots += '<div class="cal-dot-sp"></div>';
      if (hasEv)   dots += '<div class="cal-dot-ev"></div>';
      dots += '</div>';
    }
    const studyMin = S.dailyLogs[ds]?.total || 0;
    let studyBadge = '';
    if (studyMin > 0) {
      const sh = Math.floor(studyMin/60), sm = studyMin%60;
      const studyStr = sh > 0 ? `${sh}h${sm>0?sm+'m':''}` : `${sm}m`;
      const studyColor = studyMin >= 240 ? '#16a05a' : studyMin >= 120 ? '#1d4ed8' : studyMin >= 30 ? '#c07010' : '#8E8E93';
      studyBadge = `<span class="cal-study-time" style="color:${isTd?'rgba(255,255,255,0.85)':studyColor}">${studyStr}</span>`;
    }
    html += `<div class="cal-day${isTd?' today':''}" onclick="window.showDayDetail('${ds}')"><span>${d}</span>${studyBadge}${dots}${(() => {
      const titles = [];
      S.events.filter(e=>e.date===ds).slice(0,1).forEach(e=>titles.push(esc(e.title)));
      S.mockSchedule.filter(m=>m.date===ds).slice(0,1).forEach(m=>titles.push(esc(m.name)));
      return titles.map(t=>`<span class="cal-ev-title">${t}</span>`).join('');
    })()}</div>`;
  }  document.getElementById('cal-body').innerHTML = html; renderEvList(); 
};
window.chMonth = (d) => { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth()+d, 1); renderCal(); };
window.chCalToday = () => { S.calMonth = new Date(); renderCal(); }; // 今月へ一発で戻る

// 📱 カレンダースワイプ対応
(function() {
  let _swipeStartX = null, _swipeStartY = 0;
  document.addEventListener('touchstart', e => {
    const cal = document.getElementById('cal-body');
    if (cal && cal.contains(e.target)) { _swipeStartX = e.touches[0].clientX; _swipeStartY = e.touches[0].clientY; }
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (_swipeStartX === null) return;
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    const dy = e.changedTouches[0].clientY - _swipeStartY;
    _swipeStartX = null;
    if (Math.abs(dx) < 40) return; // 40px未満は無視
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // 縦スクロール中に少し横へ流れただけでは月を変えない
    window.chMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
})();
window.showDayDetail = (dateStr) => {
  document.getElementById('day-detail-title').textContent = `${dateStr.replace(/-/g, '/')} の予定`;
  
  const evs = S.events.filter(e => e.date === dateStr);
  const mocks = S.mockSchedule.filter(m => m.date === dateStr);
  const sps = S.specials.filter(s => {
    if(s.start && s.end) return dateStr >= s.start && dateStr <= s.end;
    if(s.start) return dateStr === s.start;
    if(s.end) return dateStr === s.end;
    return false;
  });

  const dowMap2 = {0:'日',1:'月',2:'火',3:'水',4:'木',5:'金',6:'土'};
  const dow2 = dowMap2[DateManager.parseSafe(dateStr).getDay()];
  const repeatEvs = (S.repeatEvents||[]).filter(re => re.dow === dow2);
  let html = evs.map(e => `<div class="row" style="padding:8px 0;"><div><div class="row-title" style="font-size:15px;">${esc(e.title)}</div><div class="row-sub">${e.time ? esc(e.time)+' ' : ''}${esc(e.type)==='exam'?'試験':esc(e.type)==='study'?'学習':esc(e.type)==='deadline'?'締切':'その他'}</div></div></div>`).join('');
  html += mocks.map(m => `<div class="row" style="padding:8px 0;"><div><div class="row-title" style="font-size:15px;"><span class="badge bb" style="margin-right:6px">模試</span>${esc(m.name)}</div></div></div>`).join('');
  html += sps.map(s => `<div class="row" style="padding:8px 0;"><div><div class="row-title" style="font-size:15px;"><span class="badge br" style="margin-right:6px">講習</span>${esc(s.name)}</div><div class="row-sub">${esc(s.start)} 〜 ${esc(s.end)}</div></div></div>`).join('');
  html += repeatEvs.map(re => `<div class="row" style="padding:8px 0;"><div><div class="row-title" style="font-size:15px;"><span class="badge by" style="margin-right:6px">繰返</span>${esc(re.title)}</div><div class="row-sub">毎週${esc(re.dow)}曜${re.time ? ' ' + esc(re.time) : ''}</div></div></div>`).join('');

  document.getElementById('day-detail-content').innerHTML = html || '<div class="empty" style="padding:16px;">この日の予定はありません</div>';
  window.showMo('mo-day-detail');
};
const renderEvList = () => { 
  const el = document.getElementById('ev-list'); if(!el) return; 
  const todayStr = DateManager.getTodayStr(); 
  
  // 未来と過去のフィルタリング
  const upEvents = S.events.filter(e => e.date >= todayStr).sort((a,b) => a.date.localeCompare(b.date));
  const upMocks = S.mockSchedule.filter(m => m.date >= todayStr).sort((a,b) => a.date.localeCompare(b.date));
  const upSpecials = S.specials.filter(s => (s.end || s.start) >= todayStr).sort((a,b) => (a.start||a.end).localeCompare(b.start||b.end));
  
  const pastEvents = S.events.filter(e => e.date < todayStr).sort((a,b) => b.date.localeCompare(a.date));
  const pastMocks = S.mockSchedule.filter(m => m.date < todayStr).sort((a,b) => b.date.localeCompare(a.date));

  let html = '<div style="font-weight:800; font-size:13px; color:var(--accent); margin-bottom:10px;">🚀 今後の予定</div>';
  
  let futureHtml = upEvents.map((e) => `<div class="row"><div><div class="row-title">${esc(e.title)}</div><div class="row-sub">${esc(e.date)}${e.time ? ' ' + esc(e.time) : ''}</div></div><button class="icon-btn" onclick="rmEv('${e.id}')">×</button></div>`).join('');
  futureHtml += upMocks.map((m) => `<div class="row"><div><div class="row-title"><span class="badge bb" style="margin-right:6px">模試</span>${esc(m.name)}</div><div class="row-sub">${esc(m.date)}</div></div></div>`).join('');
  futureHtml += upSpecials.map((s) => `<div class="row"><div><div class="row-title"><span class="badge br" style="margin-right:6px">講習</span>${esc(s.name)}</div><div class="row-sub">${esc(s.start)} 〜 ${esc(s.end)}</div></div></div>`).join('');
  futureHtml += (S.repeatEvents||[]).map((re) => `<div class="row"><div><div class="row-title"><span class="badge by" style="margin-right:6px">毎週${esc(re.dow)}曜</span>${esc(re.title)}</div><div class="row-sub">${re.time ? esc(re.time) : '時間未設定'}</div></div><button class="icon-btn" onclick="rmRepeatEvent('${re.id}')">×</button></div>`).join('');
  
  html += futureHtml || '<div class="empty" style="padding:10px;">今後の予定はありません</div>';
  
  // 過去の予定エリア（アコーディオン形式）
  if (pastEvents.length > 0 || pastMocks.length > 0) {
    html += `
      <div class="divider" style="margin-top:20px;"></div>
      <div class="expand-section">
        <div class="expand-hdr" onclick="toggleExpand(this)" style="padding:10px; background:var(--bg); border-radius:8px;">
          <div class="expand-title" style="font-size:12px; color:var(--muted); font-weight:800;">📜 過去の予定を表示 (${pastEvents.length + pastMocks.length}件)</div>
          <span class="expand-arrow">▼</span>
        </div>
        <div class="expand-body" style="padding:0;">
          ${pastEvents.map((e) => `<div class="row" style="opacity:0.6;"><div><div class="row-title">${esc(e.title)}</div><div class="row-sub">${esc(e.date)} (終了)</div></div><button class="icon-btn" onclick="rmEv('${e.id}')">×</button></div>`).join('')}
          ${pastMocks.map((m) => `<div class="row" style="opacity:0.6;"><div><div class="row-title"><span class="badge bb" style="margin-right:6px">模試</span>${esc(m.name)}</div><div class="row-sub">${esc(m.date)} (終了)</div></div></div>`).join('')}
          <div style="padding:10px; text-align:center;">
            <button class="btn btn-s btn-sm" onclick="clearPastEvents()" style="color:var(--a2); font-size:11px;">過去の予定をすべて削除</button>
          </div>
        </div>
      </div>
    `;
  }
  
  el.innerHTML = html; 
};
window.addEv = () => { const t=document.getElementById('ev-title').value, d=document.getElementById('ev-date').value, tm=document.getElementById('ev-time').value, tp=document.getElementById('ev-type').value; if(t&&d) { const ev={id:generateId(),title:t,date:d,time:tm,type:tp}; S.events.push(ev); DbService.set('events', ev); document.getElementById('ev-time').value=''; } window.closeMo('mo-ev'); renderCal(); };
window.rmEv = (id) => { DbService.del('events', id); S.events = S.events.filter(x => x.id !== id); renderCal(); };

// 🧹↓↓ ここから追加：過去の予定を一括削除する関数 ↓↓🧹
window.clearPastEvents = () => {
  showConfirm(
    '🗑️ 過去の予定を削除',
    '過去の予定をすべて削除してもよろしいですか？（※一度消すと復元できません）',
    '削除する',
    () => {
      const todayStr = DateManager.getTodayStr();
      S.events = S.events.filter(e => {
        if (e.date < todayStr) { DbService.del('events', e.id); return false; }
        return true;
      });
      S.mockSchedule = S.mockSchedule.filter(m => {
        if (m.date < todayStr) { DbService.del('mockSchedule', m.id); return false; }
        return true;
      });
      DbService.setMainProfile();
      renderCal();   // カレンダーの印も消す（renderEvList は renderCal の中で呼ばれる）
      showToast('過去の予定をスッキリ削除しました！');
    }
  );
};
// 🧹↑↑ ここまで追加 ↑↑🧹
const renderWeek = () => { 
  const today = new Date(); const mon = new Date(today); mon.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1) + weekOffset*7); 
  const cols = [0,1,2,3,4,5,6].map(i => { const d = new Date(mon); d.setDate(mon.getDate()+i); return d; }); 
  const dayNames = ['月','火','水','木','金','土','日'], periods = ['1限','2限','3限','4限','5限','6限','7限','8限','9限','10限'];
  const pTimes = {'1限':'9:10<br>~<br>10:00','2限':'10:10<br>~<br>11:00','3限':'11:10<br>~<br>12:00','4限':'12:10<br>~<br>13:00','5限':'13:40<br>~<br>14:30','6限':'14:40<br>~<br>15:30','7限':'15:40<br>~<br>16:30','8限':'16:40<br>~<br>17:30','9限':'17:40<br>~<br>18:30','10限':'18:40<br>~<br>19:30'};
  document.getElementById('week-title').textContent = `${cols[0].getMonth()+1}/${cols[0].getDate()} 〜 ${cols[6].getMonth()+1}/${cols[6].getDate()}`; 
  let html = `<table class="week-table"><tr><th style="width:40px"></th>${cols.map((d,i) => `<th>${dayNames[i]}<br>${d.getDate()}</th>`).join('')}</tr>`; 
  periods.forEach(p => { 
    html += `<tr><th style="vertical-align:middle; line-height:1.2;">${p}<br><span style="font-size:8px; color:var(--muted); font-weight:normal; display:inline-block; margin-top:2px;">${pTimes[p]}</span></th>`;
    cols.forEach((_, ci) => { 
      const day = dayNames[ci];
      let cellData = S.timetable[day]?.[p];
      let subj = '';
      if(cellData) { subj = typeof cellData === 'string' ? cellData : (cellData.subj || ''); }
      html += `<td>${subj?`<span class="wk-ev">${esc(subj)}</span>`:''}</td>`; 
    }); 
    html += '</tr>'; 
  }); 
  html += '</table>'; 
  document.getElementById('week-wrap').innerHTML = html; 
};
window.chWeek = (d) => { weekOffset += d; renderWeek(); };
window.chWeekToday = () => { weekOffset = 0; renderWeek(); }; // 今週へ一発で戻る（月カレンダーの「今月」と同じ）

window.chEvalMonth = (d) => { evalCalMonth = new Date(evalCalMonth.getFullYear(), evalCalMonth.getMonth()+d, 1); renderCoachHistory(); };
window.chEvalToday = () => { evalCalMonth = new Date(); renderCoachHistory(); }; // 今月へ一発で戻る（月カレンダーの「今月」と同じ）
window.showEvalDetail = (dateStr) => {
  const detailEl = document.getElementById('eval-cal-detail'); const h = S.aiCoachLog.history.find(x => x.date === dateStr);
  if (!h) { detailEl.style.display = 'none'; return; }
  detailEl.style.display = 'block'; detailEl.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;font-size:12px;color:var(--muted)">${esc(h.date)} の評価</div><div style="display:flex;align-items:flex-start;gap:10px;"><div class="rank-badge rank-badge-sm rank-${esc(h.rank)}">${esc(h.rank)}</div><div style="flex:1;line-height:1.5">${esc(h.comment)}</div></div>`;
};
const renderCoachHistory = () => {
  const elHead = document.getElementById('eval-cal-head'); const elBody = document.getElementById('eval-cal-body'); const elTitle = document.getElementById('eval-cal-title'); if(!elHead || !elBody || !elTitle) return;
  const y = evalCalMonth.getFullYear(); const mo = evalCalMonth.getMonth(); elTitle.textContent = y + '年' + (mo+1) + '月';
  elHead.innerHTML = ['日','月','火','水','木','金','土'].map(d => `<div class="cal-head">${d}</div>`).join('');
  const first = new Date(y,mo,1).getDay(), last = new Date(y,mo+1,0).getDate(), today = new Date();
  const historyMap = {}; if (S.aiCoachLog && S.aiCoachLog.history) S.aiCoachLog.history.forEach(h => { historyMap[h.date] = h; });
  let html = ''; for (let i = first-1; i >= 0; i--) html += `<div class="eval-cal-day other-m"></div>`;
  for (let d = 1; d <= last; d++) {
    const ds = `${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; const isTd = today.getFullYear()===y && today.getMonth()===mo && today.getDate()===d; const h = historyMap[ds];
    let content = `<span>${d}</span>`; if (h) content += `<div class="eval-badge rank-${esc(h.rank)}">${esc(h.rank)}</div>`;
    html += `<div class="eval-cal-day${isTd?' today':''}" onclick="showEvalDetail('${ds}')">${content}</div>`;
  }
  elBody.innerHTML = html;
};

// ボーダー情報の鮮度と出典を表示する。
// 古い情報のまま判断すると危ないので、90日以上前なら再取得を促す。
const renderBorderProvenance = (u) => {
  if (!u.borderFetchedAt) return '';
  const days = Math.round((DateManager.parseSafe(DateManager.getTodayStr()) - DateManager.parseSafe(u.borderFetchedAt)) / 86400000);
  const stale = days > 90;
  return `<div style="margin-top:4px">
    <div style="font-size:10px;color:${stale ? 'var(--a2)' : 'var(--muted)'}">
      ${stale ? '⚠️ ' : '🕒 '}${esc(u.borderFetchedAt)} 取得（${days}日前）${stale ? ' — 情報が古い可能性があります' : ''}
    </div>${renderSourceChips(u.borderSources, 'ボーダーの出典')}
  </div>`;
};

const renderUniList = () => { const el = document.getElementById('uni-list-c'); if (!el) return; el.innerHTML = S.unis.map(u => `<div class="row"><div style="flex:1"><div class="row-title">${esc(u.name)} <span class="badge bb">${esc(u.type)}</span></div><div class="row-sub">${esc(u.dep)}</div>${u.aiInfo?`<div style="font-size:11px;color:var(--muted);margin-top:4px">${esc(u.aiInfo)}</div>`:''}${renderBorderProvenance(u)}<button class="btn btn-s btn-sm mt8" onclick="aiSearchUni(${S.unis.indexOf(u)})">🔄 ボーダーを再取得</button></div><div style="text-align:right;margin-left:10px"><div style="font-size:20px;font-weight:900;color:var(--accent)">${u.prob!=null?esc(u.prob)+'%':'—'}</div><button class="icon-btn" onclick="rmUni('${u.id}')">×</button></div></div>`).join('') || 'なし'; };
window.addUni = async () => { const n = document.getElementById('u-name').value.trim(), d = document.getElementById('u-dep').value.trim(), t = document.getElementById('u-type').value; if(n) { const obj={id:generateId(), name:n, dep:d||'未設定', type:t}; S.unis.push(obj); DbService.set('unis', obj); window.closeMo('mo-uni'); renderUniList(); renderHome(); await window.aiSearchUni(S.unis.length-1); } };
window.rmUni = (id) => { DbService.del('unis', id); S.unis = S.unis.filter(x=>x.id!==id); renderUniList(); renderHome(); };

window.aiSearchUni = async (idx) => { 
  const u = S.unis[idx]; if (!u) return; 
  try { 
    const {pct} = calcSimScores();
    // 検索→抽出の2段階にしないと、モデルが検索せずに記憶で答えてしまい出典が残らない
    const { data: info, sources } = await AiService.researchJson({
      question: `${u.name} ${u.dep} の最新の入試情報を、河合塾（Kei-Net）・駿台・大学公式サイトなどで調べてください。知りたいのは次の3点です。\n`
        + `1. 共通テストのボーダー得点率（％）\n2. 二次試験で課される科目\n3. 共通テスト得点率が${pct}%の受験生の合格可能性（％）の目安\n`
        + `それぞれ、どのサイトの情報かが分かるように説明してください。`,
      format: '{"border":80,"niji":"英語,国語","prob":65}',
      // 見つからなかった項目は、情報源を変えて調べ直させる
      required: { border: '共通テストのボーダー得点率（％）', niji: '二次試験で課される科目', prob: '合格可能性（％）の目安' },
      withContext: true
    });
    const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return n > 0 && n <= 100 ? n : null; };
    u.border = num(info.border); u.prob = num(info.prob);
    u.aiInfo = `最新ボーダー:${u.border != null ? u.border + '%' : '不明'} / 二次:${info.niji || '不明'}`;
    // AIのボーダー推測は外れることがあるので、いつ・どこから取った情報かを必ず残す
    u.borderFetchedAt = DateManager.getTodayStr();
    u.borderSources = (sources || []).slice(0, 3);
    DbService.set('unis', u);
  } catch(e){ u.aiInfo=`⚠️取得失敗: ${e.message}`; }
  renderUniList(); renderHome(); window.doSim(); 
};

const calcSimScores = () => { 
  const maxes = {'s-en':200,'s-jp':200,'s-ma':200,'s-hi':100,'s-pe':100,'s-ch':50,'s-bi':50,'s-in':100}; let total = 0, totalMax = 0;
  for(let id in maxes) { const el = document.getElementById(id); if(el && parseInt(el.value) >= 0) { total += parseInt(el.value); totalMax += maxes[id]; } }
  if (totalMax === 0) totalMax = 800; return {total, max: totalMax, pct: Math.round(total/totalMax*100)}; 
};

window.doSim = () => { 
  const {total, max, pct} = calcSimScores(); const maxes = {'s-en':200,'s-jp':200,'s-ma':200,'s-hi':100,'s-pe':100,'s-ch':50,'s-bi':50,'s-in':100};
  ['s-en','s-jp','s-ma','s-hi','s-pe','s-ch','s-bi','s-in'].forEach(id=>{ const el=document.getElementById('sv-'+id.slice(2)); if(el)el.textContent=document.getElementById(id).value + '/' + maxes[id]; }); 
  const st=document.getElementById('s-total'),sp=document.getElementById('s-pct'); 
  if(st)st.innerHTML=`<strong>${total}</strong>/${max}点`; if(sp)sp.textContent=pct; 
  const sr=document.getElementById('sim-res'); 
  if(sr) {
    sr.innerHTML=S.unis.map(u=>{
      let simProb = esc(u.prob || '—'); if (u.border && !isNaN(u.border)) { const diff = pct - u.border; simProb = Math.round(Math.min(99, Math.max(10, 50 + diff * 4))); }
      return `<div class="row"><div><div class="row-title">${esc(u.name)}</div><div class="row-sub">ボ${esc(u.border||'—')}% / あなた${pct}%</div></div><strong style="color:var(--accent)">${simProb}%</strong></div>`;
    }).join(''); 
  }
  setTimeout(initProbChart,50); 
};

window.aiSearchBorder = async () => { 
  const q = document.getElementById('border-q')?.value||''; const el = document.getElementById('border-res'); if(q.length<2) return; 
  el.innerHTML="<div class='empty'>🔍 Web検索して出典を確認中...（15秒ほどかかります）</div>"; 
  try{ 
    const { data: info, sources } = await AiService.researchJson({
      question: `「${q}」の最新の共通テストボーダー得点率を、河合塾（Kei-Net）や駿台などの信憑性の高いサイトで調べてください。該当する大学・学部が複数ある場合はそれぞれについて、ボーダー得点率と出典を示してください。`,
      format: '{"res":[{"n":"大学・学部名","b":80,"s":"出典や備考"}]}'
    });
    if(!info.res || info.res.length===0) throw new Error("データが見つかりませんでした");
    el.innerHTML=(info.res||[]).map(b=>`<div class="row"><div>${esc(b.n)}<div class="row-sub">${esc(b.s)}</div></div><span class="badge bb">${esc(b.b)}%</span></div>`).join('')
      + renderSourceChips(sources, 'ボーダーの出典');
  } catch(e){ el.innerHTML=`<div class='empty' style='color:var(--a2)'>検索失敗: ${esc(e.message)}</div>`; } 
};

window.renderScoring = async (force = false) => { 
  const el=document.getElementById('scoring-c'); if(!el||!S.unis.length)return; 
  if(!force && S.cachedScoring){ el.innerHTML=S.cachedScoring + '<button class="btn btn-s btn-sm mt12" style="width:100%" onclick="renderScoring(true)">🔄 AIで最新の配点を再取得</button>'; return; } 
  if(!force) return; el.innerHTML="<div class='empty'>🔍 AIが配点をWeb検索中...（20秒ほどかかります）</div>"; 
  try{ 
    // 「今年」ではなく入試年度で聞く（9月なら翌年度、2月ならその年度）
    const currentYear = AiService.admissionYear();
    // 検索→抽出の2段階。JSONだけを求めると検索せずに記憶で答えてしまうため
    const { data: info, sources } = await AiService.researchJson({
      question: `${S.unis.map(u=>u.name+'('+u.dep+')').join(', ')} の${currentYear}年度（最新）入試の配点を調べてください。`
        + `前期・中期・後期など存在する全ての入試日程・形式ごとに、共通テストと二次試験それぞれの満点と科目別の配点内訳、および共通テスト:二次の比率を、出典とあわせて説明してください。`,
      format: '{"res":[{"n":"大学・学部名","types":[{"t":"前期","c_pct":40,"s_pct":60,"c_total":315,"s_total":450,"c_arr":[{"s":"英語","p":60,"n":"リスニング含む"}],"s_arr":[{"s":"数学","p":150,"n":"数1A2B"}]}]}]}',
      purpose: 'deep'
    });
    
    // 💡 描画ロジックを修正：types配列をループして日程ごとにUIを生成
    let html = (info.res||[]).map((d, uIdx) => {
      let typesHtml = (d.types||[]).map(rawType => {
        // AIが返した値をそのまま style や value に入れると、壊れた値や悪意ある文字列でHTMLが崩れる。数値は必ず数値化する
        const nn = (v) => { const x = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) ? x : 0; };
        const typeObj = { ...rawType, c_pct: Math.min(100, nn(rawType.c_pct)), s_pct: Math.min(100, nn(rawType.s_pct)), c_total: nn(rawType.c_total), s_total: nn(rawType.s_total),
          c_arr: (Array.isArray(rawType.c_arr) ? rawType.c_arr : []).map(c => ({ ...c, p: nn(c.p) })), s_arr: (Array.isArray(rawType.s_arr) ? rawType.s_arr : []).map(s => ({ ...s, p: nn(s.p) })) };
        const cBar = `<div style="height:8px; background:var(--accent); width:${typeObj.c_pct}%; border-radius:4px 0 0 4px;"></div>`;
        const sBar = `<div style="height:8px; background:var(--a2); width:${typeObj.s_pct}%; border-radius:0 4px 4px 0;"></div>`;
        
        const cRows = (typeObj.c_arr||[]).map(c => `<tr><td style="padding:6px 4px; border-bottom:1px solid var(--border);">${esc(c.s)}</td><td style="padding:6px 4px; border-bottom:1px solid var(--border);"><input type="number" value="${c.p}" style="width:55px; padding:2px 4px; font-size:13px; border:1px solid #ccc; border-radius:4px; text-align:right;"> 点</td><td style="padding:6px 4px; border-bottom:1px solid var(--border); font-size:11px; color:var(--muted);">${esc(c.n||'')}</td></tr>`).join('');
        
        const sRows = (typeObj.s_arr||[]).map(s => `<tr><td style="padding:6px 4px; border-bottom:1px solid var(--border);">${esc(s.s)}</td><td style="padding:6px 4px; border-bottom:1px solid var(--border);"><input type="number" value="${s.p}" style="width:55px; padding:2px 4px; font-size:13px; border:1px solid #ccc; border-radius:4px; text-align:right;"> 点</td><td style="padding:6px 4px; border-bottom:1px solid var(--border); font-size:11px; color:var(--muted);">${esc(s.n||'')}</td></tr>`).join('');

        return `<div style="margin-top:12px; border-top:1px dashed var(--border); padding-top:12px;">
          <div style="font-weight:700; font-size:14px; margin-bottom:6px; color:var(--text);">📌 ${esc(typeObj.t)}</div>
          <div style="font-size:12px; font-weight:700; color:var(--muted); margin-bottom:4px;">配点比率（共テ ${typeObj.c_pct}% / 二次 ${typeObj.s_pct}%）</div>
          <div style="display:flex; width:100%; margin-bottom:14px; box-shadow:inset 0 1px 3px rgba(0,0,0,0.1); border-radius:4px;">${cBar}${sBar}</div>
          
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px;">
            <div style="background:var(--card); padding:12px; border-radius:8px; border:1px solid var(--border); box-shadow:0 1px 4px rgba(0,0,0,0.03);">
              <div style="font-weight:800; color:var(--accent); margin-bottom:8px; font-size:14px; border-bottom:2px solid var(--accent); padding-bottom:4px;">📝 共通テスト（計${typeObj.c_total}点）</div>
              <table style="width:100%; font-size:13px; border-collapse:collapse; text-align:left;">${cRows}</table>
            </div>
            <div style="background:var(--card); padding:12px; border-radius:8px; border:1px solid var(--border); box-shadow:0 1px 4px rgba(0,0,0,0.03);">
              <div style="font-weight:800; color:var(--a2); margin-bottom:8px; font-size:14px; border-bottom:2px solid var(--a2); padding-bottom:4px;">✍️ 二次試験（計${typeObj.s_total}点）</div>
              <table style="width:100%; font-size:13px; border-collapse:collapse; text-align:left;">${sRows}</table>
            </div>
          </div>
        </div>`;
      }).join('');

      return `<div style="background:var(--bg); border-radius:10px; padding:16px; margin-bottom:16px; border:1px solid var(--border);">
        <div style="font-weight:900; font-size:16px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
          <span>🎓 ${esc(d.n)}</span>
        </div>
        ${typesHtml}
        <button class="btn btn-s btn-sm" style="margin-top:16px; width:100%; background:var(--card); font-weight:bold;" onclick="saveScoringData(this)">💾 この配点を保存する</button>
      </div>`;
    }).join('');

    S.cachedScoring=html + renderSourceChips(sources, '配点の出典'); DbService.setMainProfile();
    el.innerHTML=S.cachedScoring + '<button class="btn btn-s btn-sm mt12" style="width:100%" onclick="renderScoring(true)">🔄 AIで最新の配点を再取得</button>';
  }catch(e){ el.innerHTML=`<div class='empty' style='color:var(--a2)'>取得失敗: ${esc(e.message)}</div><button class="btn btn-s btn-sm mt8" onclick="renderScoring(true)">🔄 再試行</button>`; } 
};

// 配点データを実際に保存する関数
window.saveScoringData = (btn) => {
  const card = btn.closest('div[style*="border:1px solid var(--border)"]') || btn.parentElement;
  // 入力中の数値を収集してcachedScoringを更新
  const inputs = document.querySelectorAll('#scoring-c input[type="number"]');
  inputs.forEach(inp => {
    const val = inp.value;
    inp.setAttribute('value', val); // value属性を更新してHTMLに反映
  });
  // 現在表示されているHTMLをそのままキャッシュに保存
  const scoringEl = document.getElementById('scoring-c');
  if (scoringEl) {
    // ボタン類を除いたHTMLを保存
    const tempDiv = scoringEl.cloneNode(true);
    // 消すのは「再取得」ボタンだけ。「この配点を保存する」まで消すと、一度保存したあと二度と保存できなくなる
    tempDiv.querySelectorAll('.btn').forEach(b => { if ((b.getAttribute('onclick') || '').includes('renderScoring')) b.remove(); });
    S.cachedScoring = tempDiv.innerHTML;
    DbService.setMainProfile();
  }
  showToast('💾 配点データを保存しました！', 'success');
};

window.renderTrend = async (force = false) => { 
  const el=document.getElementById('trend-c'); if(!el||!S.unis.length)return; 
  if(!force && S.cachedTrend){ el.innerHTML=S.cachedTrend + '<button class="btn btn-s btn-sm mt8" onclick="renderTrend(true)">🔄 再取得</button>'; return; } 
  if(!force) return; el.innerHTML="<div class='empty'>🔍 Web検索して出典を確認中...（15秒ほどかかります）</div>"; 
  try{ 
    const { data: info, sources } = await AiService.researchJson({
      question: `${S.unis.map(u=>u.name).join('、')} の最新の入試傾向について、予備校（河合塾・駿台・東進など）の傾向分析を調べてください。科目ごとの出題傾向と対策のポイントを、出典とあわせて説明してください。`,
      format: '{"res":[{"n":"大学","d":"傾向詳細"}]}',
      purpose: 'deep'
    });
    const trendSrc = renderSourceChips(sources, '傾向分析の出典');
    S.cachedTrend=(info.res||[]).map(d=>`<div class="trend-item"><strong>${esc(d.n)}</strong><div style="font-size:13px;color:var(--muted)">${esc(d.d)}</div></div>`).join('') + trendSrc; DbService.setMainProfile();
    el.innerHTML=S.cachedTrend + '<button class="btn btn-s btn-sm mt8" onclick="renderTrend(true)">🔄 再取得</button>'; 
  }catch(e){ el.innerHTML=`<div class='empty' style='color:var(--a2)'>取得失敗: ${esc(e.message)}</div><button class="btn btn-s btn-sm mt8" onclick="renderTrend(true)">🔄 再試行</button>`; } 
};

const recordStudy = (s, m, dKey) => {
  // AIの読み取り結果は "120" のような文字列で来ることがある。そのまま足すと "30120" のように
  // 文字列として連結され、合計・グラフ・連続日数がすべて壊れるので、必ず数値にする。
  m = Math.round(Number(m)); s = String(s ?? '').trim();
  if (!s || !Number.isFinite(m) || m <= 0) return;
  if(!dKey) dKey = DateManager.getTodayStr();
  S.studyTime[s]=(S.studyTime[s]||0)+m; S.totalMinutes+=m;
  // 壊れた日付キーでは曜日別・月別に足さない（parseSafe は無効な日付を返す）
  const d = DateManager.parseSafe(dKey);
  if (!isNaN(d)) { S.weekdayTime[d.getDay()] = (S.weekdayTime[d.getDay()] || 0) + m; S.monthlyTime[d.getMonth()] = (S.monthlyTime[d.getMonth()] || 0) + m; }
  if(!S.dailyLogs[dKey]) S.dailyLogs[dKey]={total:0,subjects:{}};
  if(!S.dailyLogs[dKey].subjects) S.dailyLogs[dKey].subjects={};
  S.dailyLogs[dKey].total=(Number(S.dailyLogs[dKey].total)||0)+m; S.dailyLogs[dKey].subjects[s]=(S.dailyLogs[dKey].subjects[s]||0)+m;
  DbService.setMainProfile();
  DbService.setDailyLog(dKey);
  // checkAchievements は後続ファイルで定義されるため、念のため存在確認してから呼ぶ
  if (typeof checkAchievements === 'function') checkAchievements();
};

// recordStudy の逆操作。記録を編集・削除したときに集計から正しく引く。
// これをやらないと dailyLogs だけ減って studyTime / totalMinutes が増えたまま残り、
// 科目別グラフと合計時間がずっとズレたままになる。
const unrecordStudy = (s, m, dKey) => {
  m = Math.round(Number(m));
  if (!Number.isFinite(m) || m <= 0) return; if (!dKey) dKey = DateManager.getTodayStr();
  S.studyTime[s] = Math.max(0, (S.studyTime[s] || 0) - m);
  S.totalMinutes = Math.max(0, (S.totalMinutes || 0) - m);
  const d = DateManager.parseSafe(dKey);
  // 壊れた日付キーでは曜日別・月別から引かない（recordStudy と対称）
  if (!isNaN(d)) {
    S.weekdayTime[d.getDay()] = Math.max(0, (S.weekdayTime[d.getDay()] || 0) - m);
    S.monthlyTime[d.getMonth()] = Math.max(0, (S.monthlyTime[d.getMonth()] || 0) - m);
  }
  if (S.dailyLogs[dKey]) {
    S.dailyLogs[dKey].total = Math.max(0, (S.dailyLogs[dKey].total || 0) - m);
    const cur = Math.max(0, (S.dailyLogs[dKey].subjects[s] || 0) - m);
    if (cur <= 0) delete S.dailyLogs[dKey].subjects[s]; else S.dailyLogs[dKey].subjects[s] = cur;
    DbService.setDailyLog(dKey);
  }
  DbService.setMainProfile();
};

window.addStudyTime = () => { 
  recordStudy(document.getElementById('add-subj').value, +document.getElementById('add-min').value, document.getElementById('add-date').value || DateManager.getTodayStr()); 
  document.getElementById('add-min').value=''; initAllCharts(); renderHome(); 
};
window.quickStudy = () => { recordStudy(document.getElementById('qs-subj').value, +document.getElementById('qs-min').value, DateManager.getTodayStr()); document.getElementById('qs-min').value=''; window.closeMo('mo-study'); initAllCharts(); renderHome(); };
let _mockTblMode = 'dev'; // 'dev'=偏差値 / 'score'=実得点
const renderMockTbl = () => {
  ['mock-tbl','mock-rec-tbl'].forEach(targetId => {
    const el = document.getElementById(targetId); if (!el) return;
    if (!S.mocks.length) { el.innerHTML = '<div class="empty">模試の記録がありません</div>'; return; }
    const tabBar = `<div style="display:flex;gap:6px;margin-bottom:8px">
      <button class="btn btn-sm ${_mockTblMode==='dev'?'btn-p':'btn-s'}" onclick="_mockTblMode='dev';renderMockTbl()" style="font-size:11px;padding:4px 10px">偏差値</button>
      <button class="btn btn-sm ${_mockTblMode==='score'?'btn-p':'btn-s'}" onclick="_mockTblMode='score';renderMockTbl()" style="font-size:11px;padding:4px 10px">実得点</button>
    </div>`;
    let tbl = '';
    if (_mockTblMode === 'dev') {
      const rows = S.mocks.map(m => {
        const typeBadge = m.type === 'kijutsu'
          ? '<span class="badge by" style="font-size:9px;margin-right:4px">記述</span>'
          : '<span class="badge bb" style="font-size:9px;margin-right:4px">共通</span>';
        const cols = m.type === 'kijutsu'
          ? `<td>${esc(m.en||'-')}</td><td>${esc(m.jp||'-')}</td><td>${esc(m.ma||'-')}</td><td>-</td><td>-</td><td style="font-weight:700;color:var(--accent)">${esc(m.total||'-')}</td>`
          : `<td>${esc(m.en||'-')}</td><td>${esc(m.jp||'-')}</td><td>${esc(m.ma||'-')}</td><td>${esc(m.hi||'-')}</td><td>${esc(m.pe||'-')}</td><td style="font-weight:700;color:var(--accent)">${esc(m.total||'-')}</td>`;
        return `<tr style="border-bottom:1px solid var(--border)"><td>${typeBadge}${esc(m.name)}<div style="font-size:10px;color:var(--muted)">${esc(m.date)}</div></td>${cols}<td style="color:var(--muted)">${esc(m.rank||'-')}</td></tr>`;
      }).join('');
      tbl = `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;text-align:left;min-width:480px"><tr style="font-size:11px;color:var(--muted)"><th>模試</th><th>英</th><th>国</th><th>数</th><th>世</th><th>政</th><th>総合</th><th>順位</th></tr>${rows}</table></div>`;
    } else {
      const kyotsu = S.mocks.filter(m => !m.type || m.type === 'kyotsu');
      const kijutsu = S.mocks.filter(m => m.type === 'kijutsu');
      let scoreHtml = '';
      if (kyotsu.length) {
        const rows = kyotsu.map(m => {
          const f = (v, max) => v != null ? `${esc(v)}<span style="color:var(--muted);font-size:10px">/${max}</span>` : '-';
          return `<tr style="border-bottom:1px solid var(--border)">
            <td><span class="badge bb" style="font-size:9px;margin-right:4px">共通</span>${esc(m.name)}<div style="font-size:10px;color:var(--muted)">${esc(m.date)}</div></td>
            <td>${f(m.enScore,200)}</td><td>${f(m.jpScore,200)}</td>
            <td>${f(m.ma1Score,100)}</td><td>${f(m.ma2Score,100)}</td><td>${f(m.macScore,100)}</td>
            <td>${f(m.hiScore,100)}</td><td>${f(m.peScore,100)}</td>
            <td>${f(m.chScore,50)}</td><td>${f(m.biScore,50)}</td><td>${f(m.inScore,100)}</td>
          </tr>`;
        }).join('');
        scoreHtml += `<div style="font-weight:700;font-size:12px;margin:8px 0 4px">📝 共通テスト系</div>
          <div style="overflow-x:auto"><table style="width:100%;font-size:11px;text-align:left;min-width:640px">
          <tr style="font-size:10px;color:var(--muted)"><th>模試</th><th>英語</th><th>国語</th><th>数1A</th><th>数2B</th><th>数C</th><th>世界史</th><th>政経</th><th>化基</th><th>生基</th><th>情報</th></tr>
          ${rows}</table></div>`;
      }
      if (kijutsu.length) {
        const rows = kijutsu.map(m => {
          const f = (v) => v != null ? esc(v) : '-';
          return `<tr style="border-bottom:1px solid var(--border)">
            <td><span class="badge by" style="font-size:9px;margin-right:4px">記述</span>${esc(m.name)}<div style="font-size:10px;color:var(--muted)">${esc(m.date)}</div></td>
            <td>${f(m.enScore)}</td><td>${f(m.jpScore)}</td><td>${f(m.maScore)}</td>
          </tr>`;
        }).join('');
        scoreHtml += `<div style="font-weight:700;font-size:12px;margin:12px 0 4px">✍️ 記述系</div>
          <div style="overflow-x:auto"><table style="width:100%;font-size:11px;text-align:left">
          <tr style="font-size:10px;color:var(--muted)"><th>模試</th><th>英語</th><th>国語</th><th>数学</th></tr>
          ${rows}</table></div>`;
      }
      tbl = scoreHtml || '<div class="empty">実得点データがありません</div>';
    }
    el.innerHTML = tabBar + tbl;
  });
};
// 模試モーダルを開く（フォームを必ず共通テスト系にリセット）
window.openMockModal = () => {
  showMo('mo-mock');
  setTimeout(() => {
    const typeEl = document.getElementById('m-type');
    if (typeEl) { typeEl.value = 'kyotsu'; switchMockType('kyotsu'); }
  }, 10);
};

// 模試種別フォーム切り替え
window.switchMockType = (type) => {
  document.getElementById('mock-form-kyotsu').style.display = type === 'kyotsu' ? '' : 'none';
  document.getElementById('mock-form-kijutsu').style.display = type === 'kijutsu' ? '' : 'none';
};

window.addMock = () => {
  const getV  = (id) => { const el = document.getElementById(id); return el ? (+el.value || 0) : 0; };
  const getVN = (id) => { const el = document.getElementById(id); if (!el) return null; const v = el.value; return (v && v !== '') ? +v : null; };
  const type = document.getElementById('m-type')?.value || 'kyotsu';
  const isK  = type === 'kijutsu';
  const obj = {
    id: generateId(),
    name: document.getElementById('m-name').value || '無名の模試',
    date: document.getElementById('m-date').value || DateManager.getTodayStr(),
    type,
    rank: getV('m-rank'),
    en:    isK ? getV('m-k-en')    : getV('m-en'),
    jp:    isK ? getV('m-k-jp')    : getV('m-jp'),
    ma:    isK ? getV('m-k-ma')    : getV('m-ma'),
    hi:    isK ? null              : getV('m-hi'),
    pe:    isK ? null              : getV('m-pe'),
    total: isK ? getV('m-k-total') : getV('m-total'),
    enScore:  isK ? getVN('m-k-en-score') : getVN('m-en-score'),
    jpScore:  isK ? getVN('m-k-jp-score') : getVN('m-jp-score'),
    maScore:  isK ? getVN('m-k-ma-score') : null,
    ma1Score: isK ? null : getVN('m-ma1-score'),
    ma2Score: isK ? null : getVN('m-ma2-score'),
    macScore: isK ? null : getVN('m-mac-score'),
    hiScore:  isK ? null : getVN('m-hi-score'),
    peScore:  isK ? null : getVN('m-pe-score'),
    chScore:  isK ? null : getVN('m-ch-score'),
    biScore:  isK ? null : getVN('m-bi-score'),
    inScore:  isK ? null : getVN('m-in-score'),
  };
  S.mocks.push(obj); DbService.set('mocks', obj);
  // グラフと「最新の模試」は配列の並びに依存しているので、受験日順に保つ
  // （過去の模試をあとから入力すると、推移グラフの順番が崩れ、それが「最新」扱いになっていた）
  S.mocks.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  window.closeMo('mo-mock'); renderMockTbl(); initAllCharts(); renderHome();
  showToast('📊 模試「' + obj.name + '」を記録しました！', 'success');
};

const renderHeatmaps = () => { ['math','eng','history'].forEach(k=>{ const el=document.getElementById('hm-'+k); if(el) el.innerHTML=S.heatmapData[k].topics.map((t,i)=>`<div class="hc h${S.heatmapData[k].levels[i]}" onclick="S.heatmapData['${k}'].levels[${i}]=(S.heatmapData['${k}'].levels[${i}]+1)%5; DbService.setMainProfile(); renderHeatmaps()"></div>`).join(''); }); };

const charts={}; const dc = (id) => { if (charts[id]) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; } };
const initMockSubjChart = () => {
  const el = document.getElementById('chart-mock-subj');
  if (!el || !el.offsetParent) return;
  dc('mockSubj');   // データが0件になったときも、古いグラフを残さない
  if (!S.mocks.length) return;
  const labels = S.mocks.map(m => m.date.slice(5));
  const subjDefs = [
    { key: 'en',    label: '英語',   color: '#1d4ed8' },
    { key: 'jp',    label: '国語',   color: '#dc4f1e' },
    { key: 'ma',    label: '数学',   color: '#16a05a' },
    { key: 'hi',    label: '世界史', color: '#c07010' },
    { key: 'pe',    label: '政経',   color: '#6030b8' },
    { key: 'total', label: '総合',   color: '#0a6878' },
  ];
  // 1回でも記録があるデータだけ表示
  const datasets = subjDefs
    .filter(d => S.mocks.some(m => m[d.key] > 0))
    .map(d => ({
      label: d.label,
      data: S.mocks.map(m => m[d.key] || null),
      borderColor: d.color,
      backgroundColor: d.color + '22',
      pointBackgroundColor: d.color,
      tension: 0.3,
      spanGaps: true,
    }));
  charts.mockSubj = new Chart(el, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 30, max: 80,
          ticks: { stepSize: 10 },
          title: { display: true, text: '偏差値' }
        }
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        tooltip: { mode: 'index', intersect: false }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
  // 凡例ドット（モバイルで見やすく）
  const legEl = document.getElementById('mock-subj-legend');
  if (legEl) {
    legEl.innerHTML = datasets.map(d =>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600">
        <span style="width:10px;height:10px;border-radius:50%;background:${d.borderColor};flex-shrink:0"></span>${esc(d.label)}
      </span>`
    ).join('');
  }
};
window.initMockSubjChart = initMockSubjChart;

const initAllCharts = () => { initDevChart(); initRankChart(); initMockScoreChart(); initDailyChart(); initWeeklyChart(); initMoChart(); initDailyPieChart(); initWeeklyPieChart(); initMonthlyPieChart(); initRadarChart(); initAccChart(); initProbChart(); initMockSubjChart(); };
window.initAllCharts = initAllCharts;

