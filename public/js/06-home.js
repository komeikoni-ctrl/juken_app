// ============================================================
// 時間割から科目リストを動的生成
// ============================================================
const FALLBACK_SUBJECTS = ['英語','国語（現代文）','国語（古文）','国語（漢文）','数学1A','数学2B','数学C','世界史','政治経済','化学基礎','生物基礎','情報'];

const getSubjectsFromTimetable = () => {
  const set = new Set();
  Object.values(S.timetable || {}).forEach(dayObj => {
    Object.values(dayObj).forEach(cell => {
      const subj = typeof cell === 'object' ? cell.subj : cell;
      if (subj && subj.trim()) set.add(subj.trim());
    });
  });
  return set.size > 0 ? [...set].sort() : [...FALLBACK_SUBJECTS];
};

const populateSubjectSelects = () => {
  const subjects = getSubjectsFromTimetable();

  // 各セレクトを更新（現在の選択値を維持する）
  const targets = [
    { id: 'timer-subj',    hasEmpty: true,  emptyLabel: '科目を選択' },
    { id: 'add-subj',      hasEmpty: false },
    { id: 'qs-subj',       hasEmpty: false },
    { id: 'hw-subj',       hasEmpty: false },
    { id: 'log-edit-subj', hasEmpty: false },
    { id: 'task-subj',     hasEmpty: true,  emptyLabel: 'なし' },
  ];

  targets.forEach(({ id, hasEmpty, emptyLabel }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value; // 現在の選択値を保存
    let html = hasEmpty ? '<option value="">' + (emptyLabel || '選択してください') + '</option>' : '';
    html += subjects.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    el.innerHTML = html;
    // 以前の値が選択肢にあれば復元
    if (prev && subjects.includes(prev)) el.value = prev;
  });
};
window.populateSubjectSelects = populateSubjectSelects;

window.askQ = (q) => { document.getElementById('chat-in').value = q; window.doChat(); };

// ===== 今日の学習リング =====
const renderTodayRing = () => {
  const todayMin = getTodayMinutes();
  const goalMin = (S.todayGoalMin || 240); // デフォルト4時間
  const pct = Math.min(100, Math.round(todayMin / goalMin * 100));
  const r = 38, cx = 44, cy = 44, circ = 2 * Math.PI * r;
  const dash = circ * pct / 100;
  const lg = S.dailyLogs[DateManager.getTodayStr()];
  const subjColors = ['#1d4ed8','#dc4f1e','#16a05a','#c07010','#6030b8','#0a6878','#b01070','#407040'];
  const subjDots = lg && lg.subjects ? Object.keys(lg.subjects).filter(s=>lg.subjects[s]>0).slice(0,6).map((s,i)=>`<span style="background:${subjColors[i%subjColors.length]}">${esc(s.replace(/（.*?）/,'').slice(0,4))}</span>`).join('') : '';
  const ringEl = document.getElementById('today-ring-inner');
  if (!ringEl) return;
  const color = pct >= 100 ? '#16a05a' : pct >= 60 ? '#1d4ed8' : pct >= 30 ? '#c07010' : '#dc4f1e';
  ringEl.innerHTML = `<div class="today-ring-wrap">
    <svg class="today-ring-svg" width="88" height="88" viewBox="0 0 88 88">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="7"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="7"
        stroke-dasharray="${dash} ${circ}" stroke-dashoffset="${circ/4}" stroke-linecap="round"
        style="transition:stroke-dasharray .6s cubic-bezier(.4,0,.2,1)"/>
      <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="14" font-weight="900" fill="${color}">${pct}%</text>
    </svg>
    <div class="today-ring-info">
      <div class="today-ring-title">今日の学習</div>
      <div class="today-ring-val" style="color:${color}">${DateManager.formatHours(todayMin)}</div>
      <div class="today-ring-goal">目標 ${DateManager.formatHours(goalMin)} <button class="btn btn-s btn-sm" style="padding:2px 8px;font-size:11px;margin-left:6px" onclick="showGoalModal()">変更</button></div>
      ${subjDots ? `<div class="today-ring-subj">${subjDots}</div>` : ''}
    </div>
  </div>`;
};

