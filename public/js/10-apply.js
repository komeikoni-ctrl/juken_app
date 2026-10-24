// ============================================================
// 📮 出願管理
//  ・出願期間／受験日／合格発表／入学手続締切の一元管理
//  ・受験料の合計試算
//  ・受験日の重複チェック（併願プランの成立判定）
//  ・入試日程カレンダーへの自動反映
//  ・大学ごとの提出書類チェックリスト
//  ・AIによる空欄の自動調査（見つからない項目は追加で調べ直す）
// ============================================================

// 既定の提出書類。大学ごとに追加・削除できる
const DEFAULT_APP_DOCS = ['願書', '調査書', '写真', '検定料の払込証明', '志望理由書'];
const APP_METHODS = ['前期', '中期', '後期', '共テ利用', '推薦・総合型', 'その他'];

// 出願1件が持つ項目の定義。フォーム・一覧表示・AI調査・空欄チェックの全てがこれを参照する。
//   type     … date / number / url / (省略時は文字列)
//   optional … true なら「未入力」に数えない（無くても困らない項目）
//   examOnly … true なら個別試験が無い方式（共テ利用）では「未入力」に数えない
const APP_FIELDS = [
  { key: 'dep',               short: '学部・学科',     label: '学部・学科の正式名称',                                   el: 'app-dep' },
  { key: 'applyStart',        short: '出願開始',       label: '出願開始日',                                             el: 'app-apply-start',  type: 'date' },
  { key: 'applyEnd',          short: '出願締切',       label: '出願締切日',                                             el: 'app-apply-end',    type: 'date' },
  { key: 'applyNote',         short: '出願方法',       label: '出願方法（Web出願か郵送か、締切は必着か消印有効か）',     el: 'app-apply-note' },
  { key: 'examDate',          short: '受験日',         label: '受験日（個別試験の初日）',                               el: 'app-exam-date',    type: 'date', examOnly: true },
  { key: 'examDateEnd',       short: '受験最終日',     label: '受験最終日（試験が複数日にわたる場合のみ）',             el: 'app-exam-date-end', type: 'date', optional: true },
  { key: 'examTime',          short: '集合・試験時間', label: '集合時刻と試験の時間割',                                 el: 'app-exam-time',    examOnly: true },
  { key: 'subjects',          short: '試験科目・配点', label: '試験科目と配点（共通テストと個別試験それぞれ）',         el: 'app-subjects' },
  { key: 'resultDate',        short: '合格発表',       label: '合格発表日',                                             el: 'app-result-date',  type: 'date' },
  { key: 'procedureDeadline', short: '入学手続締切',   label: '入学手続の締切日',                                       el: 'app-procedure',    type: 'date' },
  { key: 'fee',               short: '受験料',         label: '検定料（受験料）',                                       el: 'app-fee',          type: 'number' },
  { key: 'enrollFee',         short: '入学金',         label: '入学金（入学手続時に納める額）',                         el: 'app-enroll-fee',   type: 'number' },
  { key: 'venue',             short: '会場',           label: '試験会場（キャンパス名・住所・最寄り駅からの行き方）',   el: 'app-venue',        examOnly: true },
  { key: 'url',               short: '要項URL',        label: '募集要項または入試情報ページのURL',                      el: 'app-url',          type: 'url' },
  { key: 'memo',              short: 'メモ',           label: '注意点（二段階選抜の有無と基準、外部検定の利用など）',   el: 'app-memo',         optional: true },
];
const APP_FIELD_BY_KEY = Object.fromEntries(APP_FIELDS.map(f => [f.key, f]));

const appById = (id) => (S.applications || []).find(a => a.id === id);
const appIsBlank = (v) => v == null || v === '' || v === 0 || v === '未設定';

// その出願で「埋まっているべき」項目（共テ利用は個別試験の項目を求めない）
const appRequiredFields = (method) => APP_FIELDS.filter(f => !f.optional && !(f.examOnly && method === '共テ利用'));
// まだ空欄の項目
const appBlankFields = (a) => appRequiredFields(a.method).filter(f => appIsBlank(a[f.key]));

// --- 受験料の合計 ---
const calcFeeTotal = () => (S.applications || []).reduce((sum, a) => sum + (+a.fee || 0), 0);
const yen = (n) => '¥' + (+n || 0).toLocaleString('ja-JP');

// --- 受験日の重複チェック ---
// 同じ日に2つ以上の受験が入っている＝併願プランが成立していない。
// 試験が複数日にわたる場合（examDateEnd あり）は、その全日程でぶつかりを見る。
const appExamDays = (a) => {
  if (!a.examDate) return [];
  const out = [a.examDate];
  if (a.examDateEnd && a.examDateEnd > a.examDate) {
    const d = DateManager.parseSafe(a.examDate);
    for (let i = 0; i < 10; i++) {   // 10日を超える試験は無いので打ち切る（誤入力での暴走防止）
      d.setDate(d.getDate() + 1);
      const s = DateManager.getTodayStr(d);
      if (s > a.examDateEnd) break;
      out.push(s);
    }
  }
  return out;
};
const findDateConflicts = () => {
  const byDate = {};
  (S.applications || []).forEach(a => {
    appExamDays(a).forEach(d => { (byDate[d] = byDate[d] || []).push(a); });
  });
  // soft = 「期間が重なっているだけ」。立命館の全学統一（2/1〜2/4）のように期間の中から受験日を選ぶ方式は、
  // 別の日を選べば両方受けられる。1日だけの試験が2つ以上ぶつかったときだけが、どちらかしか受けられない本当の重複。
  const isFixed = (a) => !a.examDateEnd || a.examDateEnd === a.examDate;
  return Object.keys(byDate).filter(d => byDate[d].length > 1).sort()
    .map(d => ({ date: d, items: byDate[d], soft: byDate[d].filter(isFixed).length < 2 }));
};

