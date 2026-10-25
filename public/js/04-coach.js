// ============================================================
// UI LOGIC & GLOBAL EXPORTS (DO NOT DELETE EXISTING FUNCTIONS)
// ============================================================

// ノートのキーワードを必ず配列として取り出す。
// 古い保存データや同期の途中で配列以外（文字列など）が入っていることがあり、
// そのまま .map すると例外になってノート一覧全体が表示できなくなる。
const noteKeywords = (n) => {
  const k = n && n.keywords;
  if (Array.isArray(k)) return k;
  if (typeof k === 'string' && k.trim()) return k.split(/[,、\s]+/).filter(Boolean);
  return [];
};

const refreshAllViews = () => {
  deduplicateTasks(); // 常に重複除去してからレンダリング
  const activeId = document.querySelector('.page.active')?.id;
  const isTyping = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

  if (activeId !== 'page-settings' || !isTyping) renderSettings();
  renderHome(); renderCal(); renderWeek(); renderHeatmaps(); renderScoreTargetSettings();
  renderUniList(); renderTT(); renderHwList(); renderNotes(); renderRepeatList(); refreshSubjectSelects();
  if (activeId !== 'page-aicoach' || !isTyping) renderChat();
  renderCoachHistory(); renderMockCalList(); renderMockRecTbl(); renderSpList(); renderExtraList(); renderTimerLog();
  populateSubjectSelects();
  if (typeof window.renderApplications === 'function') window.renderApplications();
  if (typeof window.renderPrivSim === 'function') window.renderPrivSim();
  if (typeof window.renderPastExams === 'function') window.renderPastExams();
  if (typeof renderMilestones === 'function') renderMilestones();
  if (typeof renderComparison === 'function') renderComparison();
  
  if (activeId === 'page-analytics') { initAllCharts(); }
  
  const el = document.getElementById('daily-coach-c'); 
  if (el && (activeId !== 'page-aicoach' || !isTyping)) {
     const todayStr = DateManager.getTodayStr();
     if (S.aiCoachLog.lastEvalDate === todayStr && S.aiCoachLog.dailyEvalHtml) {
         el.innerHTML = S.aiCoachLog.dailyEvalHtml;
     } else {
         el.innerHTML = '<div class="empty"><div class="empty-icon">📝</div><div class="empty-text">学習時間やタスクを記録してから評価ボタンを押してください</div></div>';
     }
  }
};

// コーチ系AI（今日の評価・朝のプラン・週次レポート）共通の人格。
// 生徒のデータだけで完結させず、根拠になる外部情報は実際に検索させる
const COACH_RESEARCH_SYS = 'あなたは受験生の専属塾講師AIです。渡された生徒の全データを読み込んだうえで、'
  + '助言の根拠になる外部情報（志望校の入試日程・配点・出題傾向、模試の日程と出題範囲、参考書や勉強法の評価など）はGoogle検索ツールで実際に調べて確認してください。'
  + '記憶だけに頼らず、調べた内容はどこの情報かが分かるように触れてください。回答は日本語で、具体的に。';

