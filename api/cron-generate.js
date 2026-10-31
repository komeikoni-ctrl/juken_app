// ============================================================
// 定期AI生成（Vercel Cron 専用）: 朝ブリーフィング / 週次レビュー /
// チャット要約 / サブスク値上げ検知
// ------------------------------------------------------------
// 毎日 JST 6:30（= 21:30 UTC）に Vercel Cron から呼ばれる。
// ・12 朝ブリーフィング: 毎日生成し live/briefing に保存（直近7日分）。
//   Push は送らない（毎朝の通知は煩わしいため。ホームのカードで見せる）。
// ・13 週次レビュー: 月曜だけ生成し live/weeklyReview に保存（直近8週分）。
// ・20 チャット要約: 月曜（週次と同便）に、未要約の会話を要約して
//   live/chatSummary に保存。
// ・61 サブスク値上げ検知: 毎日チェックし、新規検知があれば
//   live/alerts に記録＋ Push（詳細は detectSubsPriceAlerts）。
// 手動実行: ?part=briefing|weekly|chat|subs|essays|all（Cron 認可が前提）。
// ・15 添削キュー: 毎朝の便で pending を最大3件処理する。
// 学習時間は dailyLogs サブコレクション（日付ごとの記録）から計算する。
// プロフィール本体の todayMinutes / streak は今のアプリが更新しない古い値で、
// これを使うと毎朝同じ「昨日◯分」を言い続けてしまう（2026-10 に発覚）。
// 週次レビューの「先週の学習量」も dailyLogs の直近7日から出し、
// 読めなかったときだけ日次バックアップ（live/backup-*）との差分で近似する。
// ============================================================
const lib = require('./_pushlib');
const gen = require('./_genlib');

const BRIEFING_DOC = 'live/briefing';
const WEEKLY_DOC = 'live/weeklyReview';
const CHAT_SUMMARY_DOC = 'live/chatSummary';
const ALERTS_DOC = 'live/alerts';

// ---------- 材料集め ----------

// 朝ブリーフィングの材料（取れたものだけを詰める）
async function gatherBriefingMaterials(today) {
  const m = { date: today };
  const profile = await gen.getProfile().catch(() => null);
  if (profile) {
    m.todayGoalMin = Number(profile.todayGoalMin) || 0;
    const st = (profile.studyTime && typeof profile.studyTime === 'object') ? profile.studyTime : {};
    m.topSubjects = Object.entries(st).sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 3)
      .map(([k, v]) => ({ subject: k, minutes: v }));
  }
  // 学習時間は日別の記録から数える（読めなければ学習時間には触れない）
  const logs = await gen.listDailyLogs().catch(() => null);
  if (logs) {
    const st = gen.studyStats(logs, today);
    m.study = {
      yesterday: st.yesterday, yesterdayMinutes: st.yesterdayMinutes,
      streak: st.streak, totalMinutes: st.totalMinutes, last7Minutes: st.last7Minutes,
      lastStudyDate: st.lastStudyDate, daysSinceLast: st.daysSinceLast
    };
  }
  m.upcoming = gen.upcomingEvents(today, 2);
  const kyotsu = m.upcoming.find(e => e.id === 'kyotsu-1');
  m.kyotsuDaysLeft = kyotsu ? kyotsu.daysLeft : gen.daysDiff(today, '2027-01-16');
  // 入試情報の更新はブリーフィングの材料にしない（ホームに受験情報を出さないため。2026-10-31 こにの指示）
  const usage = await lib.fsGetJson(lib.AI_USAGE_DOC, 'usage', null).catch(() => null);
  if (usage) m.aiMonthCostYen = gen.monthUsageCostYen(usage, today.slice(0, 7));
  return m;
}