window.showGoalModal = () => {
  const cur = S.todayGoalMin || 240;
  showConfirm('🎯 今日の目標時間を設定',
    '',
    '設定する',
    () => {
      const inp = document.getElementById('goal-min-input');
      const v = inp ? parseInt(inp.value) : cur;
      if (v > 0) { S.todayGoalMin = v; DbService.setMainProfile(); renderTodayRing(); showToast(`🎯 今日の目標を ${DateManager.formatHours(v)} に設定しました！`); }
    }
  );
  setTimeout(() => {
    const msg = document.getElementById('mo-confirm-msg');
    if (msg) msg.innerHTML = `現在の目標: <strong>${DateManager.formatHours(cur)}</strong><br><br><label style="font-size:12px;font-weight:600;color:var(--muted)">新しい目標（分）</label><input type="number" id="goal-min-input" value="${cur}" min="30" max="720" style="width:100%;margin-top:4px;padding:9px 12px;border:1px solid var(--border);border-radius:7px;font-size:14px;background:var(--card);color:var(--text)">`;
  }, 50);
};

// ===== ナビバッジ更新 =====
const updateNavBadges = () => {
  const todayStr = DateManager.getTodayStr();
  const pendingTasks = S.tasks.filter(t => !t.done).length;
  const overdueHw = S.homework.filter(h => !h.done && h.due && h.due < todayStr).length;
  const nb = document.getElementById('nb-home');
  if (nb) { const n = pendingTasks; nb.textContent = n > 0 ? (n > 9 ? '9+' : n) : ''; nb.style.display = n > 0 ? 'flex' : 'none'; }
  const nbs = document.getElementById('nb-sunzemi');
  if (nbs) { nbs.textContent = overdueHw > 0 ? (overdueHw > 9 ? '9+' : overdueHw) : ''; nbs.style.display = overdueHw > 0 ? 'flex' : 'none'; }
  // 駿台は「その他」シート側にあるので、タブバーのその他ボタンにも同じ知らせを出す
  const nbm = document.getElementById('nb-more');
  if (nbm) { nbm.textContent = overdueHw > 0 ? (overdueHw > 9 ? '9+' : overdueHw) : ''; nbm.style.display = overdueHw > 0 ? 'flex' : 'none'; }
};

