// ============================================================
// 🎯 私大一般入試の合格ラインチェック ＋ 📝 過去問の記録
// ============================================================
// 志望校タブの「共通テスト 合格可能性シミュレーター」は共テの科目と配点で計算するので、
// 同志社・立命館・近大の一般入試（英語・国語・選択の3教科）には使えない。
// ここでは出願プラン（13-exam-plan.js）の方式ごとの配点と、2026年度の合格最低点（大学公式の入試結果）で判定する。
//
// ⚠️ 合格最低点は年度によって上下する。同志社は選択科目の得点調整もある。目安として使うこと。
// ============================================================

// 方式ごとの配点と2026年度の合格最低点。キーは EXAM_PLAN.entries の key。
// 値は 13-exam-plan.js の subjects・memo に書いた公式の数字と同じもの。
// 共テ利用の方式は共テの得点率で決まるので、ここには入れない（志望校タブの共テシミュレーターで見る）。
const EXAM_SCORING = {
  'doshisha-econ-zen':     { parts: { en: 200, jp: 150, sel: 150 }, min: 361, engMin: 80 },
  'doshisha-econ-kobetsu': { parts: { en: 200, jp: 150, sel: 150 }, min: 345, engMin: 80 },
  'doshisha-com-zen':      { parts: { en: 200, jp: 150, sel: 150 }, min: 377 },
  'doshisha-com-kobetsu':  { parts: { en: 200, jp: 150, sel: 150 }, min: 377 },
  'rits-econ-zengaku':     { parts: { en: 120, jp: 100, sel: 100 }, min: 192 },
  'rits-econ-kobetsu':     { parts: { en: 100, jp: 100, ma: 150 },  min: 245 },
  'rits-keiei-zengaku':    { parts: { en: 120, jp: 100, sel: 100 }, min: 213 },
  // 近大は試験日（2026年度は1/24と1/25）ごとに最低点が違う。厳しめに高い方で判定する
  'kindai-econ-zenkiA':    { parts: { en: 100, jp: 100, sel: 100 }, min: 193, minNote: '186〜193点の高い方' },
  'kindai-com-zenkiA':     { parts: { en: 100, jp: 100, sel: 100 }, min: 196, minNote: '194〜196点の高い方' },
  'kindai-econ-zenkiB':    { parts: { en: 100, jp: 100, sel: 100 }, min: null }
};
const PRIV_SUBJ = { en: '英語', jp: '国語', sel: '選択（地歴・公民）', ma: '数学' };
const PRIV_SUBJ_SHORT = { en: '英', jp: '国', sel: '選', ma: '数' };