// 学習記録の材料行（朝・週次で共通）。記録が途切れているときは、
// 「勉強していない」と決めつけずに記録を促す程度にとどめるよう指示する。
function studyLines(st, goalMin) {
  const out = [];
  out.push(`- 昨日（${st.yesterday}）アプリに記録された学習時間: ${st.yesterdayMinutes}分` + (goalMin ? `（1日の目標 ${goalMin}分）` : ''));
  out.push(`- 直近7日の記録合計: ${st.last7Minutes}分 / 連続記録: ${st.streak}日 / 累計: ${st.totalMinutes}分`);
  if (!st.lastStudyDate) {
    out.push('- 学習時間の記録はまだ1件もない。責めずに、タイマーで記録すると振り返りに使えることを一言添える程度にする');
  } else if (st.daysSinceLast >= 2) {
    out.push(`- 最後に学習時間を記録した日: ${st.lastStudyDate}（${st.daysSinceLast}日前）。記録が無いのは「勉強していない」ではなく「アプリに記録していない」だけの可能性がある。責めずに、記録を軽く促す程度にとどめること`);
  }
  return out;
}

function briefingPrompt(m) {
  const lines = [];
  lines.push('あなたは浪人生の学習を支えるAIコーチです。今朝のブリーフィングを日本語で作成してください。');
  lines.push('条件: 3〜5文・200字以内。絵文字は最大1つまで。過度な励ましや説教は禁止。具体的な数字と、今日意識すべきことを1つだけ入れる。');
  lines.push('材料（アプリの実データ）:');
  lines.push(`- 日付: ${m.date}`);
  if (m.study) lines.push(...studyLines(m.study, m.todayGoalMin));
  else lines.push('- 学習時間の記録: 読み取れなかった（学習時間には触れないこと）');
  if (m.topSubjects && m.topSubjects.length) lines.push('- 累計の多い科目: ' + m.topSubjects.map(s => `${s.subject} ${s.minutes}分`).join(' / '));
  lines.push(`- 共通テストまで: あと${m.kyotsuDaysLeft}日`);
  for (const e of (m.upcoming || [])) lines.push(`- 直近の日程: ${e.label}（${e.date}、あと${e.daysLeft}日）`);
  if (m.aiMonthCostYen != null) lines.push(`- 今月のAI利用料の概算: 約${m.aiMonthCostYen}円`);
  lines.push('材料に無い数字や予定は作らないこと。');
  return lines.join('\n');
}

async function runBriefing(today, generate) {
  const materials = await gatherBriefingMaterials(today);
  // 思考トークンに予算を食われるため、短文でも上限は広めに取る
  const text = await generate(briefingPrompt(materials), { maxOutputTokens: 2048 });
  const doc = await lib.fsGetJson(BRIEFING_DOC, 'data', { days: {} });
  if (!doc.days || typeof doc.days !== 'object') doc.days = {};
  doc.days[today] = { text, generatedAt: new Date().toISOString(), materials };
  const keys = Object.keys(doc.days).sort();
  while (keys.length > 7) delete doc.days[keys.shift()];
  doc.latest = today;
  await lib.fsSetJson(BRIEFING_DOC, 'data', doc);
  return { date: today, chars: text.length };
}

// ---------- 週次レビュー ----------

// バックアップの索引から、daysAgo 日前以前で最も古いスナップショットの
// プロフィール（studyTime 等）を取り出す。無ければ null。
async function oldestBackupProfile(daysAgo, today) {
  const days = await lib.fsGetJson(lib.BACKUPS_INDEX_DOC, 'days', {}).catch(() => ({}));
  const keys = Object.keys(days || {}).sort();
  if (!keys.length) return null;
  const target = gen.dateStrJst(new Date(Date.parse(today + 'T00:00:00Z') - daysAgo * 86400000));
  const cand = keys.filter(k => k <= target);
  const pick = cand.length ? cand[0] : keys[0];
  const snap = await lib.fsGetJson('live/backup-' + pick, 'data', null).catch(() => null);
  if (!snap || !snap.profile) return null;
  return { date: pick, profile: gen.fsDocToObj(snap.profile) };
}