// 💡 ホーム画面のレンダリング関数を上書き（真の合計時間を反映）
const renderHome = () => {
  document.getElementById('home-date').textContent = new Date().toLocaleDateString('ja-JP', {year:'numeric',month:'long',day:'numeric',weekday:'short'});
  const kd = DateManager.daysBetween('2027-01-16'), nd = DateManager.daysBetween(S.nijiDate || '2027-02-25');
  if(document.getElementById('home-countdown')) document.getElementById('home-countdown').innerHTML = `<div style="text-align:center;padding:14px;background:var(--bg);border-radius:var(--r)"><div style="font-size:11px;color:var(--muted)">共通テスト 2027</div><div style="font-size:44px;font-weight:900;color:var(--a2);letter-spacing:-2px;line-height:1.1">${DateManager.formatDays(kd)}</div></div><div style="text-align:center;padding:14px;background:var(--bg);border-radius:var(--r)"><div style="font-size:11px;color:var(--muted)">二次試験</div><div style="font-size:44px;font-weight:900;color:var(--accent);letter-spacing:-2px;line-height:1.1">${DateManager.formatDays(nd)}</div></div>`;
  
  const trueTotal = calcTotalMinutes();
  if(document.getElementById('home-stats')) document.getElementById('home-stats').innerHTML = `<div class="stat"><div class="stat-v" style="color:var(--a3)">${DateManager.formatHours(trueTotal)}</div><div class="stat-l">総学習時間</div></div><div class="stat"><div class="stat-v" style="color:var(--accent)">${DateManager.formatHours(getTodayMinutes())}</div><div class="stat-l">今日</div></div><div class="stat"><div class="stat-v" style="color:var(--pur)">${calcStreak()}日</div><div class="stat-l">継続</div></div><div class="stat"><div class="stat-v" style="color:var(--a4)">${S.mocks.length}</div><div class="stat-l">模試回数</div></div>`;
  
  renderTodayRing();
  updateNavBadges();
  
  const colors = ['#1d4ed8','#dc4f1e','#16a05a','#c07010','#6030b8','#0a6878']; const targets = S.scoreTargets; const keys = Object.keys(targets);
  if (keys.length) { document.getElementById('home-subj-prog').innerHTML = keys.map((s,i) => { const t = targets[s]; const pct = t.target > 0 ? Math.round(t.current/t.target*100) : 0; return `<div style="margin-bottom:10px"><div class="flex-between" style="font-size:13px;margin-bottom:3px"><span style="font-weight:700">${esc(s)}</span><span class="muted">${t.current} / 目標 ${t.target}点</span></div><div class="pb"><div class="pf" style="width:${Math.min(100,pct)}%;background:${colors[i%colors.length]}"></div></div></div>`; }).join(''); }
  if (S.unis.length) { const tlbl = {challenge:'チャレンジ',main:'第一志望',safe:'安全校'}; const tbc = {challenge:'br',main:'bb',safe:'bg'}; document.getElementById('home-uni-prob').innerHTML = S.unis.map(u => `<div class="row"><div><div class="flex-gap"><span class="row-title">${esc(u.name)}</span><span class="badge ${tbc[u.type]}">${tlbl[u.type]}</span></div><div class="row-sub">${esc(u.dep)}</div></div><div style="text-align:right"><div style="font-size:22px;font-weight:900;color:${(u.prob||0)>=75?'#16a05a':(u.prob||0)>=50?'#c07010':'#dc4f1e'}">${esc(u.prob||'—')}%</div></div></div>`).join(''); }
  renderTasks();
  
  // ===== 実績バッジ（拡充版 11種）=====
  const streak = calcStreak();
  const totalMocks = S.mocks.length;
  const allAchs = [
    {ico:'⭐', name:'初めての一歩',    desc:'1時間学習達成',    need:60,    cur:trueTotal,  fmt:v=>DateManager.formatHours(v)},
    {ico:'🌱', name:'芽吹き',          desc:'10時間達成',       need:600,   cur:trueTotal,  fmt:v=>DateManager.formatHours(v)},
    {ico:'📚', name:'読書家',          desc:'50時間達成',       need:3000,  cur:trueTotal,  fmt:v=>DateManager.formatHours(v)},
    {ico:'🔥', name:'燃え盛る炎',      desc:'100時間達成',      need:6000,  cur:trueTotal,  fmt:v=>DateManager.formatHours(v)},
    {ico:'💫', name:'受験の星',         desc:'200時間達成',      need:12000, cur:trueTotal,  fmt:v=>DateManager.formatHours(v)},
    {ico:'🏔', name:'頂点へ',           desc:'500時間達成',      need:30000, cur:trueTotal,  fmt:v=>DateManager.formatHours(v)},
    {ico:'📅', name:'3日坊主を超えた',  desc:'7日連続学習',      need:7,     cur:streak,     fmt:v=>v+'日'},
    {ico:'💎', name:'継続は力なり',     desc:'30日連続学習',     need:30,    cur:streak,     fmt:v=>v+'日'},
    {ico:'👑', name:'鉄の意志',         desc:'60日連続学習',     need:60,    cur:streak,     fmt:v=>v+'日'},
    {ico:'📝', name:'初陣',            desc:'初模試記録',        need:1,     cur:totalMocks, fmt:v=>v+'回'},
    {ico:'📊', name:'データ分析家',    desc:'5回模試記録',       need:5,     cur:totalMocks, fmt:v=>v+'回'},
  ];
  if (!S.unlockedAchs) S.unlockedAchs = [];
  allAchs.forEach(a => {
    if (a.cur >= a.need && !S.unlockedAchs.includes(a.name)) {
      S.unlockedAchs.push(a.name);
      setTimeout(() => {
        showToast('🎉 実績解除！「' + a.ico + ' ' + a.name + '」', 'success', 4000);
        try {
          const colors = ['#1d4ed8','#16a05a','#dc4f1e','#c07010','#6030b8'];
          for (let i = 0; i < 60; i++) {
            const div = document.createElement('div');
            div.style.cssText = 'position:fixed;width:8px;height:8px;border-radius:2px;background:' + colors[i%colors.length] + ';left:' + (Math.random()*100) + 'vw;top:-10px;z-index:99999;pointer-events:none;opacity:1;transition:transform ' + (1+Math.random()) + 's ease-out,opacity ' + (1+Math.random()) + 's ease-out';
            document.body.appendChild(div);
            requestAnimationFrame(() => { div.style.transform = 'translateY(' + (60+Math.random()*40) + 'vh) rotate(' + (Math.random()*360) + 'deg)'; div.style.opacity = '0'; });
            setTimeout(() => div.remove(), 2200);
          }
        } catch(e) {}
      }, 300);
      DbService.setMainProfile();
    }
  });
  document.getElementById('home-ach').innerHTML = allAchs.map(a => {
    const done = a.cur >= a.need;
    const prog = Math.min(100, Math.round(a.cur / a.need * 100));
    return '<div class="ach"><div class="ach-ico ' + (done?'ach-un':'ach-lock') + '">' + a.ico + '</div>' +
      '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + esc(a.name) +
      '<span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:6px">' + esc(a.desc) + '</span></div>' +
      (!done ? '<div style="height:4px;background:var(--border);border-radius:2px;margin-top:4px"><div style="height:100%;width:' + prog + '%;background:var(--accent);border-radius:2px;transition:width .4s"></div></div>' : '') +
      '</div><span class="badge ' + (done?'bg':'') + '" style="margin-left:8px;flex-shrink:0">' + (done?'解除済':a.fmt(a.cur)+'/'+a.fmt(a.need)) + '</span></div>';
  }).join('');

  const hour = new Date().getHours(); const alertEl = document.getElementById('home-evening-alert');
  if (alertEl) {
    const todayStr2 = DateManager.getTodayStr();
    const in3days = new Date(); in3days.setDate(in3days.getDate() + 3);
    const in3str = DateManager.getTodayStr(in3days);
    const tomorrow2 = new Date(); tomorrow2.setDate(tomorrow2.getDate() + 1);
    const upcomingAlerts = [];
    S.mockSchedule.filter(m => m.date >= todayStr2 && m.date <= in3str).forEach(m => {
      const diff = DateManager.daysBetween(m.date);
      upcomingAlerts.push(`<span style="color:#1d4ed8;font-weight:700">📝 模試「${esc(m.name)}」</span>まで<strong>${diff === 0 ? '今日！' : diff + '日'}</strong>`);
    });
    S.events.filter(e => e.type === 'exam' && e.date >= todayStr2 && e.date <= in3str).forEach(e => {
      const diff = DateManager.daysBetween(e.date);
      upcomingAlerts.push(`<span style="color:#dc4f1e;font-weight:700">📋 試験「${esc(e.title)}」</span>まで<strong>${diff === 0 ? '今日！' : diff + '日'}</strong>`);
    });
    // 出願などの締切は、3日前に気づいても写真や支払いの準備が間に合わないので1週間前から出す
    const in7days = new Date(); in7days.setDate(in7days.getDate() + 7);
    const in7str = DateManager.getTodayStr(in7days);
    S.events.filter(e => e.type === 'deadline' && e.date >= todayStr2 && e.date <= in7str).forEach(e => {
      const diff = DateManager.daysBetween(e.date);
      upcomingAlerts.push(`<span style="color:#dc4f1e;font-weight:700">📮 ${esc(e.title)}</span>まで<strong>${diff === 0 ? '今日！' : diff + '日'}</strong>`);
    });
    S.homework.filter(h => !h.done && h.due && h.due >= todayStr2 && h.due <= in3str).forEach(h => {
      const diff = DateManager.daysBetween(h.due);
      upcomingAlerts.push(`<span style="color:#c07010;font-weight:700">📚 宿題「${esc(h.subj)} ${esc(h.cont)}」</span>まで<strong>${diff === 0 ? '今日！' : diff + '日'}</strong>`);
    });
    const overdueHw = S.homework.filter(h => !h.done && h.due && h.due < todayStr2);
    if (overdueHw.length > 0) upcomingAlerts.unshift(`<span style="color:#dc4f1e;font-weight:700">⚠️ 期限切れ宿題 ${overdueHw.length}件</span>`);
    let alertHtml = '';
    if (upcomingAlerts.length > 0) {
      alertHtml += `<div class="card" style="border-left:4px solid var(--a2);background:#fff8f6;padding:14px;margin-bottom:8px"><div style="font-weight:800;color:var(--a2);margin-bottom:8px;font-size:14px">⏰ 直近の締め切り</div><div style="font-size:13px;line-height:1.9">${upcomingAlerts.join('<br>')}</div></div>`;
    }
    if (hour >= 18) {
      const days = ['日','月','火','水','木','金','土']; const tomDay = days[tomorrow2.getDay()];
      const tomClassesObj = S.timetable[tomDay]; let tomClassesStr = 'なし';
      if (tomClassesObj && Object.keys(tomClassesObj).length > 0) tomClassesStr = Object.entries(tomClassesObj).map(([p, v]) => { const subj = typeof v === 'object' ? (v.subj||'') : v; return subj ? `${esc(p)}：${esc(subj)}` : ''; }).filter(Boolean).join('、');
      const dueHw = S.homework.filter(h => !h.done && h.due && h.due <= todayStr2);
      const hwStr = dueHw.length > 0 ? dueHw.map(h => `${esc(h.subj)} (${esc(h.cont)})`).join('、') : 'なし 🎉';
      alertHtml += `<div class="card" style="border-left:4px solid var(--pur);background:#faf8ff;padding:14px"><div style="font-weight:800;color:var(--pur);margin-bottom:8px;font-size:14px">🌙 明日の準備と今日の確認</div><div style="font-size:13px;line-height:1.6"><strong>📅 明日の駿台 (${tomDay}曜):</strong> ${tomClassesStr}<br><strong style="color:var(--a2)">📝 期限が今日の未完了宿題:</strong> ${hwStr}</div></div>`;
    }
    alertEl.innerHTML = alertHtml;
    alertEl.style.display = alertHtml ? 'block' : 'none';
  }
};
// ↓↓ この1行を追加 ↓↓
// ページ切り替え
window.closeAllMo = () => { document.querySelectorAll('.ov.open').forEach(m => m.classList.remove('open')); };