const privEntry = (key) => (typeof EXAM_PLAN !== 'undefined' ? EXAM_PLAN.entries.find(e => e.key === key) : null);
const privLabel = (e) => `${e.name.replace('大学', '')} ${e.dep.split(/\s+/)[0]}`;
const privMd = (d) => { const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${+m[1]}/${+m[2]}` : ''; };

// 得点率（%）から、ある方式での予想得点と判定を出す。画面にもセルフテストにも使う
const privEstimate = (rates, sc) => {
  const parts = Object.keys(sc.parts).map(k => {
    const max = sc.parts[k];
    const rate = Math.max(0, Math.min(100, Number(rates?.[k]) || 0));
    return { k, max, pts: Math.round(rate / 100 * max) };
  });
  const score = parts.reduce((s, p) => s + p.pts, 0);
  const max = parts.reduce((s, p) => s + p.max, 0);
  const en = parts.find(p => p.k === 'en');
  const engFail = !!(sc.engMin && en && en.pts < sc.engMin);
  const diff = sc.min != null ? score - sc.min : null;
  const diffPct = diff != null ? Math.round(diff / max * 1000) / 10 : null;
  // ◎＝最低点を満点の5%以上上回る／○＝上回る／△＝5%以内の不足／✕＝それ以上の不足か英語の基準点割れ
  const grade = engFail ? '✕' : diffPct == null ? '—' : diffPct >= 5 ? '◎' : diffPct >= 0 ? '○' : diffPct >= -5 ? '△' : '✕';
  return { parts, score, max, diff, diffPct, engFail, grade };
};

// 過去問1回分の採点結果。合格最低点を入れていなければ2026年度の値で比べる
const pastResult = (r) => {
  const sc = EXAM_SCORING[r.key];
  if (!sc) return null;
  const parts = Object.keys(sc.parts).map(k => ({ k, max: sc.parts[k], pts: r.scores?.[k] != null && r.scores[k] !== '' ? Number(r.scores[k]) : null }));
  const filled = parts.filter(p => p.pts != null);
  const score = filled.reduce((s, p) => s + p.pts, 0);
  const max = parts.reduce((s, p) => s + p.max, 0);
  const complete = filled.length === parts.length;
  const min = r.min != null && r.min !== '' ? Number(r.min) : sc.min;
  const minAssumed = !(r.min != null && r.min !== '');
  const en = parts.find(p => p.k === 'en');
  const engFail = !!(sc.engMin && en && en.pts != null && en.pts < sc.engMin);
  const diff = complete && min != null ? score - min : null;
  const diffPct = diff != null ? Math.round(diff / max * 1000) / 10 : null;
  // 得点率は全科目そろったときだけ出す（一部の科目だけで満点に対する率を出すと不当に低く見える）
  return { sc, parts, score, max, complete, min, minAssumed, engFail, diff, diffPct, pct: complete ? Math.round(score / max * 100) : null };
};

// 科目ごとに、直近 n 回の過去問の得点率（%）を平均する。記録のない科目は入れない
const pastAvgRates = (records, n = 3) => {
  const sorted = [...(records || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const out = {};
  Object.keys(PRIV_SUBJ).forEach(k => {
    const rates = [];
    for (const r of sorted) {
      const sc = EXAM_SCORING[r.key];
      if (!sc || !sc.parts[k]) continue;
      const v = r.scores?.[k];
      if (v == null || v === '' || isNaN(Number(v))) continue;
      rates.push(Number(v) / sc.parts[k] * 100);
      if (rates.length >= n) break;
    }
    if (rates.length) out[k] = Math.round(rates.reduce((s, x) => s + x, 0) / rates.length);
  });
  return out;
};

// AIに渡す要約（過去問の記録はたまにしか増えないので stable 側に入れてよい）
const pastExamsForAI = () => {
  const recs = [...(S.pastExams || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (!recs.length) return 'なし';
  return recs.slice(-40).map(r => {
    const e = privEntry(r.key); const res = pastResult(r);
    if (!e || !res) return '';
    const sub = res.parts.map(p => `${PRIV_SUBJ_SHORT[p.k]}${p.pts ?? '?'}/${p.max}`).join(' ');
    return `[${r.date}] ${privLabel(e)}（${e.methodLabel}）${r.year}年度: ${sub} 計${res.score}/${res.max}`
      + (res.diff != null ? `, 合格最低点${res.min}${res.minAssumed ? '(2026年度の値)' : ''}との差${res.diff >= 0 ? '+' : ''}${res.diff}` : '')
      + (res.engFail ? ', ⚠️英語が基準点80点未満' : '') + (r.memo ? `, メモ:${r.memo}` : '');
  }).filter(Boolean).join('\n');
};

// ------------------------------------------------------------
// 🎯 合格ラインチェック
// ------------------------------------------------------------
const privRates = () => {
  if (!S.privSim || typeof S.privSim !== 'object') S.privSim = { en: 60, jp: 60, sel: 60, ma: 40 };
  return S.privSim;
};

window.renderPrivSim = () => {
  const c = document.getElementById('priv-sim-c');
  if (!c) return;
  const rates = privRates();
  // スライダーは一度だけ作る（同期で描き直すたびに作り直すと、動かしている最中に指から外れる）
  if (!document.getElementById('ps-en')) {
    c.innerHTML = `
      <p style="font-size:12px;color:var(--muted);margin-bottom:8px">各科目で取れそうな<strong>得点率</strong>を入れると、出願プランの方式ごとの配点で予想点を出し、2026年度の合格最低点と比べます。</p>
      ${Object.keys(PRIV_SUBJ).map(k => `<div class="range-row"><label>${esc(PRIV_SUBJ[k])}${k === 'ma' ? '（立命 学部個別だけ）' : ''}<span id="psv-${k}"></span></label>
        <input type="range" min="0" max="100" step="1" id="ps-${k}" oninput="privSimInput()" onchange="privSimSave()"></div>`).join('')}
      <button class="btn btn-s btn-sm" id="ps-from-past" onclick="privSimFromPast()" style="margin:4px 0 10px">📝 過去問の直近3回の平均を入れる</button>
      <div id="priv-sim-res"></div>`;
  }
  Object.keys(PRIV_SUBJ).forEach(k => {
    const el = document.getElementById('ps-' + k);
    if (el && document.activeElement !== el) el.value = rates[k] ?? 0;
    const lb = document.getElementById('psv-' + k);
    if (lb) lb.textContent = (rates[k] ?? 0) + '%';
  });
  const fb = document.getElementById('ps-from-past');
  if (fb) fb.disabled = !(S.pastExams || []).length;
  renderPrivSimResult();
};

const renderPrivSimResult = () => {
  const el = document.getElementById('priv-sim-res');
  if (!el) return;
  const rates = privRates();
  const applied = new Set((S.applications || []).map(a => `${a.name}|${a.dep}|${a.methodLabel || a.method}`));
  const color = { '◎': 'var(--a3)', '○': 'var(--accent)', '△': '#b45309', '✕': 'var(--a2)', '—': 'var(--muted)' };
  const rows = EXAM_PLAN.entries.filter(e => EXAM_SCORING[e.key]).map(e => {
    const sc = EXAM_SCORING[e.key];
    const r = privEstimate(rates, sc);
    const mine = applied.has(`${e.name}|${e.dep}|${e.methodLabel}`);
    const date = e.examDate ? privMd(e.examDate) + (e.examDateEnd ? '〜' + privMd(e.examDateEnd) : '') : (e.examNote || '');
    const en = r.parts.find(p => p.k === 'en');
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 4px">${mine ? '📮 ' : ''}<strong>${esc(privLabel(e))}</strong><br><span style="font-size:10px;color:var(--muted)">${esc(e.methodLabel)}${date ? '・' + esc(date) : ''}</span></td>
      <td style="padding:6px 4px;text-align:right;white-space:nowrap">${r.score}<span style="font-size:10px;color:var(--muted)">/${r.max}</span></td>
      <td style="padding:6px 4px;text-align:right;white-space:nowrap">${sc.min ?? '—'}${sc.minNote ? '<span style="font-size:10px;color:var(--muted)">*</span>' : ''}</td>
      <td style="padding:6px 4px;text-align:right;white-space:nowrap;color:${color[r.grade]}"><strong style="font-size:15px">${r.grade}</strong>
        ${r.diff != null ? `<br><span style="font-size:11px">${r.diff >= 0 ? '+' : ''}${r.diff}点</span>` : ''}
        ${r.engFail ? `<br><span style="font-size:10px">英語${en.pts}点＜基準${sc.engMin}</span>` : ''}</td>
    </tr>`;
  }).join('');
  const notes = Object.keys(EXAM_SCORING).filter(k => EXAM_SCORING[k].minNote).map(k => `${privLabel(privEntry(k))}: ${EXAM_SCORING[k].minNote}`);
  el.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="color:var(--muted);font-size:10px;text-align:left"><th>大学・方式</th><th style="text-align:right">予想点</th><th style="text-align:right">最低点<br>(2026)</th><th style="text-align:right">判定</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="font-size:11px;line-height:1.7;color:var(--muted);margin-top:8px">
      ◎ 最低点を満点の5%以上上回る ／ ○ 上回る ／ △ 5%以内の不足 ／ ✕ それ以上の不足、または英語の基準点割れ。📮＝出願管理に入れた方式。<br>
      ⚠️ 最低点は2026年度の実績で、年度によって上下します。同志社は選択科目の得点調整があります。${notes.length ? '<br>* ' + esc(notes.join('／')) : ''}
    </div>`;
};

window.privSimInput = () => {
  const rates = privRates();
  Object.keys(PRIV_SUBJ).forEach(k => {
    const el = document.getElementById('ps-' + k);
    if (el) rates[k] = +el.value;
    const lb = document.getElementById('psv-' + k);
    if (lb) lb.textContent = rates[k] + '%';
  });
  renderPrivSimResult();
};
// 動かしている最中は保存せず、指を離したときだけクラウドへ送る
window.privSimSave = () => { DbService.setMainProfile(); };

window.privSimFromPast = () => {
  const avg = pastAvgRates(S.pastExams, 3);
  if (!Object.keys(avg).length) { showToast('過去問の記録がまだありません', 'warn'); return; }
  Object.assign(privRates(), avg);
  DbService.setMainProfile();
  renderPrivSim();
  showToast('📝 ' + Object.keys(avg).map(k => `${PRIV_SUBJ_SHORT[k]}${avg[k]}%`).join('・') + ' を入れました');
};

// ------------------------------------------------------------
// 📝 過去問の記録
// ------------------------------------------------------------
window.renderPastExams = () => {
  const form = document.getElementById('past-form-c');
  // 入力欄は一度だけ作る（同期で描き直すと、打ちかけの点数が消える）
  if (form && !document.getElementById('pe-key')) {
    const opts = EXAM_PLAN.entries.filter(e => EXAM_SCORING[e.key])
      .map(e => `<option value="${esc(e.key)}">${esc(privLabel(e) + '・' + e.methodLabel)}</option>`).join('');
    const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018].map(y => `<option value="${y}">${y}年度</option>`).join('');
    form.innerHTML = `
      <p style="font-size:12px;color:var(--muted);margin-bottom:8px">赤本などで解いた過去問の点数を記録すると、合格最低点との差の推移が見られます。AIコーチにも伝わります。</p>
      <div class="form-row"><label class="lbl">大学・方式</label><select id="pe-key" onchange="pastFormScores()">${opts}</select></div>
      <div class="g2">
        <div class="form-row"><label class="lbl">何年度の問題か</label><select id="pe-year">${years}</select></div>
        <div class="form-row"><label class="lbl">解いた日</label><input type="date" id="pe-date"></div>
      </div>
      <div class="g2" id="pe-scores"></div>
      <div class="form-row"><label class="lbl">その年の合格最低点（空欄なら2026年度の値で比べます）</label><input type="number" id="pe-min" min="0" inputmode="numeric"></div>
      <div class="form-row"><label class="lbl">メモ（時間が足りなかった大問など）</label><input type="text" id="pe-memo" placeholder="例: 長文の大問IIIで時間切れ"></div>
      <button class="btn btn-p btn-sm btn-full" onclick="addPastExam()">📝 記録する</button>`;
    document.getElementById('pe-date').value = DateManager.getTodayStr();
    pastFormScores();
  }
  renderPastList();
};

// 方式を選び直したら、その方式の科目と満点で点数の欄を作り直す
window.pastFormScores = () => {
  const key = document.getElementById('pe-key')?.value;
  const sc = EXAM_SCORING[key]; const box = document.getElementById('pe-scores');
  if (!sc || !box) return;
  box.innerHTML = Object.keys(sc.parts).map(k => `<div class="form-row"><label class="lbl">${esc(PRIV_SUBJ[k])}（/${sc.parts[k]}）</label>
    <input type="number" id="pe-s-${k}" min="0" max="${sc.parts[k]}" inputmode="numeric"></div>`).join('');
  const min = document.getElementById('pe-min');
  if (min) min.placeholder = sc.min != null ? `2026年度は ${sc.min}点` : '公表なし';
};

window.addPastExam = () => {
  const key = document.getElementById('pe-key')?.value;
  const sc = EXAM_SCORING[key]; if (!sc) return;
  const scores = {};
  for (const k of Object.keys(sc.parts)) {
    const raw = document.getElementById('pe-s-' + k)?.value;
    if (raw === '' || raw == null) continue;
    const v = Number(raw);
    if (isNaN(v) || v < 0 || v > sc.parts[k]) { showToast(`${PRIV_SUBJ[k]}は0〜${sc.parts[k]}点で入れてください`, 'warn'); return; }
    scores[k] = v;
  }
  if (!Object.keys(scores).length) { showToast('点数を1科目以上入れてください', 'warn'); return; }
  const minRaw = document.getElementById('pe-min')?.value;
  const obj = {
    id: generateId(), key,
    year: +document.getElementById('pe-year').value,
    date: document.getElementById('pe-date').value || DateManager.getTodayStr(),
    scores, min: minRaw === '' ? null : Number(minRaw),
    memo: (document.getElementById('pe-memo')?.value || '').trim()
  };
  if (!Array.isArray(S.pastExams)) S.pastExams = [];
  S.pastExams.push(obj);
  DbService.set('pastExams', obj);
  Object.keys(sc.parts).forEach(k => { const el = document.getElementById('pe-s-' + k); if (el) el.value = ''; });
  ['pe-min', 'pe-memo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const res = pastResult(obj);
  renderPastExams(); renderPrivSim();
  showToast(res.diff != null ? `📝 記録しました（合格最低点と${res.diff >= 0 ? '+' : ''}${res.diff}点${res.engFail ? '・⚠️英語が基準点未満' : ''}）` : '📝 記録しました', res.engFail || (res.diff ?? 0) < 0 ? 'warn' : 'success');
};

window.removePastExam = (id) => {
  const r = (S.pastExams || []).find(x => x.id === id); if (!r) return;
  const e = privEntry(r.key);
  showConfirm('🗑 過去問の記録を削除', `「${e ? privLabel(e) + ' ' + e.methodLabel : r.key}（${r.year}年度・${r.date}）」を削除しますか？`, '削除する', () => {
    Trash.push('pastExams', r);
    DbService.del('pastExams', id);
    S.pastExams = S.pastExams.filter(x => x.id !== id);
    renderPastExams(); renderPrivSim();
    showToast('削除しました（ゴミ箱から30日以内に復元できます）');
  });
};

const renderPastList = () => {
  const el = document.getElementById('past-list-c');
  if (!el) return;
  const recs = [...(S.pastExams || [])].filter(r => EXAM_SCORING[r.key])
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b._writtenAt || 0) - (a._writtenAt || 0));
  if (!recs.length) { el.innerHTML = '<div class="empty" style="margin-top:10px">まだ記録がありません</div>'; return; }

  // 方式ごとのまとめ（回数・最高・直近）
  const byKey = {};
  recs.forEach(r => (byKey[r.key] = byKey[r.key] || []).push(r));
  const summary = Object.keys(byKey).map(k => {
    const e = privEntry(k); const list = byKey[k].map(pastResult).filter(x => x && x.diff != null);
    const best = list.length ? Math.max(...list.map(x => x.diff)) : null;
    const last = list[0];
    return `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span><strong>${esc(privLabel(e))}</strong> <span style="color:var(--muted);font-size:11px">${esc(e.methodLabel)}・${byKey[k].length}回</span></span>
      <span style="white-space:nowrap">${last ? `直近 <strong style="color:${last.diff >= 0 ? 'var(--a3)' : 'var(--a2)'}">${last.diff >= 0 ? '+' : ''}${last.diff}</strong>` : ''}${best != null ? ` ／ 最高 ${best >= 0 ? '+' : ''}${best}` : ''}</span>
    </div>`;
  }).join('');

  const rows = recs.map(r => {
    const e = privEntry(r.key); const res = pastResult(r);
    const sub = res.parts.map(p => `${PRIV_SUBJ_SHORT[p.k]}${p.pts ?? '-'}`).join(' ');
    const diffTxt = res.diff != null ? `<strong style="color:${res.diff >= 0 ? 'var(--a3)' : 'var(--a2)'}">${res.diff >= 0 ? '+' : ''}${res.diff}</strong>` : (res.complete ? '' : '<span style="font-size:10px;color:var(--muted)">一部の科目だけ</span>');
    return `<div class="row">
      <div style="flex:1;min-width:0">
        <div class="row-title">${esc(privLabel(e))} <span style="font-size:11px;color:var(--muted);font-weight:400">${esc(e.methodLabel)}・${esc(r.year)}年度</span></div>
        <div class="row-sub">${esc(r.date)}　${esc(sub)}　計${res.score}/${res.max}${res.pct != null ? `（${res.pct}%）` : ''}${res.min != null ? `　最低点${res.min}${res.minAssumed ? '(2026)' : ''}` : ''}</div>
        ${res.engFail ? `<div style="font-size:11px;color:var(--a2);font-weight:700">⚠️ 英語が基準点${res.sc.engMin}点に届いていません（合計が足りても不合格）</div>` : ''}
        ${r.memo ? `<div style="font-size:11px;color:var(--muted)">📝 ${esc(r.memo)}</div>` : ''}
      </div>
      <div style="text-align:right;margin-left:8px;white-space:nowrap">${diffTxt}<br><button class="icon-btn" onclick="removePastExam('${esc(r.id)}')" title="削除">×</button></div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="divider"></div>
    <div style="font-weight:700;font-size:13px;margin-bottom:4px">📊 方式ごとのまとめ（合格最低点との差）</div>${summary}
    <div style="font-weight:700;font-size:13px;margin:12px 0 4px">📈 合格最低点との差の推移（満点に対する%）</div>
    <div class="cw"><canvas id="past-chart"></canvas></div>
    <div style="font-weight:700;font-size:13px;margin:12px 0 4px">📋 記録（新しい順）</div>${rows}`;
  setTimeout(initPastChart, 50);
};

// 0%の線が合格ライン。上にあれば最低点を超えている
const initPastChart = () => {
  const el = document.getElementById('past-chart');
  if (!el || !el.offsetParent || typeof Chart === 'undefined') return;
  const recs = [...(S.pastExams || [])].filter(r => EXAM_SCORING[r.key])
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const labels = [...new Set(recs.map(r => r.date))];
  const colors = ['#1d4ed8', '#dc4f1e', '#16a05a', '#c07010', '#6030b8', '#0e7490', '#be185d', '#4d7c0f', '#7c3aed', '#475569'];
  const keys = [...new Set(recs.map(r => r.key))];
  const datasets = keys.map((k, i) => {
    const byDate = {};
    recs.filter(r => r.key === k).forEach(r => { const res = pastResult(r); if (res.diffPct != null) byDate[r.date] = res.diffPct; });
    const e = privEntry(k);
    return { label: `${privLabel(e)} ${e.methodLabel.replace(/（.*?）/g, '')}`, data: labels.map(d => byDate[d] ?? null),
      borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length], spanGaps: true, tension: 0.2 };
  });
  datasets.push({ label: '合格ライン', data: labels.map(() => 0), borderColor: '#888', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 });
  if (typeof dc === 'function') dc('past'); else if (charts.past) charts.past.destroy();
  charts.past = new Chart(el, { type: 'line', data: { labels: labels.map(d => d.slice(5)), datasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } },
      scales: { y: { title: { display: true, text: '最低点との差（%）' } } } } });
};
