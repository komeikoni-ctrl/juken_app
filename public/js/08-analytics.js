// 学習記録 編集・削除
window.openLogEdit = (id) => {
  const log = S.timerLogs.find(l => l.id === id); if (!log) return;
  document.getElementById('log-edit-id').value = id;
  document.getElementById('log-edit-subj').value = log.subj;
  document.getElementById('log-edit-min').value = log.min;
  const dateEl = document.getElementById('log-edit-date');
  if (dateEl) dateEl.value = log.date || DateManager.getTodayStr();
  showMo('mo-log-edit');
};
window.saveLogEdit = () => {
  const id = document.getElementById('log-edit-id').value;
  const newSubj = document.getElementById('log-edit-subj').value;
  const newMin = parseInt(document.getElementById('log-edit-min').value);
  const newDate = document.getElementById('log-edit-date')?.value || null;
  if (!id || !newSubj || isNaN(newMin) || newMin < 1) { showToast('正しい値を入力してください', 'warn'); return; }
  const log = S.timerLogs.find(l => l.id === id); if (!log) return;
  const oldSubj = log.subj, oldMin = log.min, oldDate = log.date || DateManager.getTodayStr();
  const dStr = newDate || oldDate;
  // 旧データを全集計から引き、新データを入れ直す（合計時間・科目別・曜日別・月別すべて）
  unrecordStudy(oldSubj, oldMin, oldDate);
  recordStudy(newSubj, newMin, dStr);
  log.subj = newSubj; log.min = newMin; log.date = dStr;
  DbService.set('timerLogs', log);
  closeMo('mo-log-edit');
  renderTimerLog(); initAllCharts(); renderHome();
  showToast('✅ 学習記録を更新しました');
};
window.deleteLogEntry = () => {
  const id = document.getElementById('log-edit-id').value;
  const log = S.timerLogs.find(l => l.id === id); if (!log) return;
  unrecordStudy(log.subj, log.min, log.date || DateManager.getTodayStr());
  Trash.push('timerLogs', log);
  DbService.del('timerLogs', id);
  S.timerLogs = S.timerLogs.filter(l => l.id !== id);
  closeMo('mo-log-edit');
  renderTimerLog(); initAllCharts(); renderHome();
  showToast('🗑️ 削除しました（ゴミ箱から30日以内に復元できます）', 'warn');
};

// ============================================================
// 🏅 累計学習時間のマイルストーン
// ============================================================
const MILESTONES = [
  { h: 10,   icon: '🌱', name: '10時間達成',   msg: 'スタートを切った！' },
  { h: 50,   icon: '🔥', name: '50時間達成',   msg: '習慣になってきた' },
  { h: 100,  icon: '💯', name: '100時間達成',  msg: 'ここからが本番' },
  { h: 300,  icon: '⚔️', name: '300時間達成',  msg: '受験生らしくなってきた' },
  { h: 500,  icon: '🏆', name: '500時間達成',  msg: '確実に力がついている' },
  { h: 800,  icon: '👑', name: '800時間達成',  msg: '相当な積み上げ' },
  { h: 1000, icon: '🌟', name: '1000時間達成', msg: '四桁の大台！' },
  { h: 1500, icon: '🚀', name: '1500時間達成', msg: '圧倒的な努力量' },
  { h: 2000, icon: '🗿', name: '2000時間達成', msg: 'もう誰にも文句は言わせない' },
];

// silent=true のときは通知を出さずに記録だけする。
// 機能追加前からの学習時間ぶんを、初回起動時にまとめてお祝いしてしまわないため。
const checkAchievements = (silent = false) => {
  if (!Array.isArray(S.unlockedAchs)) S.unlockedAchs = [];
  const hours = calcTotalMinutes() / 60;
  let newly = null;
  MILESTONES.forEach(m => {
    if (hours >= m.h && !S.unlockedAchs.includes(m.h)) { S.unlockedAchs.push(m.h); newly = m; }
  });
  if (!newly) return;
  DbService.setMainProfile();
  if (!silent) showToast(`${newly.icon} ${newly.name}！ ${newly.msg}`, 'success', 6000);
  renderMilestones();
};