async function gatherWeeklyMaterials(today) {
  const m = { date: today };
  const logs = await gen.listDailyLogs().catch(() => null);
  if (logs) {
    const st = gen.studyStats(logs, today);
    m.study = {
      yesterday: st.yesterday, yesterdayMinutes: st.yesterdayMinutes,
      streak: st.streak, totalMinutes: st.totalMinutes, last7Minutes: st.last7Minutes,
      lastStudyDate: st.lastStudyDate, daysSinceLast: st.daysSinceLast
    };
    m.totalMinutes = st.totalMinutes;
    m.weekMinutes = st.last7Minutes;
    m.studyDiff = st.last7Subjects;
    m.diffBasis = '日別の学習記録（直近7日）';
  }
  // 日別の記録が読めなかったときだけ、バックアップとの差分で近似する
  const profile = logs ? null : await gen.getProfile().catch(() => null);
  const old = logs ? null : await oldestBackupProfile(7, today).catch(() => null);
  if (profile) {
    m.totalMinutes = Number(profile.totalMinutes) || 0;
    const cur = (profile.studyTime && typeof profile.studyTime === 'object') ? profile.studyTime : {};
    if (old && old.profile) {
      const prev = (old.profile.studyTime && typeof old.profile.studyTime === 'object') ? old.profile.studyTime : {};
      const subjects = new Set([...Object.keys(cur), ...Object.keys(prev)]);
      m.studyDiff = [...subjects].map(s => ({ subject: s, minutes: (cur[s] || 0) - (prev[s] || 0) }))
        .filter(x => x.minutes !== 0).sort((a, b) => b.minutes - a.minutes);
      m.weekMinutes = m.studyDiff.reduce((a, x) => a + Math.max(0, x.minutes), 0);
      m.diffFrom = old.date;
      m.diffBasis = '日次バックアップとの差分（最大で直近7日分）';
    }
  }
  const usage = await lib.fsGetJson(lib.AI_USAGE_DOC, 'usage', null).catch(() => null);
  if (usage) {
    const dayStrs = [];
    for (let i = 1; i <= 7; i++) dayStrs.push(gen.dateStrJst(new Date(Date.parse(today + 'T00:00:00Z') - i * 86400000)));
    m.aiWeek = gen.recentUsageTotals(usage, dayStrs);
  }
  const chat = await gen.listCollection(lib.PROFILE_DOC + '/chatHistory', 300).catch(() => []);
  const weekAgoMs = Date.parse(today + 'T00:00:00Z') - 7 * 86400000;
  m.chatWeekCount = chat.filter(c => Number(c.timestamp) >= weekAgoMs).length;
  m.upcoming = gen.upcomingEvents(today, 3);
  return m;
}

function weeklyPrompt(m) {
  const lines = [];
  lines.push('あなたは浪人生の学習を支えるAIコーチです。先週の週次レビューと今週の重点を日本語で書いてください。');
  lines.push('条件: 全体で250〜400字。構成は「先週のふり返り」「今週の重点（最大3つ）」の2部。絵文字は最大2つまで。材料に無い数字は作らない。');
  lines.push('材料（アプリの実データ）:');
  if (m.weekMinutes != null) {
    lines.push(`- 先週の学習量（${m.diffBasis}）: 合計 約${m.weekMinutes}分`);
    if (m.studyDiff && m.studyDiff.length) lines.push('- 科目別の増分: ' + m.studyDiff.slice(0, 6).map(x => `${x.subject} +${x.minutes}分`).join(' / '));
  } else {
    lines.push('- 先週の学習量: バックアップが揃わず算出できなかった（この点には触れず、他の材料で書くこと）');
  }
  if (m.totalMinutes != null) lines.push(`- 累計学習時間: ${m.totalMinutes}分`);
  if (m.study && m.study.lastStudyDate && m.study.daysSinceLast >= 7) {
    lines.push(`- 最後に学習時間を記録した日: ${m.study.lastStudyDate}（${m.study.daysSinceLast}日前）。記録が無いのは「アプリに記録していない」だけの可能性があるので、責めずに記録を促す程度にする`);
  } else if (m.study && !m.study.lastStudyDate) {
    lines.push('- 学習時間の記録はまだ1件もない（責めずに、記録すると振り返りに使えることを一言添える程度にする）');
  }
  if (m.aiWeek) lines.push(`- 先週のAI利用: ${m.aiWeek.calls}回`);
  if (m.chatWeekCount != null) lines.push(`- 先週のAIチャット: ${m.chatWeekCount}件のやり取り`);
  for (const e of (m.upcoming || [])) lines.push(`- 直近の日程: ${e.label}（${e.date}、あと${e.daysLeft}日）`);
  return lines.join('\n');
}