// AIに渡す「アプリ内の全データ」。scale は明細の件数を絞る係数（1=全部、0.5=半分）
// アプリ内の全データを2つに分けて作る。
//   stable   … 滅多に変わらない情報（時間割・志望校・模試・学習履歴・ノート…）
//   volatile … 毎回変わる情報（今日の日付・今日の学習時間・今のタスク…）
// Gemini はプロンプトの「先頭が前回と同じ」ときに入力トークンを割り引く（暗黙キャッシュ）。
// 変動する値が先頭にあると毎回ミスするので、必ず stable → volatile の順に並べること。
const buildContextParts = (scale = 1) => {
  const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
  const todayObj = new Date();
  const dowStr = ['日','月','火','水','木','金','土'][todayObj.getDay()];
  const kd = DateManager.daysBetween('2027-01-16'), nd = DateManager.daysBetween(S.nijiDate || '2027-02-25');
  const userInfo = `名前:${S.userName||'未設定'}, 学年:${S.userGrade||'高校3年'}, 二次試験:${S.nijiDate}(残り${nd}日), 共通テスト残り${kd}日, 今日は${DateManager.getTodayStr()}(${dowStr}曜)`;
  
  const studyStats = `総学習:${DateManager.formatHours(calcTotalMinutes())}, 今日:${DateManager.formatHours(getTodayMinutes())}, 継続:${calcStreak()}日`;
  const targets = Object.keys(S.scoreTargets).map(k => `${k}(目標${S.scoreTargets[k].target}/現在${S.scoreTargets[k].current})`).join(', ');
  const prioLabel = {high:'🔴高', mid:'🟡中', low:'🟢低'};
  const doneTasks = S.tasks.filter(t=>t.done).map(t=>t.text).join('、') || 'なし';
  const leftTasks = S.tasks.filter(t=>!t.done).map(t => {
    const parts = [t.text];
    if (t.prio && t.prio !== 'mid') parts.push(`優先度:${prioLabel[t.prio]||t.prio}`);
    if (t.due) { const d = DateManager.daysBetween(t.due); parts.push(`締切:${t.due}(あと${d}日)`); }
    if (t.subj) parts.push(`科目:${t.subj}`);
    return parts.join(' ');
  }).join('、') || 'なし';
  const todayStr = DateManager.getTodayStr();
  const todayTimerLogs = S.timerLogs.filter(l => l.date === todayStr).map(l=>`[${l.time}] ${l.subj}:${l.min}分`).join(', ') || 'なし';
  const sabotage = `サボり検知累計:${S.sabotageCount}回`;
  // 実際は60日前なので名前もそれに合わせる
  const sixtyDaysAgo = new Date(); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const sixtyDaysAgoStr = DateManager.getTodayStr(sixtyDaysAgo);
  const recentEvents = S.events.filter(e => e.date >= sixtyDaysAgoStr).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(e => `[${e.date}${e.time ? ' ' + e.time : ''}] ${e.title}(${e.type})`).join(', ') || 'なし';
  const recentEvals = (S.aiCoachLog.history || []).slice(0, 14 * scale).map(h => `[${h.date}] ランク${h.rank}: ${h.comment}`).join(' | ') || 'なし';
  const currentSim = calcSimScores();
  const v = id => +(document.getElementById(id)?.value||0);
  const simScores = `英語${v('s-en')}, 国語${v('s-jp')}, 数学${v('s-ma')}, 世界史${v('s-hi')}, 政経${v('s-pe')}, 化学基礎${v('s-ch')}, 生物基礎${v('s-bi')}, 情報${v('s-in')} (合計${currentSim.total}/${currentSim.max}点, ${currentSim.pct}%)`;
  const unis = S.unis.map(u => `${u.name}(${u.dep}, ${u.type}): 合格可能性${u.prob||'-'}%, ${u.aiInfo||'AI検索情報なし'}${u.borderFetchedAt ? '（' + u.borderFetchedAt + '取得）' : ''}`).join('\n') || 'なし';
  const scoringInfo = S.cachedScoring ? stripHtml(S.cachedScoring).replace(/\n/g, ' ') : "なし";
  const trendInfo = S.cachedTrend ? stripHtml(S.cachedTrend).replace(/\n/g, ' ') : "なし";
  const dailyLogKeys = Object.keys(S.dailyLogs).sort();
  // 今日の分は volatile 側（【今日の学習】）に入れる。ここに混ぜると
  // 勉強するたびに stable が変わってしまい、キャッシュが効かなくなる
  const recentDailyLogs = dailyLogKeys.slice(-60 * scale).filter(d => d !== todayStr).map(d => {
    const lg = S.dailyLogs[d] || {};
    const subjects = lg.subjects || {};
    return `[${d}] 計${lg.total || 0}分(${Object.keys(subjects).map(s => `${s}:${subjects[s]}分`).join(',')})`;
  }).join('\n') || 'なし';
  const recentMocks = [...S.mocks].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).slice(-40 * scale).map(m => {
    const typeLabel = m.type === 'kijutsu' ? '記述' : '共通';
    const scores = m.type === 'kijutsu'
      ? `英${m.en} 国${m.jp} 数${m.ma} 総合偏差値${m.total}`
      : `英${m.en} 国${m.jp} 数${m.ma} 世${m.hi} 政${m.pe} 総合偏差値${m.total}`;
    const realScores = m.type === 'kijutsu'
      ? (m.enScore!=null?` 英実点${m.enScore}`:'') + (m.jpScore!=null?` 国実点${m.jpScore}`:'') + (m.maScore!=null?` 数実点${m.maScore}`:'')
      : (m.enScore!=null?` 英実点${m.enScore}`:'') + (m.jpScore!=null?` 国実点${m.jpScore}`:'') + (m.ma1Score!=null?` 数1A${m.ma1Score}`:'') + (m.ma2Score!=null?` 数2B${m.ma2Score}`:'');
    return `[${m.date}][${typeLabel}] ${m.name}: ${scores}, 順位${m.rank}${realScores}`;
  }).join('\n') || 'なし';
  const getHmStr = (subj) => S.heatmapData[subj].topics.map((t,i) => `${t}(Lv${S.heatmapData[subj].levels[i]})`).join(', ');
  const heatmapDetails = `数学: ${getHmStr('math')}\n英語: ${getHmStr('eng')}\n世界史: ${getHmStr('history')}`;
  // 直近5件は本文まで、それ以降は要約まで（全ノートをAIが把握できるようにする）
  const recentNotes = S.notes.slice(0, 40 * scale).map((n, i) => `[${n.date}] ${n.subject || 'その他'} / タイトル:${n.title}, 要約:${n.summary}, キーワード:${noteKeywords(n).join(',')}${i < 5 ? ', 本文:' + clip(n.text, 600) : ''}`).join('\n') || 'なし';
  
  // 💡 ここでAIに教えるための正確な時間割を作成
  const pTimesMap = {'1限':'9:10-10:00','2限':'10:10-11:00','3限':'11:10-12:00','4限':'12:10-13:00','5限':'13:40-14:30','6限':'14:40-15:30','7限':'15:40-16:30','8限':'16:40-17:30','9限':'17:40-18:30','10限':'18:40-19:30'};
  const allTimetable = Object.keys(S.timetable).map(day => {
    const classes = Object.keys(S.timetable[day]).map(p => {
      const c = S.timetable[day][p];
      const subj = typeof c === 'string' ? c : (c?.subj || '');
      const time = pTimesMap[p] || '';
      const extra = (c && typeof c === 'object') ? [c.teacher, c.room].filter(Boolean).join('・') : '';
      return `${p}(${time}) ${subj}${extra ? '〔' + extra + '〕' : ''}`;
    }).join(', ');
    return `${day}曜: [${classes}]`;
  }).join(' | ') || 'なし';
  
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = DateManager.getTodayStr(sevenDaysAgo);
  const hwPrioLabel = {high:'🔴高', mid:'🟡中', low:'🟢低'};
  const recentHomework = S.homework.filter(h => !h.done || (h.due && h.due >= sevenDaysAgoStr)).map(h => {
    const p = hwPrioLabel[h.priority||h.prio||'mid'] || '🟡中';
    return `${h.subj}:${h.cont}(期日${h.due||'なし'}, 優先度${p}, ${h.done?'完了':'未完了'})`;
  }).join('\n') || 'なし';
  const mockSched = S.mockSchedule.map(m => `[${m.date}] ${m.name}`).join(', ') || 'なし';
  const specials = S.specials.map(s => `${s.name}(${s.start}〜${s.end}, ${s.status})`).join(', ') || 'なし';
  const recentExtras = S.extras.slice(-30 * scale).map(e => `[${e.date}] ${e.title}: ${e.note}`).join('\n') || 'なし';

  // 📮 出願（日程・受験料・会場・書類の進み具合まで全部）
  const applications = (S.applications || []).map(a => {
    const docs = Array.isArray(a.docs) ? a.docs : [];
    const left = (typeof appBlankFields === 'function') ? appBlankFields(a).map(f => f.short) : [];
    return `${a.name} ${a.dep || ''}（${a.methodLabel || a.method}）: 出願${a.applyStart || '?'}〜${a.applyEnd || '?'}${a.applyNote ? '(' + a.applyNote + ')' : ''}, 受験日${a.examDate || '?'}${a.examDateEnd ? '〜' + a.examDateEnd : ''}${a.examTime ? ' ' + a.examTime : ''}, `
      + `発表${a.resultDate || '?'}, 手続締切${a.procedureDeadline || '?'}, 受験料${a.fee || '?'}円(${a.feePaid ? '支払済' : '未払'}), 入学金${a.enrollFee || '?'}円, 会場:${a.venue || '?'}, 科目:${a.subjects || '?'}, `
      + `書類${docs.filter(d => d.done).length}/${docs.length}完了(未:${docs.filter(d => !d.done).map(d => d.label).join('・') || 'なし'})${a.memo ? ', メモ:' + a.memo : ''}`
      + `${(a.aiFields || []).length ? ', ※AI入力で未確認の項目あり' : ''}${left.length ? ', 未入力:' + left.join('・') : ''}`;
  }).join('\n') || 'なし';
  const conflicts = (typeof groupDateConflicts === 'function') ? groupDateConflicts().map(c => `${c.date}${c.to !== c.date ? '〜' + c.to : ''}:${c.items.map(i => i.name + (i.dep ? ' ' + String(i.dep).split(/\s+/)[0] : '')).join('と')}が${c.soft ? '試験期間の重なり（受験日を選べる方式なら別日で両方受験可）' : '重複（どちらかしか受けられない）'}`).join(', ') : '';

  // 過去の学習記録：直近は日別、それより前は月別の合計に畳む（全期間をAIが見られるように）
  const olderKeys = dailyLogKeys.slice(0, Math.max(0, dailyLogKeys.length - 60 * scale));
  const monthly = {};
  olderKeys.forEach(d => { const m = d.slice(0, 7); monthly[m] = (monthly[m] || 0) + (S.dailyLogs[d]?.total || 0); });
  const olderMonthly = Object.keys(monthly).sort().map(m => `${m}:${DateManager.formatHours(monthly[m])}`).join(', ') || 'なし';
  const subjTotals = Object.keys(S.studyTime || {}).filter(k => S.studyTime[k] > 0).sort((a, b) => S.studyTime[b] - S.studyTime[a]).map(k => `${k}:${DateManager.formatHours(S.studyTime[k])}`).join(', ') || 'なし';
  const dowNames = ['日','月','火','水','木','金','土'];
  const weekdayTotals = (S.weekdayTime || []).map((m, i) => `${dowNames[i]}:${DateManager.formatHours(m)}`).join(', ');

  // 直近2週間のタイマー記録（いつ・何を・何分）
  const fourteenAgo = new Date(); fourteenAgo.setDate(fourteenAgo.getDate() - 14);
  const fourteenAgoStr = DateManager.getTodayStr(fourteenAgo);
  const recentTimerLogs = S.timerLogs.filter(l => l.date >= fourteenAgoStr && l.date !== todayStr)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(l => `[${l.date}${l.time ? ' ' + l.time : ''}] ${l.subj}:${l.min}分`).join(', ') || 'なし';

  const repeats = (S.repeatEvents || []).map(r => `毎週${r.dow}曜${r.time ? ' ' + r.time : ''} ${r.title}`).join(', ') || 'なし';
  const olderNotes = S.notes.slice(40 * scale, 200).map(n => `[${n.date}] ${n.title}(${n.subject || 'その他'})`).join(', ');
  const weeklyRep = S.aiCoachLog.weeklyRepHtml ? clip(stripHtml(S.aiCoachLog.weeklyRepHtml).replace(/\s+/g, ' '), 600) : 'なし';
  const morning = (S.morningPlan?.date === todayStr && Array.isArray(S.morningPlan.tasks))
    ? S.morningPlan.tasks.map(t => `${t.t}(${t.min}分)`).join('、') : 'なし';

  // いま開いていない他のチャットの内容（相談の経緯をAIが追えるように）
  const LEGACY_DEFAULT_ID = 'th_default';
  const otherThreads = (S.chatThreads || []).filter(t => t.id !== window.currentChatThreadId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5 * scale)
    .map(t => {
      const msgs = (S.chatHistory || []).filter(m => (m.threadId || LEGACY_DEFAULT_ID) === t.id && !String(m.text || '').startsWith('エラー: ')).slice(-6);
      return msgs.length ? `《${t.title}》` + msgs.map(m => `${m.role === 'ai' ? 'AI' : '生徒'}:${clip(String(m.text || m.displayText || '').replace(/\s+/g, ' '), 150)}`).join(' / ') : '';
    }).filter(Boolean).join('\n') || 'なし';

  const misc = `1日の目標学習時間:${S.todayGoalMin || 0}分, 獲得した実績:${(S.unlockedAchs || []).length}個`;

  // 出願プラン（3大学の日程・配点・方式の選び方）と共通テストの出願情報。
  // アプリ内の固定データなので、AIにも同じものを見せておく（このファイルより後に読み込まれるため typeof で確認）
  const examPlanInfo = (typeof examPlanForAI === 'function') ? examPlanForAI() : 'なし';
  const kyotsuInfo = (typeof kyotsuForAI === 'function') ? kyotsuForAI() : 'なし';
  const pastInfo = (typeof pastExamsForAI === 'function') ? pastExamsForAI() : 'なし';
  // 取り込み済みの教材の一覧（本文は質問に応じて自動検索して別途渡す）
  const tbList = (typeof TB !== 'undefined' && Array.isArray(TB.index) && TB.index.length)
    ? `${TB.index.length}冊: ` + TB.index.slice(0, 120).map(b => `${b.title}(${b.subject || 'その他'})`).join('、')
    : 'まだ取り込まれていない';

  // ── 滅多に変わらない情報（プロンプトの先頭に置く） ──
  const stable = `【0. 出願プラン（立命館・同志社・近畿）】\n${examPlanInfo}\n【共通テストの出願】${kyotsuInfo}\n【手元の教材】${tbList}\n`
    + `【1. 時間割】${allTimetable}\n【目標】${targets}\n`
    + `【2. 志望校】${simScores}\n${unis}\n【配点】${scoringInfo}\n【傾向】${trendInfo}\n【出願管理】\n${applications}${conflicts ? '\n⚠️受験日の重複: ' + conflicts : ''}\n`
    + `【3. 模試（全件）】\n${recentMocks}\n【過去問の記録（私大一般・合格最低点との差つき）】\n${pastInfo}\n【苦手ヒートマップ】\n${heatmapDetails}\n`
    + `【4. 学習履歴（昨日まで日別）】\n${recentDailyLogs}\n【それ以前の月別合計】${olderMonthly}\n`
    + `【5. ノート】\n${recentNotes}${olderNotes ? '\n（それ以前のノート題名）' + olderNotes : ''}\n`
    + `【6. 宿題】\n${recentHomework}\n【模試予定】${mockSched}\n【特別講習】${specials}\n【毎週の繰り返し予定】${repeats}\n【その他の記録】\n${recentExtras}\n`
    + `【7. 過去AI評価】${recentEvals}\n【直近の週次レポート】${weeklyRep}`;

  // ── 毎回変わる情報（必ず末尾に置く） ──
  const volatile = `【8. 基本情報】${userInfo}\n【学習状況】${studyStats} / ${misc}\n`
    + `【今日のタスク】完了:[${doneTasks}] 未完了:[${leftTasks}]\n【今日のAI提案プラン】${morning}\n`
    + `【今日の学習】タイマー:[${todayTimerLogs}] / ${sabotage}\n【直近2週間のタイマー記録】${recentTimerLogs}\n`
    + `【科目別の累計】${subjTotals}\n【曜日別の累計】${weekdayTotals}\n`
    + `【予定（過去60日〜今後すべて）】${recentEvents}\n【他のチャットでの相談内容】\n${otherThreads}`;

  return { stable, volatile };
};