const renderMilestones = () => {
  const el = document.getElementById('milestone-c');
  if (!el) return;
  const hours = calcTotalMinutes() / 60;
  const unlocked = MILESTONES.filter(m => hours >= m.h);
  const next = MILESTONES.find(m => hours < m.h);
  const pct = next ? Math.min(100, Math.round(hours / next.h * 100)) : 100;
  el.innerHTML = `
    <div style="font-size:13px;margin-bottom:8px">累計 <strong style="font-size:20px;color:var(--accent)">${hours.toFixed(1)}</strong> 時間</div>
    ${next ? `
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">次の目標：${next.icon} ${esc(next.name)}（あと ${(next.h - hours).toFixed(1)} 時間）</div>
      <div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden;border:1px solid var(--border)">
        <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .4s"></div>
      </div>`
    : '<div style="font-size:11px;color:var(--muted)">すべてのマイルストーンを達成しました🎉</div>'}
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
      ${MILESTONES.map(m => {
        const got = hours >= m.h;
        return `<span class="badge ${got ? 'bb' : ''}" title="${esc(m.msg)}" style="${got ? '' : 'opacity:.35'}">${m.icon} ${m.h}h</span>`;
      }).join('')}
    </div>`;
};
window.renderMilestones = renderMilestones;

// ============================================================
// 📈 前週比・前月比
// ============================================================
// 指定日から n 日前までの合計学習時間（分）
const sumMinutesBetween = (startStr, endStr) => {
  let total = 0;
  Object.keys(S.dailyLogs || {}).forEach(d => {
    if (d >= startStr && d <= endStr) total += (S.dailyLogs[d].total || 0);
  });
  return total;
};
const shiftDays = (dStr, n) => {
  const d = DateManager.parseSafe(dStr); d.setDate(d.getDate() + n);
  return DateManager.getTodayStr(d);
};

const renderComparison = () => {
  const el = document.getElementById('comparison-c');
  if (!el) return;
  const today = DateManager.getTodayStr();

  // 直近7日 vs その前の7日／直近30日 vs その前の30日
  const thisWeek = sumMinutesBetween(shiftDays(today, -6), today);
  const lastWeek = sumMinutesBetween(shiftDays(today, -13), shiftDays(today, -7));
  const thisMonth = sumMinutesBetween(shiftDays(today, -29), today);
  const lastMonth = sumMinutesBetween(shiftDays(today, -59), shiftDays(today, -30));

  const row = (label, cur, prev, subLabel) => {
    const diff = cur - prev;
    // 前期間が0のときに「∞%」を出しても意味がないので、その場合は割合を出さない
    const pct = prev > 0 ? Math.round(diff / prev * 100) : null;
    const up = diff >= 0;
    const color = up ? 'var(--accent)' : 'var(--a2)';
    const arrow = diff === 0 ? '→' : (up ? '▲' : '▼');
    return `<div class="row">
      <div style="flex:1">
        <div class="row-title">${label}</div>
        <div class="row-sub">${subLabel}：${DateManager.formatHours(prev)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:16px;font-weight:800">${DateManager.formatHours(cur)}</div>
        <div style="font-size:11px;font-weight:700;color:${color}">${arrow} ${DateManager.formatHours(Math.abs(diff))}${pct !== null ? `（${diff >= 0 ? '+' : ''}${pct}%）` : ''}</div>
      </div>
    </div>`;
  };

  el.innerHTML = row('直近7日', thisWeek, lastWeek, '前の7日')
               + row('直近30日', thisMonth, lastMonth, '前の30日');
};
window.renderComparison = renderComparison;

// ============================================================
// 🧹 科目名の統合
// 学習時間は studyTime / dailyLogs / timerLogs の3箇所に科目名で入る。
// 以前はカメラ解析だけ固定の科目リストを使っていたため、同じ勉強が
// 「英語」と「英文読解S」のように別名で積み上がってしまっていた。
// 新規記録は時間割の名前に統一済みなので、ここでは既存データを寄せる。
// ============================================================