// 期間が重なるだけのものは、同じ組み合わせが何日も続くので1件（date〜to）にまとめる
const groupDateConflicts = (conflicts = findDateConflicts()) => {
  const rows = [];
  conflicts.forEach(c => {
    const key = c.items.map(i => i.id).sort().join('|');
    const last = rows[rows.length - 1];
    if (c.soft && last && last.soft && last.key === key) { last.to = c.date; return; }
    rows.push({ ...c, key, to: c.date });
  });
  return rows;
};

// --- 締切までの日数（負なら過ぎている） ---
const daysUntil = (dStr) => {
  if (!dStr) return null;
  const today = DateManager.parseSafe(DateManager.getTodayStr());
  const target = DateManager.parseSafe(dStr);
  return Math.round((target - today) / 86400000);
};

// --- 日程のつじつまチェック ---
// AIが年度を取り違えたり、順序がおかしい日付を返したりすることがあるので機械的に検査する
const appDateWarnings = (a) => {
  const w = [];
  const order = [['applyStart', '出願開始'], ['applyEnd', '出願締切'], ['examDate', '受験日'], ['resultDate', '合格発表'], ['procedureDeadline', '入学手続締切']];
  let prev = null;
  order.forEach(([k, label]) => {
    if (!a[k]) return;
    if (prev && a[k] < prev.v) w.push(`${label}（${a[k]}）が${prev.label}（${prev.v}）より前になっています`);
    prev = { v: a[k], label };
  });
  if (a.examDate && a.examDateEnd && a.examDateEnd < a.examDate) w.push('受験最終日が受験日より前になっています');
  // 入試年度の範囲（前年7月〜当年4月）から外れた日付は、年度違いの可能性が高い
  const y = AiService.admissionYear();
  const lo = `${y - 1}-07-01`, hi = `${y}-04-30`;
  order.forEach(([k, label]) => { if (a[k] && (a[k] < lo || a[k] > hi)) w.push(`${label}（${a[k]}）は${y}年度入試の時期から外れています。年度違いの可能性があります`); });
  return w;
};

// ============================================================
// 入試日程カレンダーへの自動反映
// ============================================================
// 出願データから作った予定には appId を付けておき、作り直すときに
// 古いものだけを消す（手で足した予定は消さない）。
// id は「出願ID＋種類」で固定にする。乱数だと、2台の端末で同時に反映したとき
// 同じ予定が二重に出来てしまう。
const APP_EVENT_KINDS = [
  { key: 'applyStart', label: '出願開始', icon: '📮' },
  { key: 'applyEnd',   label: '出願締切', icon: '⏰' },
  { key: 'examDate',   label: '受験日',   icon: '✏️' },
  { key: 'resultDate', label: '合格発表', icon: '🌸' },
  { key: 'procedureDeadline', label: '入学手続締切', icon: '🏫' },
];

const removeAppEvents = (appId) => {
  if (!Array.isArray(S.events)) S.events = [];
  S.events.filter(e => e.appId === appId).forEach(e => DbService.del('events', e.id));
  S.events = S.events.filter(e => e.appId !== appId);
};
const addAppEvents = (a) => {
  let added = 0;
  APP_EVENT_KINDS.forEach(k => {
    const d = a[k.key];
    if (!d) return;
    const range = (k.key === 'examDate' && a.examDateEnd && a.examDateEnd > a.examDate) ? `〜${a.examDateEnd.slice(5).replace('-', '/')}` : '';
    const ev = {
      id: `appev_${a.id}_${k.key}`, appId: a.id, kind: k.key,
      date: d,
      title: `${k.icon} ${a.name}（${a.method}）${k.label}${range}`,
      type: 'exam'
    };
    S.events.push(ev); DbService.set('events', ev); added++;
  });
  return added;
};
// すでにカレンダー反映を使っている人だけ、出願を直したときに予定も自動で追従させる
const refreshAppEventsIfUsed = (a) => {
  if (!(S.events || []).some(e => e.appId)) return;
  removeAppEvents(a.id);
  addAppEvents(a);
  if (typeof renderCal === 'function') renderCal();
};

window.syncApplicationEvents = async () => {
  if (!Array.isArray(S.events)) S.events = [];
  // 既存の自動生成イベントを削除
  S.events.filter(e => e.appId).forEach(e => DbService.del('events', e.id));
  S.events = S.events.filter(e => !e.appId);

  let added = 0;
  (S.applications || []).forEach(a => { added += addAppEvents(a); });
  if (typeof renderCal === 'function') renderCal();
  refreshAllViews();
  showToast(`📅 入試日程 ${added}件をカレンダーに反映しました`);
};