// 既存の呼び出し用（全部つないだ1本の文字列）
const buildComprehensiveContext = (scale = 1) => {
  const p = buildContextParts(scale);
  return p.stable + '\n' + p.volatile;
};
// アプリ内の全データをAIに渡す。量が多すぎる場合だけ、古い明細を半分に絞って作り直す
// （Geminiの入力上限には十分収まるが、毎回の応答が遅く・高くなりすぎないようにするため）
const CONTEXT_MAX_CHARS = 90000;
// 全部つないだ1本。量が多すぎるときは stable（古い明細）側だけを削る。
// 末尾から単純に切ると volatile（今日の日付・今日の学習・今のタスク）が落ちてしまい、
// 「今日の評価」なのに今日の情報が無いプロンプトになる。
const getComprehensiveContext = () => {
  const p = getContextParts();
  return p.stable + '\n' + p.volatile;
};

// stable / volatile に分けたまま受け取る（キャッシュを効かせたい呼び出し用）
const getContextParts = () => {
  let p = buildContextParts(1);
  if ((p.stable.length + p.volatile.length) > CONTEXT_MAX_CHARS) {
    p = buildContextParts(0.5);
    if (p.stable.length > CONTEXT_MAX_CHARS - p.volatile.length) {
      p.stable = p.stable.slice(0, Math.max(0, CONTEXT_MAX_CHARS - p.volatile.length));
    }
  }
  return p;
};