// 同じ授業かどうかを判定するための比較用キー。
// 「数学YN 1」と「数学YN §1」、「世界史2（欧米編）」と「世界史Ⅱ（欧米編）」のように、
// 表記の違いだけで中身が同じものを同一視する。
// 漢字が違うもの（購読編/講読編など）は意味が変わる可能性があるので同一視しない。
const subjectNorm = (s) => String(s ?? '')
  .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ]/g, c => ROMAN_NUM[c])  // Ⅱ → 2
  .normalize('NFKC')                 // 全角英数字・全角括弧を半角に
  .toLowerCase()
  .replace(/[\s　§¶・･]/g, '');   // 空白と節記号は無視

// 学習時間が記録されている科目名を全て集める
const collectSubjectUsage = () => {
  const tt = getSubjectsFromTimetable();
  const ttSet = new Set(tt);
  const ttByNorm = new Map(tt.map(s => [subjectNorm(s), s]));
  const rows = {};
  const bump = (subj, min, where) => {
    if (!subj) return;
    if (!rows[subj]) rows[subj] = { subj, studyTime: 0, dailyLogs: 0, timerLogs: 0, logCount: 0, inTimetable: ttSet.has(subj), variantOf: null };
    rows[subj][where] += (+min || 0);
  };
  Object.entries(S.studyTime || {}).forEach(([s, m]) => bump(s, m, 'studyTime'));
  Object.values(S.dailyLogs || {}).forEach(l => Object.entries(l.subjects || {}).forEach(([s, m]) => bump(s, m, 'dailyLogs')));
  (S.timerLogs || []).forEach(l => { bump(l.subj, l.min || 0, 'timerLogs'); if (rows[l.subj]) rows[l.subj].logCount++; });

  Object.values(rows).forEach(r => {
    if (r.inTimetable) return;
    const hit = ttByNorm.get(subjectNorm(r.subj));
    if (hit && hit !== r.subj) r.variantOf = hit;   // 表記ゆれだけの違い
  });
  // 記録が1分もないものは出さない
  return Object.values(rows).filter(r => r.studyTime || r.dailyLogs || r.timerLogs);
};

// 📊 科目別の合計・総学習時間・曜日別・月別は、すべて日別ログ(dailyLogs)から導ける「計算結果」。
// これらを個別に足し引きしていると、記録の編集・削除・同期のたびに少しずつズレていく
// （実際、科目別合計と日別ログの合計が大きく食い違っていた）。
// 常に日別ログから作り直すことで、ズレが起きても次回の起動で自動的に直る。
const rebuildStudyTotals = ({ persist = true } = {}) => {
  const studyTime = {};
  const weekday = [0,0,0,0,0,0,0];
  const monthly = [0,0,0,0,0,0,0,0,0,0,0,0];
  let total = 0;

  Object.entries(S.dailyLogs || {}).forEach(([dKey, log]) => {
    const d = DateManager.parseSafe(dKey);
    Object.entries(log?.subjects || {}).forEach(([subj, min]) => {
      const m = +min || 0;
      if (!m) return;
      studyTime[subj] = (studyTime[subj] || 0) + m;
    });
    const t = +log?.total || 0;
    total += t;
    if (!isNaN(d)) { weekday[d.getDay()] += t; monthly[d.getMonth()] += t; }
  });

  const changed = JSON.stringify(S.studyTime) !== JSON.stringify(studyTime) || S.totalMinutes !== total;
  S.studyTime = studyTime;
  S.totalMinutes = total;
  S.weekdayTime = weekday;
  S.monthlyTime = monthly;
  // studyTime はキーを消す必要があるので、マージではなく丸ごと差し替える
  if (persist && changed) {
    DbService.replaceField('studyTime', studyTime);
    DbService.setMainProfile();
  }
  return { changed, total, subjectCount: Object.keys(studyTime).length };
};
window.rebuildStudyTotals = rebuildStudyTotals;

// from の学習時間を to に寄せる。
// 日別ログと個々の記録だけ書き換えれば、科目別合計は rebuildStudyTotals が作り直す。
const mergeSubject = (from, to) => {
  if (!from || !to || from === to) return 0;
  let moved = 0;

  Object.keys(S.dailyLogs || {}).forEach(dKey => {
    const subs = S.dailyLogs[dKey]?.subjects;
    if (!subs || subs[from] == null) return;
    moved += subs[from] || 0;
    subs[to] = (subs[to] || 0) + subs[from];
    delete subs[from];
    DbService.setDailyLog(dKey);
  });
  (S.timerLogs || []).forEach(l => {
    if (l.subj !== from) return;
    l.subj = to;
    DbService.set('timerLogs', l);
  });
  rebuildStudyTotals();
  return moved;
};