// ============================================================
// 描画
// ============================================================
// AI調査の進行状況（出願ID → 表示文言）。同期で一覧が描き直されてもボタンの表示が戻らないようにここで持つ
const _appAiBusy = new Map();
let _appAiBulkRunning = false;

window.renderApplications = () => {
  const el = document.getElementById('app-list');
  if (!el) return;
  const apps = [...(S.applications || [])].sort((a, b) => String(a.examDate || '9999').localeCompare(String(b.examDate || '9999')));
  renderFeeSummary();
  renderConflicts();
  renderDeadlineAlerts();
  renderAppAiBulk();

  if (!apps.length) { el.innerHTML = '<div class="empty">出願予定を追加してください</div>'; return; }

  el.innerHTML = apps.map(a => {
    const docs = Array.isArray(a.docs) ? a.docs : [];
    const doneCount = docs.filter(d => d.done).length;
    const applyLeft = daysUntil(a.applyEnd);
    const applyBadge = a.applyEnd
      ? (applyLeft < 0 ? '<span class="badge" style="background:var(--muted);color:#fff">出願終了</span>'
        : applyLeft <= 7 ? `<span class="badge" style="background:var(--a2);color:#fff">出願締切まで${applyLeft}日</span>`
        : `<span class="badge bb">出願締切まで${applyLeft}日</span>`)
      : '';
    const aiSet = new Set(a.aiFields || []);
    const ai = (key) => aiSet.has(key) ? ' <span title="AIが入力した値です。出典で確認してください" style="font-size:10px">🤖</span>' : '';
    const line = (label, val, key) => val ? `<div><span style="color:var(--muted)">${label}</span> ${esc(val)}${key ? ai(key) : ''}</div>` : '';
    const examRange = a.examDate ? (a.examDateEnd && a.examDateEnd > a.examDate ? `${a.examDate} 〜 ${a.examDateEnd}` : a.examDate) : '';
    const url = safeUrl(a.url);
    const blanks = appBlankFields(a);
    const warns = appDateWarnings(a);
    const busy = _appAiBusy.get(a.id);
    return `<div class="note-item">
      <div class="flex-between" style="margin-bottom:4px">
        <strong style="font-size:14px">${esc(a.name)}</strong>
        <span class="badge bb">${esc(a.methodLabel || a.method)}</span>
      </div>
      <div class="row-sub" style="margin-bottom:6px">${esc(a.dep || '学部未設定')}${ai('dep')}　${applyBadge}</div>
      <div style="font-size:12px;line-height:1.8">
        ${line('📮 出願', [a.applyStart, a.applyEnd].filter(Boolean).join(' 〜 '), aiSet.has('applyStart') ? 'applyStart' : 'applyEnd')}
        ${line('📨 出願方法', a.applyNote, 'applyNote')}
        ${line('✏️ 受験日', examRange, 'examDate')}
        ${line('🕘 時間', a.examTime, 'examTime')}
        ${line('📚 科目・配点', a.subjects, 'subjects')}
        ${line('🌸 発表', a.resultDate, 'resultDate')}
        ${line('🏫 手続締切', a.procedureDeadline, 'procedureDeadline')}
        ${line('📍 会場', a.venue, 'venue')}
        ${line('💴 受験料', a.fee ? yen(a.fee) + (a.feePaid ? '（支払済）' : '') : '', 'fee')}
        ${line('🎓 入学金', a.enrollFee ? yen(a.enrollFee) : '', 'enrollFee')}
        ${url ? `<div><span style="color:var(--muted)">🔗 要項</span> <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);word-break:break-all">${esc(url.replace(/^https?:\/\//, '').slice(0, 60))}</a>${ai('url')}</div>` : ''}
        ${a.memo ? `<div style="color:var(--muted)">📝 ${esc(a.memo)}${ai('memo')}</div>` : ''}
      </div>
      ${warns.length ? `<div style="font-size:11px;color:var(--a2);margin-top:6px">${warns.map(w => '⚠️ ' + esc(w)).join('<br>')}</div>` : ''}
      ${blanks.length
        ? `<div style="font-size:11px;color:#b45309;margin-top:6px">❓ 未入力（${blanks.length}）: ${blanks.map(f => esc(f.short)).join('、')}</div>`
        : '<div style="font-size:11px;color:var(--muted);margin-top:6px">✅ すべての項目が入力済み</div>'}
      ${aiSet.size ? `<div style="margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(255,149,0,.10)">
          <div style="font-size:11px;font-weight:700;color:#b45309">🤖 印の${aiSet.size}項目はAIが入力しました${a.aiBasis ? '（' + esc(a.aiBasis) + '）' : ''}。必ず大学公式で確認してください</div>
          ${renderSourceChips(a.aiSources, '入試要項の出典' + (a.aiFetchedAt ? '・' + a.aiFetchedAt + '調査' : ''), '出典が取得できませんでした。AIの推測が含まれる可能性があります。')}
          <button class="btn btn-s btn-sm mt8" onclick="confirmAppAi('${a.id}')">✅ 公式で確認した（🤖印を外す）</button>
        </div>` : ''}
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px">📋 提出書類 ${doneCount}/${docs.length}</div>
        ${docs.map((d, i) => `<label style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;cursor:pointer">
            <input type="checkbox" ${d.done ? 'checked' : ''} onchange="toggleAppDoc('${a.id}',${i},this.checked)">
            <span style="${d.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(d.label)}</span>
            <button class="icon-btn" style="margin-left:auto" onclick="event.preventDefault();removeAppDoc('${a.id}',${i})">×</button>
          </label>`).join('')}
        <div style="display:flex;gap:6px;margin-top:6px">
          <input type="text" id="newdoc-${a.id}" placeholder="書類を追加..." style="flex:1;margin:0;font-size:12px">
          <button class="btn btn-s btn-sm" onclick="addAppDoc('${a.id}')">＋</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-s btn-sm" onclick="openAppEdit('${a.id}')">編集</button>
        <button class="btn btn-s btn-sm" ${busy || _appAiBulkRunning ? 'disabled' : ''} onclick="aiFillSaved('${a.id}')">${busy ? esc(busy) : (blanks.length ? `🔍 AIで空欄${blanks.length}件を埋める` : '🔄 AIで調べ直す')}</button>
        <button class="btn btn-s btn-sm" style="color:var(--a2)" onclick="removeApplication('${a.id}')">削除</button>
      </div>
    </div>`;
  }).join('');
};

// 一覧の上に出す「まとめてAIで埋める」カード
const renderAppAiBulk = () => {
  const el = document.getElementById('app-ai-bulk');
  if (!el) return;
  const apps = S.applications || [];
  if (!apps.length) { el.innerHTML = '<div class="empty">出願を追加すると、日程・受験料・会場・科目などの空欄をAIがまとめて調べます</div>'; return; }
  const targets = apps.filter(a => appBlankFields(a).length);
  const blankTotal = targets.reduce((s, a) => s + appBlankFields(a).length, 0);
  el.innerHTML = blankTotal
    ? `<p style="font-size:12px;color:var(--muted);margin-bottom:10px">${targets.length}件の出願に、未入力の項目が合計 <strong style="color:#b45309">${blankTotal}</strong> 個あります。AIがWeb検索で調べ、見つからない項目は情報源を変えて調べ直します（1件あたり30秒〜1分半）。</p>
       <button class="btn btn-p btn-sm btn-full" id="app-ai-bulk-btn" ${_appAiBulkRunning ? 'disabled' : ''} onclick="aiFillAllApplications()">${_appAiBulkRunning ? '🔍 調査中...' : '🔍 すべての空欄をAIに調べてもらう'}</button>`
    : '<div style="font-size:12px;color:var(--muted)">✅ すべての出願で、必要な項目が入力済みです</div>';
};

const renderFeeSummary = () => {
  const el = document.getElementById('app-fee-summary');
  if (!el) return;
  const apps = S.applications || [];
  if (!apps.length) { el.innerHTML = '<div class="empty">出願を登録すると受験料の合計が出ます</div>'; return; }
  const byMethod = {};
  apps.forEach(a => { byMethod[a.method] = (byMethod[a.method] || 0) + (+a.fee || 0); });
  const paid = apps.filter(a => a.feePaid).reduce((s, a) => s + (+a.fee || 0), 0);
  const total = calcFeeTotal();
  const noFee = apps.filter(a => !(+a.fee > 0)).length;
  el.innerHTML = `
    <div style="font-size:13px;margin-bottom:6px">受験料 合計 <strong style="font-size:22px;color:var(--accent)">${yen(total)}</strong></div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${apps.length}件${paid ? ` ／ 支払済 ${yen(paid)} ／ 未払 ${yen(total - paid)}` : ''}${noFee ? ` ／ ⚠️ 受験料が未入力の出願が${noFee}件あります（合計に含まれていません）` : ''}</div>
    ${Object.keys(byMethod).sort().map(m => `<div class="row" style="padding:4px 0"><div class="row-sub">${esc(m)}</div><strong style="font-size:13px">${yen(byMethod[m])}</strong></div>`).join('')}`;
};

const renderConflicts = () => {
  const el = document.getElementById('app-conflicts');
  if (!el) return;
  const conflicts = findDateConflicts();
  if (!conflicts.length) {
    const withDate = (S.applications || []).filter(a => a.examDate).length;
    el.innerHTML = withDate
      ? '<div style="font-size:12px;color:var(--muted)">✅ 受験日の重複はありません（' + withDate + '件を確認）</div>'
      : '<div style="font-size:12px;color:var(--muted)">受験日を入力すると重複を自動チェックします</div>';
    return;
  }
  const label = (i) => esc(i.name) + (i.dep ? ' ' + esc(String(i.dep).split(/\s+/)[0]) : '') + '（' + esc(i.methodLabel || i.method) + '）';
  const rows = groupDateConflicts(conflicts);
  el.innerHTML = rows.map(c => c.soft ? `
    <div class="row" style="background:rgba(255,149,0,.10);border-radius:8px;padding:8px;margin-bottom:6px">
      <div>
        <div class="row-title" style="color:#b25e00">△ ${esc(c.date)}${c.to !== c.date ? '〜' + esc(c.to) : ''} は試験期間が重なっています</div>
        <div class="row-sub">${c.items.map(label).join(' / ')}</div>
        <div class="row-sub">期間の中から受験日を選べる方式なら、別の日を選べば両方受けられます。出願のときに日が重ならないようにしてください。</div>
      </div>
    </div>` : `
    <div class="row" style="background:rgba(255,59,48,.08);border-radius:8px;padding:8px;margin-bottom:6px">
      <div>
        <div class="row-title" style="color:var(--a2)">⚠️ ${esc(c.date)} に ${c.items.length}件が重複</div>
        <div class="row-sub">${c.items.map(label).join(' / ')}</div>
      </div>
    </div>`).join('');
};

// 出願締切・手続締切が近いものを警告する
const renderDeadlineAlerts = () => {
  const el = document.getElementById('app-alerts');
  if (!el) return;
  const alerts = [];
  (S.applications || []).forEach(a => {
    [['applyEnd', '出願締切'], ['procedureDeadline', '入学手続締切']].forEach(([key, label]) => {
      const d = daysUntil(a[key]);
      if (d === null || d < 0 || d > 14) return;
      alerts.push({ d, text: `${a.name}（${a.method}）の${label}まであと ${d} 日` });
    });
  });
  if (!alerts.length) { el.style.display = 'none'; return; }
  alerts.sort((x, y) => x.d - y.d);
  el.style.display = 'block';
  el.innerHTML = alerts.map(a => `<div class="row" style="background:rgba(255,149,0,.12);border-radius:8px;padding:8px;margin-bottom:6px"><div class="row-title">⏰ ${esc(a.text)}</div></div>`).join('');
};

// ============================================================
// 追加・編集・削除
// ============================================================
// 編集モーダルでAI調査した結果の控え。保存時に「どの項目がAI入力か」を記録するために使う
let _appAiMeta = null;

window.openAppEdit = (id = '') => {
  const a = id ? appById(id) : null;
  _appAiMeta = null;
  document.getElementById('app-edit-id').value = id || '';
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v ?? ''; };
  set('app-name', a?.name);
  set('app-method', a?.method || '前期');
  APP_FIELDS.forEach(f => set(f.el, f.type === 'number' ? (a?.[f.key] || '') : a?.[f.key]));
  const paidEl = document.getElementById('app-fee-paid'); if (paidEl) paidEl.checked = !!a?.feePaid;
  const srcEl = document.getElementById('app-ai-sources'); if (srcEl) srcEl.innerHTML = '';
  const modal = document.getElementById('mo-app');
  const t = modal?.querySelector('.mo-title'); if (t) t.textContent = a ? '📮 出願情報を編集' : '📮 出願を追加';
  // 志望校リストから候補を出す（未登録の大学も手入力できる）
  const dl = document.getElementById('app-uni-options');
  if (dl) dl.innerHTML = (S.unis || []).map(u => `<option value="${esc(u.name)}">`).join('');
  showMo('mo-app');
};

window.saveApplication = () => {
  const id = document.getElementById('app-edit-id').value;
  const get = (elId) => (document.getElementById(elId)?.value || '').trim();
  const name = get('app-name');
  if (!name) { showToast('大学名を入力してください', 'warn'); return; }

  const existing = id ? appById(id) : null;
  const obj = { id: id || generateId(), name, method: get('app-method') || '前期' };
  APP_FIELDS.forEach(f => {
    const raw = get(f.el);
    obj[f.key] = f.type === 'number' ? (parseInt(raw, 10) || 0) : raw;
  });
  if (obj.applyStart && obj.applyEnd && obj.applyStart > obj.applyEnd) { showToast('出願開始日が締切より後になっています', 'warn'); return; }
  if (obj.examDate && obj.examDateEnd && obj.examDateEnd < obj.examDate) { showToast('受験最終日が受験日より前になっています', 'warn'); return; }
  if (obj.url && !safeUrl(obj.url)) { showToast('URLは http:// または https:// から始めてください', 'warn'); return; }
  obj.feePaid = !!document.getElementById('app-fee-paid')?.checked;

  // 提出書類：既存のチェック状態は保ち、AIが見つけた書類で足りないものだけ追加する
  const meta = _appAiMeta;
  let docs = existing?.docs ? existing.docs.map(d => ({ ...d })) : null;
  if (!docs) docs = (meta?.docs?.length ? meta.docs : DEFAULT_APP_DOCS).map(l => ({ label: l, done: false }));
  else if (meta?.docs?.length) mergeAppDocs(docs, meta.docs);
  obj.docs = docs;

  // AIが入れた値のまま保存された項目だけを「🤖 AI入力」として記録する（手で直した項目は外す）
  const prevAi = existing?.aiFields || [];
  obj.aiFields = APP_FIELDS.map(f => f.key).filter(k => !appIsBlank(obj[k]) && (
    (meta && meta.values[k] !== undefined && String(obj[k]) === String(meta.values[k])) ||
    (existing && prevAi.includes(k) && String(obj[k]) === String(existing[k]))
  ));
  obj.aiSources = meta?.sources?.length ? meta.sources : (existing?.aiSources || []);
  obj.aiFetchedAt = meta ? meta.fetchedAt : (existing?.aiFetchedAt || '');
  obj.aiBasis = meta ? (meta.basis || '') : (existing?.aiBasis || '');

  if (!Array.isArray(S.applications)) S.applications = [];
  if (existing) Object.assign(existing, obj);
  else S.applications.push(obj);
  DbService.set('applications', existing || obj);
  refreshAppEventsIfUsed(existing || obj);
  _appAiMeta = null;
  closeMo('mo-app');
  window.renderApplications();

  // 受験日が他とぶつかっていたらその場で知らせる
  const clash = findDateConflicts().find(c => c.items.some(i => i.id === obj.id));
  if (clash) showToast(clash.soft ? `△ ${clash.date} は他の受験と試験期間が重なっています（別の日を選べるか確認を）` : `⚠️ ${clash.date} は他の受験と重複しています`, 'warn', 5000);
  else showToast('📮 出願情報を保存しました');
};

window.removeApplication = (id) => {
  const a = appById(id); if (!a) return;
  showConfirm('🗑 出願を削除', `「${a.name}（${a.method}）」を削除しますか？`, '削除する', () => {
    Trash.push('applications', a);
    DbService.del('applications', id);
    S.applications = S.applications.filter(x => x.id !== id);
    // 紐づく自動生成イベントも消す
    removeAppEvents(id);
    window.renderApplications(); if (typeof renderCal === 'function') renderCal();
    showToast('削除しました（ゴミ箱から30日以内に復元できます）');
  });
};

// --- 提出書類チェックリスト ---
window.toggleAppDoc = (id, idx, checked) => {
  const a = appById(id); if (!a || !a.docs?.[idx]) return;
  a.docs[idx].done = checked;
  DbService.set('applications', a);
  window.renderApplications();
};
window.addAppDoc = (id) => {
  const a = appById(id); if (!a) return;
  const el = document.getElementById('newdoc-' + id);
  const label = (el?.value || '').trim();
  if (!label) return;
  if (!Array.isArray(a.docs)) a.docs = [];
  a.docs.push({ label, done: false });
  DbService.set('applications', a);
  window.renderApplications();
};
window.removeAppDoc = (id, idx) => {
  const a = appById(id); if (!a || !a.docs) return;
  a.docs.splice(idx, 1);
  DbService.set('applications', a);
  window.renderApplications();
};
window.confirmAppAi = (id) => {
  const a = appById(id); if (!a) return;
  a.aiFields = [];
  DbService.set('applications', a);
  window.renderApplications();
  showToast('✅ 確認済みにしました');
};

// AIが見つけた書類のうち、まだリストに無いものだけを足す（チェック済みの状態は触らない）
const mergeAppDocs = (docs, aiDocs) => {
  const norm = (s) => normalizeForSearch(s);
  let added = 0;
  aiDocs.forEach(l => {
    if (docs.some(d => norm(d.label) === norm(l))) return;
    docs.push({ label: l, done: false }); added++;
  });
  return added;
};
// 書類リストが初期値のまま手付かずか（その場合はAIの結果で置き換えてよい）
const appDocsUntouched = (docs) => Array.isArray(docs) && docs.length === DEFAULT_APP_DOCS.length
  && docs.every((d, i) => !d.done && d.label === DEFAULT_APP_DOCS[i]);

// ============================================================
// 🤖 AIに出願情報を調べてもらう
// ============================================================
const APP_METHOD_QUERY = {
  '前期': '一般選抜 前期日程', '中期': '一般選抜 中期日程', '後期': '一般選抜 後期日程',
  '共テ利用': '大学入学共通テスト利用選抜', '推薦・総合型': '学校推薦型選抜・総合型選抜', 'その他': ''
};

// AIの返した値を項目の型に合わせて検査・整形する。おかしな値は空にして採用しない
const normalizeAppAiValue = (f, v) => {
  if (v == null) return '';
  if (f.type === 'date') {
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    // 2月30日のような存在しない日付を弾く
    return DateManager.getTodayStr(DateManager.parseSafe(s)) === s ? s : '';
  }
  if (f.type === 'number') {
    const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
    return n > 0 && n < 10000000 ? n : '';
  }
  if (f.type === 'url') return safeUrl(v);
  const s = String(v).trim();
  return /^(不明|未定|なし|見つから|該当なし|n\/?a|-|—)/i.test(s) ? '' : s.slice(0, 400);
};

// 1件ぶんの調査。{ values, docs, sources, basis, missing } を返す
const researchApplication = async ({ name, dep, method }, onProgress) => {
  const year = AiService.admissionYear();
  const required = {};
  appRequiredFields(method).forEach(f => { required[f.key] = f.label; });
  required.docs = '出願に必要な提出書類の一覧';
  const noExam = method === '共テ利用';

  const question = `${name} ${dep || ''}（${APP_METHOD_QUERY[method] || method}）の${year}年度（${year}年4月入学）入学者選抜について、`
    + `大学公式サイトの募集要項・入学者選抜要項・入試情報ページを最優先に、大学受験パスナビ・Kei-Netなども使って調べてください。\n`
    + `知りたい項目は次のとおりです。1つずつ、分かったこと・どのサイトに書いてあったかを説明してください。\n`
    + APP_FIELDS.filter(f => !(noExam && f.examOnly)).map((f, i) => `${i + 1}. ${f.label}`).join('\n')
    + `\n${APP_FIELDS.length + 1}. 出願に必要な提出書類（調査書、写真、志望理由書、英語外部検定のスコア証明など、この方式で実際に必要なもの）\n`
    + `${APP_FIELDS.length + 2}. その情報が「${year}年度の確定情報」か「前年度（${year - 1}年度）実績」かの区別\n\n`
    + (dep ? '' : `学部・学科が指定されていないので、この生徒の志望（下の全データ参照）に最も合う学部・学科を1つ選び、正式名称を答えてください。\n`)
    + (noExam ? `この方式で大学独自の個別試験が無い場合、受験日・集合時間・会場は不要です（その旨を注意点に書いてください）。\n` : '')
    + `国公立大学の検定料は通常17,000円、入学金は282,000円が標準ですが、必ずその大学の値を確認してください。`;

  const format = '{"dep":"学部・学科の正式名称","applyStart":"YYYY-MM-DD","applyEnd":"YYYY-MM-DD","applyNote":"Web出願＋書類郵送（必着）など",'
    + '"examDate":"YYYY-MM-DD","examDateEnd":"YYYY-MM-DD（試験が1日だけなら空文字）","examTime":"集合時刻と時間割","subjects":"試験科目と配点",'
    + '"resultDate":"YYYY-MM-DD","procedureDeadline":"YYYY-MM-DD","fee":17000,"enrollFee":282000,"venue":"会場名・住所・アクセス",'
    + '"url":"https://で始まる募集要項や入試情報ページのURL","memo":"二段階選抜の有無と基準、外部検定の扱いなどの注意点（100字以内）",'
    + `"docs":["調査書","写真"],"basis":"${year}年度確定 または ${year - 1}年度実績（項目ごとに違う場合は内訳を短く）"}`;

  const { data, sources, missing } = await AiService.researchJson({
    question, format, required, withContext: true, maxRounds: 2, onProgress
  });

  const values = {};
  APP_FIELDS.forEach(f => {
    const v = normalizeAppAiValue(f, data?.[f.key]);
    if (!appIsBlank(v)) values[f.key] = v;
  });
  if (values.examDateEnd && (!values.examDate || values.examDateEnd <= values.examDate)) delete values.examDateEnd;
  const docs = (Array.isArray(data?.docs) ? data.docs : [])
    .map(d => String(d ?? '').trim().slice(0, 40)).filter(Boolean)
    .filter((d, i, arr) => arr.indexOf(d) === i).slice(0, 15);
  return {
    values, docs, sources: (sources || []).slice(0, 8),
    basis: String(data?.basis || '').slice(0, 60),
    missing: (missing || []).filter(k => k !== 'docs' && values[k] === undefined).map(k => APP_FIELD_BY_KEY[k]?.short || k)
  };
};

// --- 編集モーダル内：フォームの空欄をAIで埋める ---
window.aiFillApplication = async () => {
  const val = (elId) => (document.getElementById(elId)?.value || '').trim();
  const name = val('app-name');
  if (!name) { showToast('先に大学名を入力してください', 'warn'); return; }
  const btn = document.getElementById('app-ai-btn');
  const srcEl = document.getElementById('app-ai-sources');
  const orig = btn ? btn.textContent : '';
  if (btn) btn.disabled = true;
  const progress = (t) => { if (btn) btn.textContent = t; };
  progress('🔍 Web検索中...');
  try {
    const r = await researchApplication({ name, dep: val('app-dep'), method: val('app-method') || '前期' }, progress);
    // 調査中にモーダルを閉じて別の出願を開いていたら、その出願に書き込まない
    if (val('app-name') !== name) return;

    const filled = [], diffs = [];
    APP_FIELDS.forEach(f => {
      const v = r.values[f.key];
      if (v === undefined) return;
      const el = document.getElementById(f.el);
      if (!el) return;
      const cur = el.value.trim();
      if (appIsBlank(cur) || (f.type === 'number' && !(+cur > 0))) { el.value = v; filled.push(f); }
      else if (String(cur) !== String(v)) diffs.push({ f, cur, v });
    });
    _appAiMeta = { values: r.values, docs: r.docs, sources: r.sources, basis: r.basis, fetchedAt: DateManager.getTodayStr() };

    // つじつまチェックはフォームの現在値で行う
    const snapshot = {}; APP_FIELDS.forEach(f => { snapshot[f.key] = val(f.el); });
    const warns = appDateWarnings(snapshot);

    if (srcEl) {
      srcEl.innerHTML = '<div style="font-size:11px;color:var(--a2);font-weight:700;margin:8px 0 4px">⚠️ 日程を間違えると取り返しがつきません。保存前に必ず出典（大学公式）で確認してください</div>'
        + `<div style="font-size:11px;line-height:1.7">`
        + (filled.length ? `<div>✅ AIが入力（${filled.length}）: ${filled.map(f => esc(f.short)).join('、')}</div>` : '<div>入力できる空欄はありませんでした</div>')
        + (r.docs.length ? `<div>📋 提出書類 ${r.docs.length}件を保存時に反映: ${r.docs.map(esc).join('、')}</div>` : '')
        + (r.missing.length ? `<div style="color:#b45309">❓ 調べ直しても見つからなかった項目: ${r.missing.map(esc).join('、')}（募集要項の公表前の可能性があります）</div>` : '')
        + (r.basis ? `<div style="color:var(--muted)">📅 情報の年度: ${esc(r.basis)}</div>` : '')
        + warns.map(w => `<div style="color:var(--a2)">⚠️ ${esc(w)}</div>`).join('')
        + diffs.map(d => `<div style="color:var(--muted)">↔ ${esc(d.f.short)}: 入力済み「${esc(d.cur)}」／AI調査「${esc(d.v)}」 <button class="btn btn-s btn-sm" style="padding:2px 8px;font-size:11px" onclick="applyAppAiValue('${d.f.key}',this)">AIの値にする</button></div>`).join('')
        + `</div>` + renderSourceChips(r.sources, '入試要項の出典');
    }
    showToast(filled.length ? `${filled.length}項目を入力しました。内容を確認してから保存してください` : '新しく入力できる項目はありませんでした', 'warn', 5000);
  } catch (e) {
    showToast('❌ 取得失敗: ' + e.message, 'error', 5000);
  } finally { if (btn) { btn.textContent = orig; btn.disabled = false; } }
};

// 入力済みの値とAIの値が食い違ったとき、AIの値に差し替える
window.applyAppAiValue = (key, btnEl) => {
  const f = APP_FIELD_BY_KEY[key];
  const v = _appAiMeta?.values?.[key];
  const el = f && document.getElementById(f.el);
  if (!el || v === undefined) return;
  el.value = v;
  if (btnEl) { btnEl.textContent = '✓ 反映済み'; btnEl.disabled = true; }
};

// --- 一覧から：保存済みの出願の空欄をAIで埋める ---
// 入力済みの項目は書き換えない（本人が公式で確認して入れた値を壊さないため）
window.aiFillSaved = async (id, { quiet = false } = {}) => {
  const a0 = appById(id); if (!a0) return null;
  if (_appAiBusy.has(id)) return null;
  const progress = (t) => { _appAiBusy.set(id, t); window.renderApplications(); };
  progress('🔍 Web検索中...');
  try {
    const r = await researchApplication({ name: a0.name, dep: appIsBlank(a0.dep) ? '' : a0.dep, method: a0.method }, progress);
    // 調査中に同期で配列が差し替わることがあるので、取り直してから書き込む
    const a = appById(id);
    if (!a) return null;
    const filled = [];
    APP_FIELDS.forEach(f => {
      const v = r.values[f.key];
      if (v === undefined || !appIsBlank(a[f.key])) return;
      a[f.key] = v; filled.push(f);
    });
    let docsAdded = 0;
    if (r.docs.length) {
      if (appDocsUntouched(a.docs) || !Array.isArray(a.docs) || !a.docs.length) { a.docs = r.docs.map(l => ({ label: l, done: false })); docsAdded = r.docs.length; }
      else docsAdded = mergeAppDocs(a.docs, r.docs);
    }
    if (filled.length) {
      a.aiFields = [...new Set([...(a.aiFields || []), ...filled.map(f => f.key)])];
      a.aiSources = r.sources; a.aiFetchedAt = DateManager.getTodayStr(); a.aiBasis = r.basis;
    }
    if (filled.length || docsAdded) { DbService.set('applications', a); refreshAppEventsIfUsed(a); }
    if (!quiet) {
      const stillBlank = appBlankFields(a).map(f => f.short);
      showToast(filled.length || docsAdded
        ? `🤖 ${a.name}: ${filled.length}項目${docsAdded ? '＋書類' + docsAdded + '件' : ''}を入力しました${stillBlank.length ? '（未発見: ' + stillBlank.join('、') + '）' : ''}。必ず出典で確認してください`
        : `${a.name}: 新しく見つかった情報はありませんでした${stillBlank.length ? '（未発見: ' + stillBlank.join('、') + '）' : ''}`,
        'warn', 7000);
    }
    return { filled: filled.length, docsAdded };
  } catch (e) {
    if (!quiet) showToast(`❌ ${a0.name}: 取得失敗: ${e.message}`, 'error', 5000);
    return { error: e.message };
  } finally {
    _appAiBusy.delete(id);
    window.renderApplications();
  }
};

// --- 空欄のある出願をまとめて調べる（APIの回数制限に当たらないよう1件ずつ順番に） ---
window.aiFillAllApplications = () => {
  if (_appAiBulkRunning) return;
  const targets = (S.applications || []).filter(a => appBlankFields(a).length).map(a => a.id);
  if (!targets.length) { showToast('空欄のある出願はありません'); return; }
  showConfirm('🤖 AIでまとめて調査', `${targets.length}件の出願の空欄をAIがWeb検索で調べます。入力済みの項目は書き換えません。\n${targets.length}件で数分かかることがあります。`, '調べる', async () => {
    _appAiBulkRunning = true;
    let filled = 0, failed = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (!appById(targets[i])) continue;
        const r = await window.aiFillSaved(targets[i], { quiet: true });
        if (r?.error) {
          failed++;
          // 回数制限に当たったら、続けても全部失敗するのでそこで止める
          if (/利用制限|回数/.test(r.error)) { showToast('⏳ APIの利用制限に達したため中断しました。1分ほど待ってからもう一度押してください', 'warn', 7000); break; }
        } else filled += r?.filled || 0;
      }
    } finally {
      _appAiBulkRunning = false;
      window.renderApplications();
    }
    const left = (S.applications || []).reduce((s, a) => s + appBlankFields(a).length, 0);
    showToast(`🤖 ${filled}項目を入力しました${failed ? `（${failed}件は取得失敗）` : ''}${left ? `。まだ${left}項目が未発見です（募集要項の公表後にもう一度お試しください）` : ''}。🤖印の項目は必ず出典で確認してください`, 'warn', 9000);
  });
};