// 【…】で始まる見出しブロックのうち、指定した見出しを含むものだけを取り出す
const pickSections = (text, keywords) => String(text || '').split(/\n(?=【)/)
  .filter(block => keywords.some(k => block.startsWith('【') && block.slice(0, 20).includes(k)))
  .join('\n');

// 教材の内容を聞くときなど、学習ログ全部は要らない場面用の短いコンテキスト。
// 渡す量が減るぶん速く・安くなり、無関係な情報が減るので回答もぶれにくい。
const getLightContext = () => {
  const p = buildContextParts(0.5);
  return [pickSections(p.stable, ['時間割', '目標', '志望校']),
          pickSections(p.volatile, ['基本情報', '今日のタスク'])].filter(Boolean).join('\n');
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && typeof window.T !== 'undefined' && window.T.running) {
    S.sabotageCount = (S.sabotageCount || 0) + 1;
    DbService.setMainProfile();
    showToast(`⚠️ サボり検知！別画面を開きました（累計: ${S.sabotageCount}回）`, 'warn', 4000);
    refreshAllViews();
  }
});

// 各種エクスポート・グローバルバインディング
window.handleFileUpload = async (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (!validateUpload(file)) { event.target.value = ''; return; }
  const btn = document.getElementById('btn-ocr'); const originalText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳ 解析・文字化け修正中...'; btn.disabled = true; }
  try {
    const { base64, mimeType } = await prepareFileData(file);
    const sys = "あなたは優秀なデータ入力AIです。JSON形式のみを出力してください。";
    // 科目名はタイマーと同じ一覧（時間割から生成）を使う。
    // ここを固定リストにしていたため、OCRで入れた記録だけ別名になり、
    // 同じ科目なのに学習時間が2つに割れて集計されていた。
    const subjectList = getSubjectsFromTimetable().join(', ');
    const pr = `添付された画像またはPDF（模試の成績表、学習ノート、勉強アプリのスクショ等）を読み取り、以下のどちらかのJSON形式で出力して。\n⚠️重要: 画像内の文字が不鮮明、手書きで読みにくい、またはOCRのミスがある場合でも、受験用語や一般的な文脈から推測して文字化けを自動で修正・補完して正確なデータにすること。\n駿台のノートの場合は講師によってクセがあるから注意して読んでね。字が汚いかもしれないけどなんとか読んでね。\n\n【学習記録の場合】\n{"type": "study", "data": [{"subj": "科目名", "min": 120}]}\n※科目は必ず次の一覧から一字一句そのまま選ぶこと（表記を変えない）: [${subjectList}]\n※一覧にどうしても当てはまらない場合のみ、読み取った科目名をそのまま書くこと。\n\n【模試成績の場合】\n{"type": "mock", "data": {"name": "模試名", "en": 65, "jp": 60, "ma": 70, "hi": 50, "pe": 0, "total": 60, "rank": 1500}}\n※各科目の偏差値を数値で。不明な場合は0。必ずJSONのみを出力すること。`;
    const raw = await AiService.call(pr, sys, {base64, mimeType}, true, false, [], 'fast');
    const res = AiService.extractJson(raw);
    if (res.type === 'study') {
      let msg = ''; (Array.isArray(res.data) ? res.data : []).forEach(d => { const min = Math.round(Number(d?.min)); if (d?.subj && min > 0) { recordStudy(d.subj, min, DateManager.getTodayStr()); msg += `${d.subj}: ${min}分\n`; } });
      showToast(msg ? '📸 学習記録を追加しました！' : '読み取れる記録がありませんでした。', msg ? 'success' : 'warn');
    } else if (res.type === 'mock') {
      // AIの値は文字列や単位つきで来ることがあるので、必ず数値にしてから保存する（表やグラフにそのまま出るため）
      const nv = (v) => { const x = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) ? x : 0; };
      const d = res.data || {};
      const mockObj = { id: generateId(), name: String(d.name || 'AI読取模試').slice(0, 60), date: DateManager.getTodayStr(), type: 'kyotsu', en: nv(d.en), jp: nv(d.jp), ma: nv(d.ma), hi: nv(d.hi), pe: nv(d.pe), total: nv(d.total), rank: nv(d.rank) };
      S.mocks.push(mockObj); DbService.set('mocks', mockObj);
      S.mocks.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      showToast(`📸 模試成績を追加しました！${mockObj.name} 総合偏差値:${mockObj.total}`, 'success');
    }
    initAllCharts(); renderHome(); refreshAllViews();
  } catch(e) { showToast('❌ 読み取り失敗: ' + e.message, 'error'); } finally { if (btn) { btn.textContent = originalText; btn.disabled = false; } event.target.value = ''; }
};