window.toggleExpand = (hdr) => { hdr.classList.toggle('open'); const body = hdr.nextElementSibling; body.classList.toggle('open'); if (body.classList.contains('open')) { const canvases = body.querySelectorAll('canvas'); if (canvases.length) setTimeout(initAllCharts, 60); } };
window.showMo = (id) => document.getElementById(id).classList.add('open');
window.closeMo = (id) => { 
  document.getElementById(id).classList.remove('open');
  if (id === 'mo-confirm') return; // 確認モーダルは入力をリセットしない
  document.getElementById(id).querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(inp => inp.value = '');
  document.getElementById(id).querySelectorAll('input[type="date"]').forEach(inp => {
    // task-due は「締切なし」が初期値なので空文字にする。他は今日の日付
    inp.value = inp.id === 'task-due' ? '' : DateManager.getTodayStr();
  });
  document.getElementById(id).querySelectorAll('input[type="time"]').forEach(inp => inp.value = '');
  document.getElementById(id).querySelectorAll('select').forEach(sel => sel.selectedIndex = 0);
};

const renderTasks = () => {
  const el = document.getElementById('home-tasks'); if (!el) return;
  if (!S.tasks.length) { el.innerHTML = '<div class="empty">タスクを追加してください</div>'; return; }
  const todayStr = DateManager.getTodayStr();
  const prioOrder = { high: 0, mid: 1, low: 2 };
  const prioColor = { high: '#dc4f1e', mid: '#c07010', low: '#16a05a' };
  const prioLabel = { high: '🔴', mid: '🟡', low: '🟢' };
  // 未完了を優先度・締切順、完了済みは後ろに
  const sorted = sortedTasks();
  el.innerHTML = sorted.map((t, i) => {
    const origIdx = S.tasks.indexOf(t);
    const isCarryover = t.createdDate && t.createdDate < todayStr && !t.done;
    const isOverdue = !t.done && t.due && t.due < todayStr;
    const daysLeft = t.due ? DateManager.daysBetween(t.due) : null;
    const dueStr = t.due
      ? isOverdue ? `<span style="color:#dc4f1e;font-size:10px;font-weight:700">⚠️ 期限切れ</span>`
        : daysLeft === 0 ? `<span style="color:#c07010;font-size:10px;font-weight:700">📅 今日まで</span>`
        : `<span style="color:var(--muted);font-size:10px">📅 ${t.due}（あと${daysLeft}日）</span>`
      : '';
    const carryBadge = isCarryover ? `<span class="badge by" style="font-size:10px;margin-right:4px">⬆️ 昨日から</span>` : '';
    const subjBadge  = t.subj  ? `<span class="badge bb" style="font-size:10px;margin-right:4px">${esc(t.subj)}</span>` : '';
    const prioBadge  = (t.prio && t.prio !== 'mid') ? `<span style="font-size:11px;margin-right:2px">${prioLabel[t.prio]}</span>` : '';
    return `<div class="ci" draggable="true" data-id="${t.id}" data-idx="${origIdx}"
      ondragstart="taskDragStart(event)" ondragover="taskDragOver(event)" ondragleave="taskDragLeave(event)" ondrop="taskDrop(event)">
      <span class="drag-handle" title="ドラッグで並べ替え">⠿</span>
      <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTask('${t.id}',this)">
      <div class="ci-text" style="flex:1;min-width:0;${t.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;margin-bottom:2px">${carryBadge}${subjBadge}${prioBadge}<span>${esc(t.text)}</span></div>
        ${dueStr ? `<div style="margin-top:1px">${dueStr}</div>` : ''}
      </div>
      <button class="icon-btn" onclick="rmTask('${t.id}')" style="margin-left:6px;flex-shrink:0">×</button>
    </div>`;
  }).join('');
};