async function runWeekly(today, generate) {
  const weekKey = gen.isoWeekKey(today);
  const materials = await gatherWeeklyMaterials(today);
  const text = await generate(weeklyPrompt(materials), { maxOutputTokens: 3072 });
  const doc = await lib.fsGetJson(WEEKLY_DOC, 'data', { entries: {} });
  if (!doc.entries || typeof doc.entries !== 'object') doc.entries = {};
  doc.entries[weekKey] = { text, generatedAt: new Date().toISOString(), weekKey, materials };
  const keys = Object.keys(doc.entries).sort();
  while (keys.length > 8) delete doc.entries[keys.shift()];
  doc.latest = weekKey;
  await lib.fsSetJson(WEEKLY_DOC, 'data', doc);
  return { weekKey };
}

// ---------- チャット要約 ----------

async function runChatSummary(generate) {
  const prev = await lib.fsGetJson(CHAT_SUMMARY_DOC, 'data', null).catch(() => null);
  const coveredUntil = Number(prev?.coveredUntil) || 0;
  const all = await gen.listCollection(lib.PROFILE_DOC + '/chatHistory', 300);
  const msgs = all
    .filter(c => c && typeof c.text === 'string' && Number(c.timestamp) > coveredUntil)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  if (!msgs.length) return { skipped: true, reason: 'no new messages', coveredUntil };
  const take = msgs.slice(-40);
  const convo = take.map(c => `${c.role === 'user' ? '本人' : 'AI'}: ${String(c.text).slice(0, 300)}`).join('\n');
  const prevSummary = prev?.summary ? `これまでの要約:\n${prev.summary}\n\n` : '';
  const prompt = '以下は受験生とAIの学習チャットの記録です。' + (prevSummary ? 'これまでの要約を踏まえて、全体の要約を更新してください。' : '内容を要約してください。')
    + '\n条件: 日本語・150〜250字。話題になった科目・質問のテーマ・本人の関心事が分かるように。個人が特定できる情報は入れない。\n\n'
    + prevSummary + '新しい会話:\n' + convo;
  const summary = await generate(prompt, { maxOutputTokens: 2048 });
  const data = {
    summary,
    updatedAt: new Date().toISOString(),
    coveredUntil: Number(take[take.length - 1].timestamp) || coveredUntil,
    messageCount: (Number(prev?.messageCount) || 0) + take.length,
    lastBatch: take.length
  };
  await lib.fsSetJson(CHAT_SUMMARY_DOC, 'data', data);
  return { summarized: take.length, coveredUntil: data.coveredUntil };
}

// ---------- サブスク値上げ検知（61） ----------
// 名寄せの範囲（正直な範囲）:
// ・明細タイトルへのキーワード一致で「請求チャネル」を判定する
//   （Google系 / Apple系 / Claude直接 / Goodnotes）。
// ・Apple系は複数サブスクが同じ表記（APPLE COM BILL 等）になるため、
//   金額が登録額と一致すればそのサブスクの請求とみなし、一致しない
//   金額は「支払日（日）」が最も近い登録サブスクへ寄せて判定する。
// ・Google系は GOOGLE*CLOUD（APIクレジット）を除外する。
// ・返金行（タイトルに「返金」）と300円未満の少額は対象外。
// ・同じ（サブスク, 金額）へのアラートは1回だけ。
const SUB_CHANNELS = [
  { key: 'claude-direct', re: /claude/i, subs: ['Claude Pro', 'Muse Power'] },
  { key: 'google', re: /google/i, exclude: /cloud/i, subs: ['Google AI Pro', 'Google AI Plus'] },
  { key: 'apple', re: /apple/i, subs: ['Apple One', 'Claude Pro', 'Muse Power'] },
  { key: 'goodnotes', re: /goodnotes/i, subs: ['Goodnotes'] }
];

function matchChannel(title) {
  for (const ch of SUB_CHANNELS) {
    if (ch.re.test(title) && !(ch.exclude && ch.exclude.test(title))) return ch;
  }
  return null;
}