// 📸 ノートスキャン（複数ページ同時対応）
// 複数枚選ぶと1冊のノートとして1回のAI呼び出しにまとめ、元画像はIndexedDBに保存する
window.scanNote = async (event) => {
  const files = Array.from(event.target.files || []); if (!files.length) return;
  if (!files.every(validateUpload)) { event.target.value = ''; return; }
  const btn = document.getElementById('btn-scan-note'); const originalText = btn ? btn.textContent : '';
  const setBtn = (t) => { if (btn) btn.textContent = t; };
  if (btn) { btn.disabled = true; }
  setBtn('⏳ 画像を準備中...');
  try {
    const pages = [];
    for (let i = 0; i < files.length; i++) {
      setBtn(`⏳ 画像を準備中... (${i+1}/${files.length})`);
      pages.push(await prepareFileData(files[i]));
    }
    setBtn(files.length > 1 ? `⏳ ${files.length}ページを解析中...` : '⏳ インデックス作成中...');

    const subjectHint = getSubjectsFromTimetable().join(', ');
    const sys = "あなたは優秀な板書・ノート整理AIです。JSONのみを出力します。";
    const pr = `添付された${files.length}枚のノート／板書の画像は、同じ授業の連続したページです。全ページをまとめて読み取り、1件のインデックスを作成してください。\n⚠️重要: 駿台のノートの場合は講師によって特有のクセがあるから注意して読み取ってね。また、字が汚いかもしれないけど文脈から推測してなんとか読んでね。\n科目は次の中から最も近いものを1つ選ぶこと: [${subjectHint}]。どれにも当てはまらなければ "その他"。\n出力形式（JSON）: {"title":"ノートのメインテーマ(15文字以内)", "subject":"科目名", "summary":"内容の要約(80文字程度)", "keywords":["重要単語1","重要単語2","重要単語3"], "text":"読み取った主なテキスト(300字程度)"}`;
    const raw = await AiService.call(pr, sys, pages, true, false, [], 'fast');
    const res = AiService.extractJson(raw);

    // AIが一部のキーを返さないことがあるため、必ず文字列で埋めておく
    // （undefined のまま保存すると renderNotes の .toLowerCase() でノート一覧全体が壊れる）
    const noteId = generateId();
    const noteObj = {
      id: noteId, date: DateManager.getTodayStr(),
      title: res.title || '無題のノート',
      subject: res.subject || 'その他',
      summary: res.summary || '',
      keywords: Array.isArray(res.keywords) ? res.keywords : [],
      text: res.text || '',
      pageCount: pages.length,
      hasImages: true
    };
    // 元画像は端末内（IndexedDB）に保存し、分割してクラウドにも上げる（他の端末でも開けるように）。
    // アップロードは時間がかかるので待たずに裏で進める
    const noteFiles = pages.map(p => ({ mimeType: p.mimeType, base64: p.base64 }));
    await Blobs.set('note_' + noteId, noteFiles);
    BlobSync.upload('note_' + noteId, noteFiles);
    S.notes.unshift(noteObj); DbService.set('notes', noteObj);
    showToast(`📚 ${pages.length}ページのノートを整理して保存しました！`); renderNotes();
  } catch(e) { showToast('❌ ノート整理失敗: ' + e.message, 'error'); } finally { if (btn) { btn.textContent = originalText; btn.disabled = false; } event.target.value = ''; }
};

window.deleteNote = (idStr) => {
  const note = S.notes.find(x => x.id?.toString() === idStr.toString());
  Trash.push('notes', note);
  // 元画像はここでは消さない。ゴミ箱から復元したときに画像も戻るようにするため
  // （ゴミ箱の保持期限が切れたノートの画像は cleanupOrphanNoteBlobs が片付ける）
  DbService.del('notes', idStr);
  S.notes = S.notes.filter(x => x.id.toString() !== idStr.toString());
  renderNotes();
  showToast('ノートを削除しました（ゴミ箱から30日以内に復元できます）');
};

// ノートの元画像を開く／閉じる
window.toggleNoteImages = async (id) => {
  const wrap = document.getElementById('note-img-' + id);
  if (!wrap) return;
  if (wrap.dataset.open === '1') { wrap.innerHTML = ''; wrap.dataset.open = '0'; return; }
  wrap.dataset.open = '1';
  wrap.innerHTML = '<div class="muted" style="font-size:12px">読み込み中...</div>';
  // 端末内に無ければクラウドから取ってくる（別の端末でスキャンしたノート）
  const imgs = await BlobSync.fetch('note_' + id);
  if (wrap.dataset.open !== '1') return;   // 読み込み中に閉じられた
  if (!imgs || !imgs.length) { wrap.innerHTML = '<div class="muted" style="font-size:12px">元画像が見つかりません（スキャンした端末がまだ同期を終えていないか、オフラインの可能性があります）</div>'; return; }
  wrap.innerHTML = imgs.map((im, i) => /^application\/pdf/.test(im.mimeType)
    ? `<a href="data:application/pdf;base64,${im.base64}" download="note-${esc(id)}-${i+1}.pdf" class="btn btn-s btn-sm" style="margin-top:8px">📄 PDF（${i+1}）を開く</a>`
    : `<img src="data:${esc(im.mimeType)};base64,${im.base64}" alt="ページ${i+1}" style="width:100%;border-radius:8px;margin-top:8px;border:1px solid var(--border)">`
  ).join('');
};

// ゴミ箱からも消えた（＝もう復元できない）ノートの元画像を、端末内とクラウドの両方から片付ける
const cleanupOrphanNoteBlobs = async () => {
  // サーバーと突き合わせる前（ノート一覧がまだ空かもしれない状態）で動くと、生きている画像まで消してしまう
  if (!db || !_reconciledCols.has('notes') || !_reconciledCols.has('trash')) return;
  try {
    const alive = new Set([
      ...(S.notes || []).map(n => 'note_' + n.id),
      ...(S.trash || []).filter(e => e.col === 'notes').map(e => 'note_' + e.item?.id)
    ]);
    for (const key of await Blobs.keys()) {
      if (typeof key !== 'string' || !key.startsWith('note_') || alive.has(key)) continue;
      await Blobs.del(key);
      BlobSync.remove(key);
    }
  } catch (e) { console.warn('ノート画像の整理に失敗', e); }
};