// 表記ゆれ（全角半角など）だけの違いは、意味が同じなので確認なしで寄せる
const autoFixSubjectVariants = () => {
  const variants = collectSubjectUsage().filter(r => r.variantOf);
  variants.forEach(r => mergeSubject(r.subj, r.variantOf));
  return variants.map(r => `${r.subj} → ${r.variantOf}`);
};

window.renderSubjectMerge = () => {
  const el = document.getElementById('subject-merge-c');
  if (!el) return;
  const rows = collectSubjectUsage();
  const tt = getSubjectsFromTimetable();
  const stray = rows.filter(r => !r.inTimetable);
  const fmt = (r) => DateManager.formatHours(Math.max(r.dailyLogs, r.studyTime, r.timerLogs));

  if (!stray.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted)">✅ 学習記録の科目名はすべて時間割と一致しています</div>';
    return;
  }
  el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:10px">
      時間割にない科目名で ${stray.length} 件の記録があります。同じ授業のものは下で統合できます（統合しても合計学習時間は変わりません）。
    </div>`
    + stray.map((r, i) => `
      <div class="row" style="align-items:flex-start;flex-wrap:wrap;gap:6px">
        <div style="flex:1;min-width:140px">
          <div class="row-title">${esc(r.subj)}</div>
          <div class="row-sub">${fmt(r)}${r.logCount ? ` ／ 記録${r.logCount}件` : ''}${r.variantOf ? ' ／ 表記ゆれの可能性' : ''}</div>
        </div>
        <select id="merge-to-${i}" style="flex:1;min-width:150px;margin:0">
          <option value="">統合しない（このまま）</option>
          ${tt.map(s => `<option value="${esc(s)}"${r.variantOf === s ? ' selected' : ''}>${esc(s)} に統合</option>`).join('')}
        </select>
        <button class="btn btn-s btn-sm" onclick="applySubjectMerge(${i})">実行</button>
      </div>`).join('');
};

// 科目名は onclick に埋め込まず、番号だけ渡してここで引き直す
// （科目名に ' が入っているとボタンが壊れ、細工された名前ならスクリプトとして実行されてしまうため）
window.applySubjectMerge = (idx) => {
  const from = collectSubjectUsage().filter(r => !r.inTimetable)[idx]?.subj;
  if (!from) return;
  const to = document.getElementById('merge-to-' + idx)?.value || '';
  if (!to) { showToast('統合先の科目を選んでください', 'warn'); return; }
  showConfirm('🧹 科目を統合', `「${from}」の学習記録をすべて「${to}」に移します。合計学習時間は変わりません。よろしいですか？`, '統合する', () => {
    const moved = mergeSubject(from, to);
    window.renderSubjectMerge();
    initAllCharts(); renderHome(); renderTimerLog();
    showToast(`✅「${from}」を「${to}」に統合しました${moved ? '（' + DateManager.formatHours(moved) + '）' : ''}`);
  });
};

const getWeekRange = (dStr) => {
  const d = DateManager.parseSafe(dStr); const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d.setDate(diff)); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
  return { start, end, label: `${start.getMonth()+1}/${start.getDate()}〜${end.getMonth()+1}/${end.getDate()}` };
};

const initDailyChart = () => { const el=document.getElementById('chart-daily'); if(!el||!el.offsetParent)return; dc('daily'); const range = parseInt(document.getElementById('daily-range').value) || 0; let dts = Object.keys(S.dailyLogs).sort(); if (range > 0) dts = dts.slice(-range); charts.daily=new Chart(el,{type:'bar',data:{labels:dts.map(d=>d.slice(5)),datasets:[{label:'学習時間',data:dts.map(d=>S.dailyLogs[d].total),backgroundColor:'#1d4ed8'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:(v)=>DateManager.formatHours(v)}}},plugins:{tooltip:{callbacks:{label:(ctx)=>DateManager.formatHours(ctx.raw)}}}}}); };
window.initDailyChart = initDailyChart;

const initWeeklyChart = () => { const el=document.getElementById('chart-weekly'); if(!el||!el.offsetParent)return; dc('weekly'); const weeks = []; const today = new Date(); for(let i=11; i>=0; i--) { const d = new Date(today); d.setDate(today.getDate() - i*7); const w = getWeekRange(DateManager.getTodayStr(d)); weeks.push({ ...w, total:0 }); } Object.keys(S.dailyLogs).forEach(ds => { const d = DateManager.parseSafe(ds); for(let w of weeks) { if(d >= w.start && d <= w.end) { w.total += S.dailyLogs[ds].total; break; } } }); charts.weekly = new Chart(el,{type:'bar',data:{labels:weeks.map(w=>w.label),datasets:[{label:'学習時間',data:weeks.map(w=>w.total),backgroundColor:'#16a05a'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:(v)=>DateManager.formatHours(v)}}},plugins:{tooltip:{callbacks:{label:(ctx)=>DateManager.formatHours(ctx.raw)}}}}}); };
const initMoChart = () => { const el=document.getElementById('chart-mo'); if(!el||!el.offsetParent)return; dc('mo'); const mLabels = []; const mData = []; const today = new Date(); for(let i=11; i>=0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); mLabels.push(`${d.getMonth()+1}月`); let total = 0; Object.keys(S.dailyLogs).forEach(ds => { const lgD = DateManager.parseSafe(ds); if(lgD.getFullYear() === d.getFullYear() && lgD.getMonth() === d.getMonth()) total += S.dailyLogs[ds].total; }); mData.push(total); } charts.mo=new Chart(el,{type:'bar',data:{labels:mLabels,datasets:[{label:'学習時間',data:mData,backgroundColor:'#dc4f1e'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:(v)=>DateManager.formatHours(v)}}},plugins:{tooltip:{callbacks:{label:(ctx)=>DateManager.formatHours(ctx.raw)}}}}}); };

const initDailyPieChart = () => { const el=document.getElementById('chart-pie-daily'); if(!el)return; dc('p1'); const wrap=document.getElementById('pie-daily-wrap'), emptyEl=document.getElementById('pie-daily-empty'), dStr = document.getElementById('pie-daily-date')?.value || DateManager.getTodayStr(), lg=S.dailyLogs[dStr], tEl = document.getElementById('pie-daily-total'); if(lg && lg.total > 0 && lg.subjects && Object.keys(lg.subjects).length > 0) { if(tEl) tEl.textContent = `合計: ${DateManager.formatHours(lg.total)}`; if(wrap) wrap.style.display='block'; if(emptyEl) emptyEl.style.display='none'; charts.p1=new Chart(el,{type:'doughnut',data:{labels:Object.keys(lg.subjects),datasets:[{data:Object.values(lg.subjects)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'},tooltip:{callbacks:{label:(ctx)=>ctx.label+': '+DateManager.formatHours(ctx.raw)}}}}}); } else { if(tEl) tEl.textContent = ''; if(wrap) wrap.style.display='none'; if(emptyEl) emptyEl.style.display='block'; } };
window.initDailyPieChart = initDailyPieChart;

const setupWeeklySelect = () => { const sel = document.getElementById('pie-weekly-week'); if(!sel) return; let html = ''; const today = new Date(); for(let i=0; i<12; i++) { const d = new Date(today); d.setDate(today.getDate() - i*7); const w = getWeekRange(DateManager.getTodayStr(d)); const val = DateManager.getTodayStr(w.start); html += `<option value="${val}" ${sel.value === val?'selected':''}>${i===0?'今週: ':''}${esc(w.label)}</option>`; } const oldVal = sel.value; sel.innerHTML = html; if (oldVal && Array.from(sel.options).some(o=>o.value===oldVal)) sel.value = oldVal; };
const initWeeklyPieChart = () => { setupWeeklySelect(); const el=document.getElementById('chart-pie-weekly'); if(!el)return; dc('pW'); const wrap=document.getElementById('pie-weekly-wrap'), emptyEl=document.getElementById('pie-weekly-empty'), startStr = document.getElementById('pie-weekly-week')?.value; if(!startStr) return; const start = DateManager.parseSafe(startStr); const end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999); const subjs = {}; let total = 0; Object.keys(S.dailyLogs).forEach(ds => { const d = DateManager.parseSafe(ds); if(d >= start && d <= end) { const lg = S.dailyLogs[ds]; const sj = lg?.subjects || {}; Object.keys(sj).forEach(s => { subjs[s] = (subjs[s]||0) + (Number(sj[s])||0); total += (Number(sj[s])||0); }); } }); const tEl = document.getElementById('pie-weekly-total'); if(tEl) tEl.textContent = total>0 ? `合計: ${DateManager.formatHours(total)}` : ''; if(total > 0) { if(wrap) wrap.style.display='block'; if(emptyEl) emptyEl.style.display='none'; charts.pW = new Chart(el,{type:'doughnut',data:{labels:Object.keys(subjs),datasets:[{data:Object.values(subjs)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'},tooltip:{callbacks:{label:(ctx)=>ctx.label+': '+DateManager.formatHours(ctx.raw)}}}}}); } else { if(wrap) wrap.style.display='none'; if(emptyEl) emptyEl.style.display='block'; } };
window.initWeeklyPieChart = initWeeklyPieChart;

const initMonthlyPieChart = () => { const sel = document.getElementById('pie-monthly-month'); if(sel && !sel.dataset.init) { sel.value = new Date().getMonth() + 1; sel.dataset.init = "true"; } const el=document.getElementById('chart-pie-monthly'); if(!el)return; dc('p2'); const wrap=document.getElementById('pie-monthly-wrap'), emptyEl=document.getElementById('pie-monthly-empty'), mStr = document.getElementById('pie-monthly-month')?.value; if(!mStr) return; const monthTarget = parseInt(mStr); const subjs = {}; let total = 0; const today = new Date(); const oneYearAgo = new Date(today.getFullYear()-1, today.getMonth()+1, 1); /* 直近12か月。+1 しないと今月と去年の同じ月が合算される */ Object.keys(S.dailyLogs).forEach(ds => { const d = DateManager.parseSafe(ds); if (d >= oneYearAgo && (d.getMonth()+1) === monthTarget) { const lg = S.dailyLogs[ds]; const sj = lg?.subjects || {}; Object.keys(sj).forEach(s => { subjs[s] = (subjs[s]||0) + (Number(sj[s])||0); total += (Number(sj[s])||0); }); } }); const tEl = document.getElementById('pie-monthly-total'); if(tEl) tEl.textContent = total>0 ? `合計: ${DateManager.formatHours(total)}` : ''; if(total > 0) { if(wrap) wrap.style.display='block'; if(emptyEl) emptyEl.style.display='none'; charts.p2 = new Chart(el,{type:'doughnut',data:{labels:Object.keys(subjs),datasets:[{data:Object.values(subjs)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'},tooltip:{callbacks:{label:(ctx)=>ctx.label+': '+DateManager.formatHours(ctx.raw)}}}}}); } else { if(wrap) wrap.style.display='none'; if(emptyEl) emptyEl.style.display='block'; } };
window.initMonthlyPieChart = initMonthlyPieChart;

const initDevChart = () => { const el=document.getElementById('chart-dev'); if(!el||!el.offsetParent)return; dc('dev'); if(!S.mocks.length)return; charts.dev=new Chart(el,{type:'line',data:{labels:S.mocks.map(m=>m.date.slice(5)),datasets:[{label:'総合',data:S.mocks.map(m=>m.total),borderColor:'#1d4ed8'}]},options:{responsive:true,maintainAspectRatio:false}}); };
const initRankChart = () => { const el=document.getElementById('chart-rank'); if(!el||!el.offsetParent)return; dc('rank'); if(!S.mocks.length)return; charts.rank=new Chart(el,{type:'line',data:{labels:S.mocks.map(m=>m.date.slice(5)),datasets:[{label:'順位',data:S.mocks.map(m=>m.rank),borderColor:'#6030b8'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{reverse:true}}}}); };

// 模試 実得点グラフ
const initMockScoreChart = () => {
  const el = document.getElementById('chart-mock-score');
  if (!el || !el.offsetParent) return;
  dc('msc');
  if (!S.mocks.length) return;
  const labels = S.mocks.map(m => m.date.slice(5));
  const scoreFields = [
    { key: 'enScore', label: '英語', color: '#1d4ed8' },
    { key: 'jpScore', label: '国語', color: '#dc4f1e' },
    { key: 'maScore', label: '数学', color: '#16a05a' },
    { key: 'hiScore', label: '世界史', color: '#c07010' },
    { key: 'peScore', label: '政治経済', color: '#6030b8' },
  ];
  const datasets = scoreFields
    .filter(f => S.mocks.some(m => m[f.key] != null && m[f.key] > 0))
    .map(f => ({
      label: f.label,
      data: S.mocks.map(m => m[f.key] || null),
      borderColor: f.color,
      backgroundColor: f.color + '22',
      tension: 0.3,
      spanGaps: true,
      pointRadius: 4,
    }));
  if (!datasets.length) {
    // フォールバック：偏差値→得点率に変換（模試記録に実点数がない場合の補助表示）
    datasets.push({
      label: '総合偏差値',
      data: S.mocks.map(m => m.total || null),
      borderColor: '#1d4ed8',
      tension: 0.3,
      spanGaps: true,
    });
  }
  charts.msc = new Chart(el, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { title: { display: true, text: '得点' } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { mode: 'index', intersect: false } },
      interaction: { mode: 'index', intersect: false }
    }
  });
};
window.initMockScoreChart = initMockScoreChart;
const initRadarChart = () => {
  const el = document.getElementById('chart-radar');
  if (!el || !el.offsetParent) return;
  dc('rd');
  if (!S.mocks.length) return;
  const latest = S.mocks.slice(-1)[0];
  const datasets = [{
    label: `最新 (${latest.date.slice(5)})`,
    data: [latest.en, latest.jp, latest.ma, latest.hi, latest.total],
    borderColor: '#1d4ed8', backgroundColor: 'rgba(29,78,216,0.1)', pointBackgroundColor: '#1d4ed8'
  }];
  // ⑫ 前回データがあれば重ね書き
  if (S.mocks.length >= 2) {
    const prev = S.mocks.slice(-2)[0];
    datasets.push({
      label: `前回 (${prev.date.slice(5)})`,
      data: [prev.en, prev.jp, prev.ma, prev.hi, prev.total],
      borderColor: '#dc4f1e', backgroundColor: 'rgba(220,79,30,0.08)',
      pointBackgroundColor: '#dc4f1e', borderDash: [4, 3]
    });
  }
  charts.rd = new Chart(el, {
    type: 'radar',
    data: { labels: ['英語', '国語', '数学', '世界史', '総合'], datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { r: { suggestedMin: 30, suggestedMax: 80, ticks: { stepSize: 10 } } },
      plugins: { legend: { position: 'bottom' } }
    }
  });
};
const initAccChart = () => { const el=document.getElementById('chart-acc'); if(!el||!el.offsetParent)return; dc('ac'); if(!S.mocks.length)return; const m=S.mocks.slice(-1)[0]; charts.ac=new Chart(el,{type:'bar',data:{labels:['英','国','数','世','政'],datasets:[{data:[m.en,m.jp,m.ma,m.hi,m.pe],backgroundColor:'#16a05a'}]},options:{responsive:true,maintainAspectRatio:false}}); };
const initProbChart = () => { const el=document.getElementById('prob-chart'); if(!el||!el.offsetParent||!S.unis.length)return; dc('pr'); const colors = ['#1d4ed8','#dc4f1e','#16a05a','#c07010','#6030b8']; charts.pr=new Chart(el,{type:'line',data:{labels:S.mocks.map(m=>m.date.slice(5)),datasets:S.unis.map((u,i)=>({label:u.name,data:S.mocks.map(m=>u.prob||50),borderColor:colors[i%colors.length]}))},options:{responsive:true,maintainAspectRatio:false}}); };
window.openTTModal = (d, p) => {
  document.getElementById('tt-day').value = d || '月';
  document.getElementById('tt-period').value = p || '1限';
  // 既に登録済みの科目名を入力候補として出す（同じ授業を打ち直すときのタイプミス防止）
  const dl = document.getElementById('tt-subj-options');
  if (dl) dl.innerHTML = getTimetableSubjects().map(s => `<option value="${esc(s)}">`).join('');
  const title = document.querySelector('#mo-tt .mo-title');
  if (title) title.textContent = (d && p) ? `📚 ${d}曜 ${p} の授業` : '📚 授業を登録・編集';
  let data = d && p ? S.timetable[d]?.[p] : null;
  if (data) {
    if (typeof data === 'string') {
      document.getElementById('tt-subj').value = data; document.getElementById('tt-room').value = ''; document.getElementById('tt-teacher').value = '';
    } else {
      document.getElementById('tt-subj').value = data.subj || ''; document.getElementById('tt-room').value = data.room || ''; document.getElementById('tt-teacher').value = data.teacher || '';
    }
    document.getElementById('btn-del-tt').style.display = 'block';
  } else {
    document.getElementById('tt-subj').value = ''; document.getElementById('tt-room').value = ''; document.getElementById('tt-teacher').value = '';
    document.getElementById('btn-del-tt').style.display = 'none';
  }
  showMo('mo-tt');
};

const renderTT = () => { 
  const el = document.getElementById('tt-wrap'); if(!el)return; 
  const pTimes = {'1限':'9:10<br>~<br>10:00','2限':'10:10<br>~<br>11:00','3限':'11:10<br>~<br>12:00','4限':'12:10<br>~<br>13:00','5限':'13:40<br>~<br>14:30','6限':'14:40<br>~<br>15:30','7限':'15:40<br>~<br>16:30','8限':'16:40<br>~<br>17:30','9限':'17:40<br>~<br>18:30','10限':'18:40<br>~<br>19:30'};
  let h = `<table class="tt-table" style="table-layout:fixed; width:100%;"><tr><th style="width:44px"></th>${['月','火','水','木','金'].map(d=>`<th>${d}</th>`).join('')}</tr>`; 
  ['1限','2限','3限','4限','5限','6限','7限','8限','9限','10限'].forEach(p=>{ 
    h += `<tr><th style="vertical-align:middle; line-height:1.2;">${p}<br><span style="font-size:9px; color:var(--muted); font-weight:normal; display:inline-block; margin-top:2px;">${pTimes[p]}</span></th>`;
    ['月','火','水','木','金'].forEach(d=>{ 
      let cellData = S.timetable[d]?.[p];
      let subj='', room='', teacher='';
      if (cellData) {
        if (typeof cellData === 'string') { subj = cellData; }
        else { subj = cellData.subj||''; room = cellData.room||''; teacher = cellData.teacher||''; }
      }
      let innerHtml = '';
      if (subj || room || teacher) {
        innerHtml = `<div style="background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:4px 2px; box-shadow:0 1px 2px rgba(0,0,0,0.05); cursor:pointer; transition:transform 0.1s;" onclick="openTTModal('${d}','${p}')" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">`;
        if(subj) innerHtml += `<div style="font-size:11px; font-weight:800; color:var(--accent); line-height:1.2; margin-bottom:3px; word-break:break-all;">${esc(subj)}</div>`;
        if(teacher) innerHtml += `<div style="color:var(--text); font-size:9px; font-weight:600; line-height:1.1; margin-bottom:2px">👨‍🏫 ${esc(teacher)}</div>`;
        if(room) innerHtml += `<div style="color:var(--muted); font-size:9px; font-weight:600; line-height:1.1">🚪 ${esc(room)}</div>`;
        innerHtml += `</div>`;
      } else {
        // 空きコマもタップで登録できることが分かるように「＋」を薄く出す
        innerHtml = `<div class="tt-empty" title="タップして授業を追加" onclick="openTTModal('${d}','${p}')">＋</div>`;
      }
      h += `<td style="border:1px solid var(--border); padding:2px; text-align:center; vertical-align:middle; height:54px;">${innerHtml}</td>`; 
    }); 
    h += '</tr>'; 
  }); 
  h += '</table>'; 
  el.innerHTML=h; 
};