// タスクの表示順：未完了が先 → 手で並べ替えた順（order）→ 優先度 → 締切
// order はドラッグで並べ替えたときだけ付く。付いていないタスクは優先度・締切順で後ろに並ぶ。
const sortedTasks = () => {
  const prioOrder = { high: 0, mid: 1, low: 2 };
  return [...S.tasks].sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const oa = a.order ?? null, ob = b.order ?? null;
    if (oa !== null || ob !== null) { if (oa === null) return 1; if (ob === null) return -1; if (oa !== ob) return oa - ob; }
    const pa = prioOrder[a.prio || 'mid'] ?? 1, pb = prioOrder[b.prio || 'mid'] ?? 1;
    if (pa !== pb) return pa - pb;
    return String(a.due || '9999').localeCompare(String(b.due || '9999'));
  });
};

// タスクドラッグ並べ替え実装
// 並び順は各タスクの order として保存する（tasks は1件ずつ同期しているので、
// 配列の順番を入れ替えるだけでは保存も同期もされず、次の描画で元に戻ってしまう）
let _dragSrcId = null;
window.taskDragStart = (e) => { _dragSrcId = e.currentTarget.dataset.id; e.dataTransfer.effectAllowed = 'move'; };
window.taskDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over'); };
window.taskDragLeave = (e) => { e.currentTarget.classList.remove('drag-over'); };
window.taskDrop = (e) => {
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  const toId = e.currentTarget.dataset.id;
  const srcId = _dragSrcId; _dragSrcId = null;
  if (!srcId || srcId === toId) return;
  const ids = sortedTasks().map(t => t.id);
  const from = ids.indexOf(srcId), to = ids.indexOf(toId);
  if (from < 0 || to < 0) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  ids.forEach((id, i) => {
    const t = S.tasks.find(x => x.id === id);
    if (t && t.order !== i) { t.order = i; DbService.set('tasks', t); }
  });
  renderTasks();
};
window.addTask = () => {
  const t = document.getElementById('task-text').value.trim(); if (!t) return;
  const subj = document.getElementById('task-subj')?.value || '';
  const prio = document.getElementById('task-prio')?.value || 'mid';
  const due  = document.getElementById('task-due')?.value  || '';
  const taskObj = { id: generateId(), text: t, done: false, createdDate: DateManager.getTodayStr(), subj, prio, due };
  S.tasks.push(taskObj); DbService.set('tasks', taskObj);
  window.closeMo('mo-task'); renderTasks(); if (typeof updateNavBadges === 'function') updateNavBadges();
};
window.toggleTask = (id, cb) => { const t = S.tasks.find(x => x.id === id); if(t) { t.done = cb.checked; DbService.set('tasks', t); renderTasks(); if (typeof updateNavBadges === 'function') updateNavBadges(); } };
window.rmTask = (id) => { DbService.del('tasks', id); S.tasks = S.tasks.filter(x => x.id !== id); renderTasks(); if (typeof updateNavBadges === 'function') updateNavBadges(); };