// 登録サブスク items と家計簿明細 months から検知する純粋関数。
// state: {seen: {key:true}, lastNormal: {subId: {amount, date}}}
// opts.alertAfter: この日付（YYYY-MM-DD）より前の不一致は「既知」として
// seen に入れるだけでアラートにしない（初回に過去分で誤検知しないため）。
// 戻り値: {alerts: [新規アラート], state}
function detectSubsPriceAlerts(items, monthsMap, state, opts) {
  const alertAfter = (opts && opts.alertAfter) || '9999-99-99';
  const st = state && typeof state === 'object' ? state : {};
  if (!st.seen || typeof st.seen !== 'object') st.seen = {};
  if (!st.lastNormal || typeof st.lastNormal !== 'object') st.lastNormal = {};
  const subs = (Array.isArray(items) ? items : []).filter(s => s && s.name && Number(s.amount) > 0);
  const alerts = [];
  const months = Object.keys(monthsMap || {}).sort();
  for (const ym of months) {
    const txs = Array.isArray(monthsMap[ym]) ? monthsMap[ym] : [];
    for (const tx of txs) {
      if (!tx || tx.io !== 'out') continue;
      const title = String(tx.title || '');
      const amount = Number(tx.amount) || 0;
      if (amount < 300) continue;
      if (title.includes('返金')) continue;
      const ch = matchChannel(title);
      if (!ch) continue;
      const candidates = subs.filter(s => ch.subs.includes(s.name));
      if (!candidates.length) continue;
      const exact = candidates.find(s => Number(s.amount) === amount);
      if (exact) { st.lastNormal[exact.id] = { amount, date: tx.date }; continue; }
      // 金額が一致しない: 支払日（日）が最も近い候補に寄せる
      const txDay = Number(String(tx.date || '').slice(8, 10)) || 0;
      let best = null, bestDist = 99;
      for (const s of candidates) {
        const nd = s.nextDate ? Number(String(s.nextDate).slice(8, 10)) : 0;
        if (!nd) continue;
        const dist = Math.min(Math.abs(nd - txDay), 31 - Math.abs(nd - txDay));
        if (dist < bestDist) { bestDist = dist; best = s; }
      }
      if (!best || bestDist > 4) continue; // 寄せ先が曖昧なら誤検知を避けて見送る
      const key = best.id + ':' + amount;
      if (st.seen[key]) continue;
      st.seen[key] = true;
      if (String(tx.date || '') < alertAfter) continue; // 古い不一致は既知扱い（初回の誤検知防止）
      alerts.push({
        id: 'sub-' + key + '-' + tx.date,
        kind: 'subs-price',
        subName: best.name,
        registeredAmount: Number(best.amount),
        chargedAmount: amount,
        diff: amount - Number(best.amount),
        date: tx.date,
        title,
        at: new Date().toISOString(),
        read: false
      });
    }
  }
  return { alerts, state: st };
}

async function runSubsCheck() {
  const profile = await gen.getProfile();
  const items = profile?.moneySubs?.items || [];
  const money = await gen.getMoney();
  const monthsMap = money?.kakeibo?.months || {};
  const doc = await lib.fsGetJson(ALERTS_DOC, 'data', { alerts: [], state: {} }).catch(() => ({ alerts: [], state: {} }));
  const today = lib.todayJst();
  const alertAfter = gen.dateStrJst(new Date(Date.parse(today + 'T00:00:00Z') - 35 * 86400000));
  const { alerts: fresh, state } = detectSubsPriceAlerts(items, monthsMap, doc.state || {}, { alertAfter });
  const all = [...fresh, ...(Array.isArray(doc.alerts) ? doc.alerts : [])].slice(0, 30);
  await lib.fsSetJson(ALERTS_DOC, 'data', { alerts: all, state, checkedAt: new Date().toISOString() });
  let push = null;
  if (fresh.length) {
    const a = fresh[0];
    push = await lib.sendPushToAll({
      title: '🔁 サブスクの金額が変わったかも',
      body: `${a.subName}: 登録 ¥${a.registeredAmount.toLocaleString()} に対して ¥${a.chargedAmount.toLocaleString()} の請求がありました。アプリのホームで確認できます。`,
      url: '/', tag: 'juken-subs-price'
    });
  }
  return { fresh: fresh.length, push };
}

// ---------- 添削キュー（15・第3弾で追加） ----------
// アプリが live/essayQueue に積んだ投稿（status: 'pending'）を、
// この Cron 便（毎朝6:30）で最大3件まで添削して 'done' にする。
// アプリを開いている間の投稿はアプリ側が即時添削も試みるため、
// ここは「アプリを閉じても処理される」ための受け皿。
// プロンプトの文面はアプリ側（20-wave3.js の EssayUI.buildPrompt）と揃える。
const ESSAY_QUEUE_DOC = 'live/essayQueue';
const ESSAY_MAX_PER_RUN = 3;