window.setNoteFilter = (subj, btn) => {
  _noteFilter = subj;
  document.querySelectorAll('#note-filter-bar .tag').forEach(b => { b.style.background=''; b.style.color=''; b.style.borderColor=''; });
  if (btn) { btn.style.background='var(--accent)'; btn.style.color='#fff'; btn.style.borderColor='var(--accent)'; }
  renderNotes();
};
let _noteFilter = '';

// 🖨️ ノートをPDF化（ブラウザの印刷ダイアログで「PDFとして保存」を選ぶ）
// 専用ライブラリだと日本語フォントの埋め込みが必要になるため、印刷機能を使う
window.exportNotesPdf = async () => {
  const notes = getFilteredNotes();
  if (!notes.length) { showToast('出力するノートがありません', 'warn'); return; }
  // 画像の読み込み（await）の後で window.open するとポップアップブロックに掛かるので、先に開いておく
  const w = window.open('', '_blank');
  if (!w) { showToast('ポップアップがブロックされました。設定で許可してください', 'error'); return; }
  w.document.write('<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>準備中...</title></head><body style="font-family:sans-serif;padding:24px">📚 ノートを準備しています...</body></html>');
  showToast('印刷画面を開きます。出力先で「PDFとして保存」を選んでください', 'success', 5000);
  const imgMap = {};
  for (const n of notes) { if (n.hasImages) imgMap[n.id] = ((await BlobSync.fetch('note_' + n.id)) || []).filter(im => /^image\//.test(im.mimeType)); }
  const body = notes.map(n => `
    <article>
      <h2>${esc(n.title)}</h2>
      <div class="meta">${esc(n.date)}${n.subject ? ' ／ ' + esc(n.subject) : ''}${n.pageCount > 1 ? ' ／ ' + n.pageCount + 'ページ' : ''}</div>
      <p class="sum">${esc(n.summary)}</p>
      <p class="kw">${noteKeywords(n).map(k => esc(k)).join(' ・ ')}</p>
      <p class="txt">${esc(n.text).replace(/\n/g, '<br>')}</p>
      ${(imgMap[n.id]||[]).map(im => `<img src="data:${im.mimeType};base64,${im.base64}">`).join('')}
    </article>`).join('');
  w.document.open();
  w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>ノート一覧 ${DateManager.getTodayStr()}</title>
    <style>
      body{font-family:-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;margin:24px;color:#111;line-height:1.7}
      h1{font-size:20px;border-bottom:2px solid #333;padding-bottom:6px}
      article{page-break-inside:avoid;break-inside:avoid;margin-bottom:28px;padding-bottom:16px;border-bottom:1px solid #ddd}
      h2{font-size:16px;margin:0 0 4px}
      .meta{font-size:11px;color:#666;margin-bottom:8px}
      .sum{font-size:13px;margin:0 0 6px}
      .kw{font-size:11px;color:#444;margin:0 0 6px}
      .txt{font-size:12px;white-space:normal;background:#f7f7f7;padding:8px;border-radius:4px}
      img{max-width:100%;margin-top:8px;page-break-inside:avoid}
      @page{margin:14mm}
    </style></head><body>
    <h1>📚 ノート一覧（${notes.length}件 / ${esc(DateManager.getTodayStr())}）</h1>${body}
    </body></html>`);
  w.document.close();
  // 画像の読み込みを待ってから印刷ダイアログを出す
  const doPrint = () => setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
  if (w.document.readyState === 'complete') doPrint(); else w.onload = doPrint;
};

// 現在の検索語・科目フィルタに合致するノート
const getFilteredNotes = () => {
  const q = (document.getElementById('note-search')?.value || '').trim();
  return (S.notes || []).filter(n => {
    if (_noteFilter && (n.subject || 'その他') !== _noteFilter) return false;
    if (!q) return true;
    // あいまい検索：カタカナ/ひらがな・全角半角・記号の違いを無視して照合する
    return fuzzyMatch(n.title, q) || fuzzyMatch(n.summary, q) || fuzzyMatch(n.text, q)
        || fuzzyMatch(n.subject, q) || noteKeywords(n).some(k => fuzzyMatch(k, q));
  });
};

const renderNoteFilterBar = () => {
  const bar = document.getElementById('note-filter-bar');
  if (!bar) return;
  const counts = {};
  (S.notes || []).forEach(n => { const s = n.subject || 'その他'; counts[s] = (counts[s] || 0) + 1; });
  const subjects = Object.keys(counts).sort();
  bar.innerHTML = [`<button class="tag" onclick="setNoteFilter('',this)"${_noteFilter===''?' style="background:var(--accent);color:#fff;border-color:var(--accent)"':''}>すべて (${(S.notes||[]).length})</button>`]
    .concat(subjects.map(s => `<button class="tag" onclick="setNoteFilter('${esc(s).replace(/'/g,"\\'")}',this)"${_noteFilter===s?' style="background:var(--accent);color:#fff;border-color:var(--accent)"':''}>${esc(s)} (${counts[s]})</button>`))
    .join('');
};

const renderNotes = () => {
  const el = document.getElementById('note-list');
  if(!el) return;
  renderNoteFilterBar();
  if (!S.notes || S.notes.length===0) { el.innerHTML = '<div class="empty">ノートがありません</div>'; return; }
  const filtered = getFilteredNotes();
  if (filtered.length === 0) { el.innerHTML = '<div class="empty">一致するノートが見つかりません</div>'; return; }
  el.innerHTML = filtered.map(n => `<div class="note-item">
    <div class="flex-between" style="margin-bottom:4px">
      <strong style="font-size:14px">${esc(n.title)}</strong>
      <span class="muted" style="font-size:11px">${esc(n.date)}</span>
    </div>
    <div style="margin-bottom:6px">
      <span class="badge bb">${esc(n.subject || 'その他')}</span>
      ${n.pageCount > 1 ? `<span class="badge bb">${n.pageCount}ページ</span>` : ''}
    </div>
    <div style="font-size:12px;margin-bottom:6px">${esc(n.summary)}</div>
    <div>${noteKeywords(n).map(k=>`<span class="note-tag">${esc(k)}</span>`).join('')}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:6px;background:var(--bg);padding:6px;border-radius:4px;border:1px solid var(--border)">📝 ${esc(n.text)}</div>
    <div id="note-img-${n.id}" data-open="0"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      ${n.hasImages ? `<button class="btn btn-s btn-sm" onclick="toggleNoteImages('${n.id}')">🖼 元画像</button>` : ''}
      <button class="btn btn-s btn-sm" style="color:var(--a2)" onclick="deleteNote('${n.id}')">削除</button>
    </div>
  </div>`).join('');
};

window.generateRuidai = async (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (!validateUpload(file)) { event.target.value = ''; return; }
  const btn = document.getElementById('btn-ruidai'); const originalText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳ 思考プロセスを分析・類題作成中...'; btn.disabled = true; }
  try {
    const { base64, mimeType } = await prepareFileData(file);
    const sys = "あなたは優秀な予備校講師です。マークダウン形式で回答してください。";
    const pr = `添付された画像は、生徒が間違えた問題やノートです。\n⚠️重要: 手書きの場合、字が汚いかもしれないけどなんとか読んでね。駿台の板書やノートが含まれる場合、講師によってクセがあるから注意して読み取ってね。\n以下の3点を行ってください。\n1. この問題の「どこで躓きやすいか」「どういう思考プロセスが必要か」を簡潔に解説。\n2. その思考プロセスを使って解ける、全く新しい「オリジナルの類題」を1問作成。\n3. その類題の「解答と解説」を記述。`;
    const raw = await AiService.call(pr, sys, {base64, mimeType}, false, false, [], 'deep');
    const aiCoachBtn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.textContent.includes('AIコーチ'));
    if (aiCoachBtn) window.showPage('aicoach', aiCoachBtn);
    if(!S.chatHistory) S.chatHistory = [];
   const msg1 = { id: generateId(), role: 'user', text: '📸 間違えた問題の画像を送信しました。類題を作ってください。', timestamp: Date.now(), threadId: window.currentChatThreadId };
    const msg2 = { id: generateId(), role: 'ai', text: raw, timestamp: Date.now() + 1, threadId: window.currentChatThreadId };
    S.chatHistory.push(msg1, msg2); DbService.set('chatHistory', msg1); DbService.set('chatHistory', msg2); 
    const thread = S.chatThreads.find(t => t.id === window.currentChatThreadId);
    if (thread) thread.updatedAt = Date.now();
    DbService.setMainProfile();
    renderChat();
  } catch(e) { showToast('❌ 類題作成失敗: ' + e.message, 'error'); } finally { if (btn) { btn.textContent = originalText; btn.disabled = false; } event.target.value = ''; }
};

window.evalDaily = async (manual = true) => {
  const el = document.getElementById('daily-coach-c'); if (!el) return;
  const todayStr = DateManager.getTodayStr();
  if (!manual) {
    if (S.aiCoachLog.lastEvalDate === todayStr && S.aiCoachLog.dailyEvalHtml) { el.innerHTML = S.aiCoachLog.dailyEvalHtml; } 
    else { el.innerHTML = '<div class="empty"><div class="empty-icon">📝</div><div class="empty-text">学習時間やタスクを記録してから評価ボタンを押してください</div></div>'; }
    return;
  }
  el.innerHTML = '<div class="empty">🔍 先生が全データを分析し、必要な情報をWebで調べています...</div>';
  const ctx = getComprehensiveContext();
  const pr = `以下の生徒の全データに基づき、今日の学習を評価してください。\n`
    + `1. 今日の評価ランク（S,A,B,C,Dのいずれか1文字）\n2. 評価コメント（80字程度。サボりが多い場合は厳しく指導）\n3. 明日やるべきタスクの提案（2〜5個。未完了タスクの引き継ぎ、苦手克服、明日の時間割・予定、締切の近い宿題や出願を考慮）\n`
    + `志望校の出題傾向や配点、次の模試の範囲など、助言の根拠になる外部情報は実際にWeb検索して確認してください。\n\n${ctx}`;
  try {
    // 検索→抽出の2段階。JSONだけを求めると検索せずに記憶で答えてしまうため
    const { data, sources } = await AiService.researchJson({
      question: pr, system: COACH_RESEARCH_SYS, purpose: 'deep', maxRounds: 0, requireSources: false,
      format: '{"rank":"S","comment":"評価コメント(80字)","tomorrow_tasks":["提案1","提案2"]}'
    });
    const rank = /^[SABCD]$/.test(String(data.rank || '').trim().toUpperCase()) ? String(data.rank).trim().toUpperCase() : 'C';
    data.rank = rank;
    const html = `<div class="row" style="align-items:flex-start;border-bottom:none;padding:0"><div class="rank-badge rank-${esc(data.rank)}">${esc(data.rank)}</div><div style="flex:1;margin-left:12px"><div style="font-size:13px;line-height:1.5;margin-bottom:8px">${esc(data.comment)}</div><div style="font-size:12px;color:var(--muted);font-weight:700">💡 明日の提案タスク</div><ul style="font-size:12px;margin-left:20px;margin-top:4px">${(Array.isArray(data.tomorrow_tasks)?data.tomorrow_tasks:[]).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>${renderSourceChips(sources, '参考にした情報', '')}</div></div>`;
    el.innerHTML = html; S.aiCoachLog.dailyEvalHtml = html; S.aiCoachLog.lastEvalDate = todayStr;
    if (!Array.isArray(S.aiCoachLog.history)) S.aiCoachLog.history = [];
    const existingIdx = S.aiCoachLog.history.findIndex(h => h.date === todayStr);
    const historyItem = { date: todayStr, rank: data.rank, comment: data.comment };
    if (existingIdx >= 0) { S.aiCoachLog.history[existingIdx] = historyItem; } else { S.aiCoachLog.history.unshift(historyItem); }
    DbService.setMainProfile(); renderCoachHistory();
  } catch(e) { el.innerHTML = `<div class="empty" style="color:var(--a2)">エラー: ${esc(e.message)}</div>`; }
};

// ============================================================
// 🌅 朝の「今日やるべきこと」提案
// その日はじめてアプリを開いたときに1回だけ自動生成し、結果はキャッシュする
// ============================================================
window.renderMorningPlan = (force = false) => {
  const el = document.getElementById('morning-plan-c');
  if (!el) return;
  const today = DateManager.getTodayStr();
  if (!force && S.morningPlan?.date === today && S.morningPlan.html) { el.innerHTML = S.morningPlan.html; return; }
  if (!force) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🌅</div><div class="empty-text">ボタンを押すと、時間割・宿題・模試日程からAIが今日の動き方を組み立てます</div></div>';
    return;
  }
  return window.genMorningPlan();
};

window.genMorningPlan = async () => {
  const el = document.getElementById('morning-plan-c');
  if (!el) return;
  el.innerHTML = '<div class="empty">🌅 今日の動き方を組み立て中...</div>';
  const today = DateManager.getTodayStr();
  const dow = ['日','月','火','水','木','金','土'][DateManager.parseSafe(today).getDay()];
  try {
    const ctx = getComprehensiveContext();
    const pr = `今日は${today}（${dow}曜）です。以下の生徒データを踏まえ、今日1日の動き方を具体的に提案してください。\n`
      + `・今日の時間割の空き時間、締切が近い宿題や出願、次の模試までの日数、苦手分野を必ず考慮すること\n`
      + `・タスクは「何を・何分」まで具体的に。合計が現実的な時間に収まるようにすること\n`
      + `・次の模試の出題範囲や志望校の傾向など、優先順位の根拠になる外部情報は実際にWeb検索して確認すること\n`
      + `・「今日のテーマ」「いちばん優先すべきこと」「タスク（内容・分数・理由）」「注意点」を答えること\n\n${ctx}`;
    // 検索→抽出の2段階。JSONだけを求めると検索せずに記憶で答えてしまうため
    const { data: d, sources } = await AiService.researchJson({
      question: pr, system: COACH_RESEARCH_SYS, purpose: 'deep', maxRounds: 0, requireSources: false,
      format: '{"headline":"今日のテーマ(20字以内)","focus":"今日いちばん優先すべきこと(40字)","tasks":[{"t":"英語長文を2題","min":40,"why":"模試まで10日で読解が遅い"}],"caution":"注意点(40字)"}'
    });
    const tasks = (Array.isArray(d.tasks) ? d.tasks : []).filter(t => t && t.t);
    const totalMin = tasks.reduce((a, t) => a + (+t.min || 0), 0);
    const html = `
      <div style="font-size:15px;font-weight:800;margin-bottom:4px">${esc(d.headline || '今日の計画')}</div>
      <div style="font-size:13px;color:var(--accent);font-weight:700;margin-bottom:10px">🎯 ${esc(d.focus || '')}</div>
      ${tasks.map((t, i) => `
        <div class="row" style="align-items:flex-start">
          <div style="flex:1">
            <div class="row-title">${esc(t.t)}</div>
            <div class="row-sub">${esc(t.why || '')}</div>
          </div>
          <div style="text-align:right;margin-left:8px;white-space:nowrap">
            <span class="badge bb">${+t.min || 0}分</span>
            <button class="icon-btn" title="今日のタスクに追加" onclick="addMorningTask(${i})">＋</button>
          </div>
        </div>`).join('')}
      <div style="font-size:11px;color:var(--muted);margin-top:8px">合計 約${DateManager.formatHours(totalMin)}${d.caution ? ' ／ ⚠️ ' + esc(d.caution) : ''}</div>
      ${renderSourceChips(sources, '参考にした情報', '')}
      <button class="btn btn-s btn-sm btn-full mt12" onclick="addAllMorningTasks()">提案タスクをすべて追加</button>`;
    el.innerHTML = html;
    S.morningPlan = { date: today, html, tasks };
    DbService.setMainProfile();
  } catch (e) {
    el.innerHTML = `<div class="empty" style="color:var(--a2)">エラー: ${esc(e.message)}</div>`;
  }
};

window.addMorningTask = (idx) => {
  const t = S.morningPlan?.tasks?.[idx];
  if (!t) return;
  const text = `${t.t}（${+t.min || 0}分）`;
  if (S.tasks.some(x => x.text === text)) { showToast('すでに追加済みです', 'warn'); return; }
  const obj = { id: generateId(), text, done: false, date: DateManager.getTodayStr() };
  S.tasks.push(obj); DbService.set('tasks', obj);
  refreshAllViews();
  showToast('✅ タスクに追加しました');
};

window.addAllMorningTasks = () => {
  const tasks = S.morningPlan?.tasks || [];
  if (!tasks.length) return;
  let added = 0;
  tasks.forEach(t => {
    const text = `${t.t}（${+t.min || 0}分）`;
    if (S.tasks.some(x => x.text === text)) return;
    const obj = { id: generateId(), text, done: false, date: DateManager.getTodayStr() };
    S.tasks.push(obj); DbService.set('tasks', obj); added++;
  });
  refreshAllViews();
  showToast(added ? `✅ ${added}件のタスクを追加しました` : 'すべて追加済みです', added ? 'success' : 'warn');
};

window.genAIReport = async () => {
  const el = document.getElementById('weekly-rep'); if(!el) return;
  el.innerHTML = '<div class="empty">🔍 先生が今週のデータを分析中...</div>';
  try {
    const ctx = getComprehensiveContext();
    const pr = `以下の生徒の全データに基づき、今週の学習状況を全体的に評価し、来週に向けてのモチベーションが上がるアドバイスをMarkdown形式で短く書いてください。志望校の傾向・配点、直近の模試や出願の日程など、助言の根拠になる外部情報は実際にWeb検索して確認してください。\n\n${ctx}`;
    const { text: raw, sources } = await AiService.request({ prompt: pr, system: COACH_RESEARCH_SYS, useSearch: true, purpose: 'deep' });
    const html = raw
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/^#{3}\s(.+)$/gm,'<strong style="font-size:13px;color:var(--muted)">$1</strong>')
      .replace(/^#{2}\s(.+)$/gm,'<strong style="font-size:14px">$1</strong>')
      .replace(/^#{1}\s(.+)$/gm,'<strong style="font-size:15px">$1</strong>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/^[-・]\s(.+)$/gm,'<span style="display:block;padding-left:12px">・$1</span>')
      .replace(/\n/g,'<br>')
      + renderSourceChips(sources, '参考にした情報', '');
    el.innerHTML = html; S.aiCoachLog.weeklyRepHtml = html; DbService.setMainProfile();
  } catch(e) { el.innerHTML = `<div class="empty" style="color:var(--a2)">エラー: ${esc(e.message)}</div>`; }
};