window.T = {mode:'stopwatch',running:false,elapsed:0,interval:null, startTime:0, startElapsed:0};
window.setTimerMode = (m, btn) => {
  // 計測中に切り替えると、それまでの計測が記録されずに黙って消えてしまう
  if (window.T.running) { showToast('計測中はモードを切り替えられません。先にストップしてください', 'warn'); return; }
  document.querySelectorAll('.tm-btn').forEach(b => b.classList.remove('on')); if (btn) btn.classList.add('on'); window.timerReset(); window.T.mode = m;
};
window.setCountdown = () => {
  // ストップウォッチのままセットすると、セットした時間がそのまま「学習した時間」として記録されてしまう
  if (window.T.running) { showToast('計測中はセットできません', 'warn'); return; }
  if (window.T.mode !== 'countdown') { showToast('「カウントダウン」モードに切り替えてからセットしてください', 'warn'); return; }
  const sec = ((parseInt(document.getElementById('cd-h').value) || 0) * 3600) + ((parseInt(document.getElementById('cd-m').value) || 0) * 60);
  if (sec <= 0) { showToast('時間を入力してください', 'warn'); return; }
  window.T.elapsed = sec; window.updateTimerDisp(window.T.elapsed); showToast('カウントダウンをセットしました！', 'info');
};