function essayPrompt(kind, text) {
  return 'あなたは大学受験の指導者です。次の' + (kind === 'essay' ? '小論文' : '英作文') + 'を添削してください。\n'
    + '出力は次の形式で、日本語で書いてください:\n'
    + '【添削後の文】\n（添削した全文）\n'
    + '【指摘】\n（文法・語彙・構成の問題点を箇条書きで最大5つ）\n'
    + '【総評】\n（良い点と次に伸ばすべき点を2〜3文で）\n\n'
    + '--- 添削対象 ---\n' + text;
}

async function runEssays(generate) {
  const doc = await lib.fsGetJson(ESSAY_QUEUE_DOC, 'data', { items: [] });
  const items = Array.isArray(doc.items) ? doc.items : [];
  const pending = items.filter(i => i && i.status === 'pending').slice(0, ESSAY_MAX_PER_RUN);
  if (!pending.length) return { processed: 0 };
  let done = 0;
  for (const item of pending) {
    try {
      const text = await generate(essayPrompt(item.kind, String(item.text || '').slice(0, 4000)), { maxOutputTokens: 3072 });
      item.status = 'done';
      item.result = text;
      item.correctedAt = new Date().toISOString();
      item.correctedBy = 'cron';
      delete item.error;
      done++;
    } catch (e) {
      item.error = String(e?.message || e).slice(0, 200);
      item.attempts = (Number(item.attempts) || 0) + 1;
      if (item.attempts >= 3) item.status = 'failed';
    }
  }
  await lib.fsSetJson(ESSAY_QUEUE_DOC, 'data', { items: items.slice(0, 50), updatedAt: new Date().toISOString() });
  return { processed: pending.length, done };
}

// ---------- ハンドラ ----------
module.exports = async (req, res) => {
  try {
    if (!lib.cronAuthorized(req)) return lib.sendJson(res, 401, { error: 'unauthorized' });
    const qs = new URL(req.url, 'https://x').searchParams;
    const part = qs.get('part') || 'auto';
    const today = lib.todayJst();
    const isMonday = gen.jstNow().getUTCDay() === 1;
    const generate = (prompt, o) => gen.geminiGenerate(prompt, o);
    const out = { ok: true, date: today, parts: {} };

    const wantBriefing = part === 'all' || part === 'briefing' || part === 'auto';
    const wantWeekly = part === 'all' || part === 'weekly' || (part === 'auto' && isMonday);
    const wantChat = part === 'all' || part === 'chat' || (part === 'auto' && isMonday);
    const wantSubs = part === 'all' || part === 'subs' || part === 'auto';
    const wantEssays = part === 'all' || part === 'essays' || part === 'auto';

    if (wantBriefing) { try { out.parts.briefing = await runBriefing(today, generate); } catch (e) { out.parts.briefing = { error: String(e?.message || e) }; } }
    if (wantWeekly) { try { out.parts.weekly = await runWeekly(today, generate); } catch (e) { out.parts.weekly = { error: String(e?.message || e) }; } }
    if (wantChat) { try { out.parts.chat = await runChatSummary(generate); } catch (e) { out.parts.chat = { error: String(e?.message || e) }; } }
    if (wantSubs) { try { out.parts.subs = await runSubsCheck(); } catch (e) { out.parts.subs = { error: String(e?.message || e) }; } }
    if (wantEssays) { try { out.parts.essays = await runEssays(generate); } catch (e) { out.parts.essays = { error: String(e?.message || e) }; } }
    return lib.sendJson(res, 200, out);
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 60 };
module.exports.helpers = { gatherBriefingMaterials, briefingPrompt, studyLines, gatherWeeklyMaterials, weeklyPrompt, runBriefing, runWeekly, runChatSummary, detectSubsPriceAlerts, matchChannel, runSubsCheck, essayPrompt, runEssays, BRIEFING_DOC, WEEKLY_DOC, CHAT_SUMMARY_DOC, ALERTS_DOC, ESSAY_QUEUE_DOC };
