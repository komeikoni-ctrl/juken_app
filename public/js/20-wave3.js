// ============================================================
// 第3弾（写真AI・サーバー連携の拡張）
// ------------------------------------------------------------
// 14 模試写真 → 成績票を読み取り、既存の模試記録フォームに
// 下書きとして流し込む（保存は本人が確認して「記録」を押す）
// 15 添削キュー … live/essayQueue に投稿し、即時添削を試み、
// 残りは毎朝の Cron（api/cron-generate）が処理する
// 16 問題写真 → 問題文のテキスト化＋解法方針の下書きを
// チャットに流し込む（解説の生成は既存チャットの流れ）
// 38 エクスポート … /api/export（Vercel版のみ）で CSV / 印刷用HTML
// 66 PayPay CSV 取込 … /api/paypay-import で2段階（確認→確定）
// 70 睡眠サマリー … live/healthData（iPhoneショートカットが送信）
// 93 OCR ライブラリ（パイロット）… live/ocrDocs にテキスト保存＋検索
// どれも Vercel 側の機能が無い環境（Pages）では失敗を検知して
// 案内を出すだけで、アプリ本体は壊れない作りにする。
// ============================================================

const ESSAY_QUEUE_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/essayQueue';
const HEALTH_DATA_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/healthData';
const OCR_DOCS_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/ocrDocs';
const WAVE3_IS_PAGES = () => location.hostname.endsWith('github.io');

// ============================================================
// 14 模試写真の取り込み
// ============================================================
const MockPhotoUI = {
// AIに返させる JSON のキー → 模試フォームの入力欄 id（種別で出し分け）
_prompt: 'あなたは模試の成績票を読み取る係です。画像の成績票から数値を抜き出し、次の形式の JSON だけを返してください（説明文は一切付けない）。読み取れない項目は null にしてください。\n'
+ '{"name":"模試名","date":"YYYY-MM-DD","type":"kyotsu または kijutsu","rank":全体順位の数値または null,'
+ '"deviations":{"english":英語偏差値,"japanese":国語偏差値,"math":数学偏差値,"history":世界史偏差値,"polikei":政治経済偏差値,"total":総合偏差値},'
+ '"scores":{"english":英語の実得点,"japanese":国語の実得点,"math":数学の実得点（記述系のみ）,"math1a":数学1A,"math2b":数学2B,"mathc":数学C,"history":世界史,"polikei":政治経済,"chem":化学基礎,"bio":生物基礎,"info":情報},'
+ '"comment":"成績の特徴を1〜2文で（強みと弱み）"}\n'
+ '偏差値と実得点を混同しないこと。共通テスト系（マーク式・科目別得点がある）は kyotsu、記述式は kijutsu としてください。',

// 解析結果 → フォームへ入れる値の対応に変換する（純粋関数・テスト対象）
normalize: (p) => {
if (!p || typeof p!== 'object') return null;
const type = p.type === 'kijutsu'? 'kijutsu': 'kyotsu';
const dev = p.deviations || {};
const sc = p.scores || {};
const num = (v) => { const n = Number(v); return Number.isFinite(n) && v!== null && v!== ''? n: null;};
const values = {};
const put = (id, v) => { const n = num(v); if (n!== null) values[id] = n;};
if (typeof p.name === 'string' && p.name) values['m-name'] = p.name;
if (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) values['m-date'] = p.date;
put('m-rank', p.rank);
if (type === 'kyotsu') {
put('m-en', dev.english); put('m-jp', dev.japanese); put('m-ma', dev.math);
put('m-hi', dev.history); put('m-pe', dev.polikei); put('m-total', dev.total);
put('m-en-score', sc.english); put('m-jp-score', sc.japanese);
put('m-ma1-score', sc.math1a); put('m-ma2-score', sc.math2b); put('m-mac-score', sc.mathc);
put('m-hi-score', sc.history); put('m-pe-score', sc.polikei);
put('m-ch-score', sc.chem); put('m-bi-score', sc.bio); put('m-in-score', sc.info);
} else {
put('m-k-en', dev.english); put('m-k-jp', dev.japanese); put('m-k-ma', dev.math); put('m-k-total', dev.total);
put('m-k-en-score', sc.english); put('m-k-jp-score', sc.japanese); put('m-k-ma-score', sc.math);
}
return { type, values, comment: typeof p.comment === 'string'? p.comment: ''};
},

onFile: async (event) => {
const file = event.target.files[0];
event.target.value = '';
if (!file) return;
if (!validateUpload(file)) return;
showToast('📸 成績票を読み取っています…', 'success', 4000);
try {
const fd = await prepareFileData(file);
const { text} = await AiService.request({
prompt: MockPhotoUI._prompt,
fileData: { base64: fd.base64, mimeType: fd.mimeType},
forceJson: true, purpose: 'normal', maxOutputTokens: 2048
});
const parsed = AiService.extractJson(text);
const draft = MockPhotoUI.normalize(parsed);
if (!draft ||!Object.keys(draft.values).length) { showToast('成績票から数値を読み取れませんでした', 'error'); return;}
openMockModal();
setTimeout(() => {
const typeEl = document.getElementById('m-type');
if (typeEl) { typeEl.value = draft.type; switchMockType(draft.type);}
for (const [id, v] of Object.entries(draft.values)) {
const el = document.getElementById(id);
if (el) el.value = v;
}
const note = document.getElementById('mock-ai-note');
if (note) {
note.style.display = 'block';
note.innerHTML = '🤖 <b>写真からの下書き</b>です。数値を確認・修正してから「記録」を押してください。'
+ (draft.comment? '<br>AIの見立て: ' + esc(draft.comment): '');
}
showToast('📸 下書きを入力しました。確認して「記録」を押してください', 'success', 5000);
}, 30);
} catch (e) {
showToast('読み取りに失敗しました: ' + (e.message || e), 'error');
}
}
};
window.MockPhotoUI = MockPhotoUI;

// ============================================================
// 15 添削キュー
// ============================================================
const EssayUI = {
_items: null,
_loading: false,

// サーバー側（api/cron-generate.js の essayPrompt）と文面を揃える
buildPrompt: (kind, text) => 'あなたは大学受験の指導者です。次の' + (kind === 'essay'? '小論文': '英作文') + 'を添削してください。\n'
+ '出力は次の形式で、日本語で書いてください:\n'
+ '\n（添削した全文）\n'
+ '\n（文法・語彙・構成の問題点を箇条書きで最大5つ）\n'
+ '\n（良い点と次に伸ばすべき点を2〜3文で）\n\n'
+ '--- 添削対象 ---\n' + text,

// 結果を items に反映した新しい配列を返す（純粋関数・テスト対象）
applyResult: (items, id, result, by) => (Array.isArray(items)? items: []).map(i =>
i && i.id === id? {...i, status: 'done', result, correctedAt: new Date().toISOString(), correctedBy: by || 'app'}: i),

_save: async (items) => _fsWriteStringField(ESSAY_QUEUE_DOC_URL, 'data', JSON.stringify({ items: items.slice(0, 50), updatedAt: new Date().toISOString()})),

load: async () => {
if (EssayUI._loading) return;
EssayUI._loading = true;
try {
const s = await _fsReadStringField(ESSAY_QUEUE_DOC_URL, 'data');
if (s) { const d = JSON.parse(s); EssayUI._items = Array.isArray(d.items)? d.items: [];}
else EssayUI._items = [];
} catch (e) { EssayUI._items = [];}
EssayUI._loading = false;
EssayUI.render();
},

submit: async () => {
const ta = document.getElementById('essay-text');
const kindEl = document.getElementById('essay-kind');
const text = (ta?.value || '').trim();
if (!text) { showToast('添削してほしい文を入力してください', 'warn'); return;}
if (text.length > 4000) { showToast('文が長すぎます（4000字まで）', 'warn'); return;}
const item = { id: generateId(), kind: kindEl?.value || 'english', text, status: 'pending', createdAt: new Date().toISOString()};
if (!EssayUI._items) await EssayUI.load();
const items = [item,...(EssayUI._items || [])];
EssayUI._items = items;
EssayUI.render();
const saved = await EssayUI._save(items).catch(() => false);
if (!saved) { showToast('キューへの保存に失敗しました', 'error'); return;}
if (ta) ta.value = '';
showToast('✍️ 添削キューに投稿しました', 'success');
// 即時添削を試みる（失敗してもキューに残り、毎朝の Cron が処理する）
try {
const { text: result} = await AiService.request({ prompt: EssayUI.buildPrompt(item.kind, item.text), purpose: 'normal', maxOutputTokens: 3072});
if (result) {
EssayUI._items = EssayUI.applyResult(EssayUI._items, item.id, result, 'app');
await EssayUI._save(EssayUI._items).catch(() => {});
EssayUI.render();
showToast('✍️ 添削が完了しました', 'success');
}
} catch (e) { /* Cron に任せる */}
},

remove: async (id) => {
EssayUI._items = (EssayUI._items || []).filter(i => i.id!== id);
await EssayUI._save(EssayUI._items).catch(() => {});
EssayUI.render();
},

render: () => {
const el = document.getElementById('essay-list');
if (!el) return;
const items = EssayUI._items;
if (!items) { EssayUI.load(); el.innerHTML = '<div class="empty">読み込み中…</div>'; return;}
if (!items.length) { el.innerHTML = '<div class="empty">まだ投稿がありません</div>'; return;}
el.innerHTML = items.map(i => {
const badge = i.status === 'done'? '<span class="badge" style="background:var(--a3);color:#fff">添削済</span>'
: i.status === 'failed'? '<span class="badge" style="background:var(--a2);color:#fff">失敗</span>'
: '<span class="badge">添削待ち（毎朝自動でも処理されます）</span>';
const when = i.createdAt? new Date(i.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}): '';
return '<div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:8px">'
+ '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><b style="font-size:12px">' + (i.kind === 'essay'? '📝 小論文': '✍️ 英作文') + '</b>' + badge
+ '<span class="muted" style="font-size:11px">' + esc(when) + '</span>'
+ '<button class="btn btn-s btn-sm" style="margin-left:auto" onclick="EssayUI.remove(\'' + esc(i.id) + '\')">削除</button></div>'
+ '<div style="font-size:12px;line-height:1.7;white-space:pre-wrap;color:var(--muted)">' + esc(String(i.text || '').slice(0, 200)) + (String(i.text || '').length > 200? '…': '') + '</div>'
+ (i.status === 'done' && i.result? '<div style="font-size:13px;line-height:1.8;white-space:pre-wrap;margin-top:8px;padding:10px 12px;background:var(--bg);border-radius:var(--r)">' + esc(i.result) + '</div>': '')
+ '</div>';
}).join('');
}
};
window.EssayUI = EssayUI;

// ============================================================
// 16 問題写真 → チャットの下書き
// ============================================================
const ProblemPhotoUI = {
_draft: null,
_file: null,

_prompt: 'あなたは問題用紙を読み取る係です。画像の問題文を正確に文字起こしし、次の形式の JSON だけを返してください（説明文は付けない）。\n'
+ '{"text":"問題文の全文（数式は通常の文字で表現）","subject":"推定した科目名","approach":"解法の方針を2〜3文で"}',

// 読み取り結果からチャットへ送る文面を組む（純粋関数・テスト対象）
compose: (d) => {
const parts = [];
parts.push('次の問題を解説してください。');
if (d.subject) parts.push('' + d.subject);
parts.push('\n' + (d.text || ''));
if (d.approach) parts.push('\n' + d.approach + '\n※この方針が正しいか検証しながら解説してください。');
parts.push('途中の考え方も含めて、丁寧に解説してください。');
return parts.join('\n');
},

onFile: async (event) => {
const file = event.target.files[0];
event.target.value = '';
if (!file) return;
if (!validateUpload(file)) return;
showToast('📷 問題文を読み取っています…', 'success', 4000);
try {
const fd = await prepareFileData(file);
ProblemPhotoUI._file = { base64: fd.base64, mimeType: fd.mimeType, name: file.name, size: fd.size, originalSize: fd.originalSize, isImage: fd.mimeType.startsWith('image/'), isPdf: fd.mimeType === 'application/pdf', previewUrl: fd.mimeType.startsWith('image/')? 'data:' + fd.mimeType + ';base64,' + fd.base64: null};
const { text} = await AiService.request({
prompt: ProblemPhotoUI._prompt,
fileData: { base64: fd.base64, mimeType: fd.mimeType},
forceJson: true, purpose: 'normal', maxOutputTokens: 3072
});
const parsed = AiService.extractJson(text);
if (!parsed ||!parsed.text) { showToast('問題文を読み取れませんでした', 'error'); return;}
ProblemPhotoUI._draft = { text: String(parsed.text), subject: String(parsed.subject || ''), approach: String(parsed.approach || '')};
ProblemPhotoUI.renderDraft();
showToast('📷 読み取りました。内容を確認して「チャットで解説してもらう」を押してください', 'success', 5000);
} catch (e) {
showToast('読み取りに失敗しました: ' + (e.message || e), 'error');
}
},

renderDraft: () => {
const wrap = document.getElementById('problem-draft-wrap');
if (!wrap) return;
const d = ProblemPhotoUI._draft;
if (!d) { wrap.style.display = 'none'; wrap.innerHTML = ''; return;}
wrap.style.display = 'block';
wrap.innerHTML = '<div style="border:1px solid var(--accent);border-radius:var(--r);padding:10px 12px;margin-bottom:8px">'
+ '<div style="font-size:12px;font-weight:700;margin-bottom:6px">📷 問題の読み取り結果（修正できます）</div>'
+ '<label class="lbl">科目</label><input type="text" id="problem-draft-subject" value="' + esc(d.subject) + '" style="margin-bottom:8px">'
+ '<label class="lbl">問題文</label><textarea id="problem-draft-text" rows="6" style="width:100%">' + esc(d.text) + '</textarea>'
+ '<label class="lbl">解法の方針（下書き）</label><textarea id="problem-draft-approach" rows="3" style="width:100%">' + esc(d.approach) + '</textarea>'
+ '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-p btn-sm" style="flex:1" onclick="ProblemPhotoUI.send()">💬 チャットで解説してもらう</button>'
+ '<button class="btn btn-s btn-sm" onclick="ProblemPhotoUI.cancel()">やめる</button></div></div>';
},

cancel: () => { ProblemPhotoUI._draft = null; ProblemPhotoUI._file = null; ProblemPhotoUI.renderDraft();},

send: () => {
const d = {
subject: document.getElementById('problem-draft-subject')?.value || '',
text: document.getElementById('problem-draft-text')?.value || '',
approach: document.getElementById('problem-draft-approach')?.value || ''
};
const inp = document.getElementById('chat-in');
if (inp) { inp.value = ProblemPhotoUI.compose(d); inp.dispatchEvent(new Event('input'));}
// 元の写真も添付して、チャット側の AI にも見せる
if (ProblemPhotoUI._file && typeof _chatAttachedFile!== 'undefined') {
_chatAttachedFile = ProblemPhotoUI._file;
if (typeof renderChatFilePreview === 'function') renderChatFilePreview();
}
ProblemPhotoUI._draft = null; ProblemPhotoUI._file = null;
ProblemPhotoUI.renderDraft();
if (typeof doChat === 'function') doChat();
}
};
window.ProblemPhotoUI = ProblemPhotoUI;

// ============================================================
// 66 PayPay CSV 取込 ＋ 38 エクスポート
// ============================================================
const PayPayImportUI = {
_pending: null, // {csv, fileName, hash, preview}

_sha256: async (text) => {
const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
},

onFile: async (event) => {
const file = event.target.files[0];
event.target.value = '';
if (!file) return;
if (WAVE3_IS_PAGES()) { showToast('PayPay取込は Vercel版でのみ使えます', 'warn'); return;}
try {
const csv = await file.text();
const hash = await PayPayImportUI._sha256(csv);
const res = await fetch('/api/paypay-import', {
method: 'POST', headers: { 'Content-Type': 'application/json'},
body: JSON.stringify({ mode: 'preview', csv, fileName: file.name, hash})
});
const j = await res.json().catch(() => null);
if (!res.ok ||!j) { showToast('取込の確認に失敗しました: ' + ((j && j.error) || res.status), 'error'); return;}
PayPayImportUI._pending = { csv, fileName: file.name, hash, preview: j};
PayPayImportUI.renderPreview();
} catch (e) { showToast('取込の確認に失敗しました', 'error');}
},

renderPreview: () => {
const el = document.getElementById('paypay-import-c');
if (!el) return;
const p = PayPayImportUI._pending?.preview;
if (!p) { el.innerHTML = ''; return;}
const yen = (n) => (typeof MoneyView!== 'undefined' && MoneyView.yen)? MoneyView.yen(n): '¥' + (Number(n) || 0).toLocaleString('ja-JP');
let html = '<div style="border:1px solid var(--accent);border-radius:var(--r);padding:10px 12px;margin-top:10px">'
+ '<div style="font-size:13px;font-weight:700;margin-bottom:4px">📱 PayPay CSV の取込確認</div>';
if (p.alreadyImported) {
html += '<div style="font-size:12px;line-height:1.7">このファイルは取込済みです（二重に数えないため、再取込はしません）。</div>';
} else {
html += '<div style="font-size:12px;line-height:1.8">'
+ 'このCSV: ' + esc(p.periodFrom) + ' 〜 ' + esc(p.periodTo) + ' ／ 支払い ' + p.payments.count + '件 ・ ' + yen(p.payments.total) + '<br>'
+ (p.before? '現在: ' + esc(p.before.periodFrom) + ' 〜 ' + esc(p.before.periodTo) + ' ／ ' + p.before.paymentCount + '件 ・ ' + yen(p.before.totalPayments) + '<br>': '')
+ (p.mergeMode === 'extension' && p.afterPreview
? '取込後: ' + esc(p.afterPreview.periodFrom) + ' 〜 ' + esc(p.afterPreview.periodTo) + ' ／ ' + p.afterPreview.paymentCount + '件 ・ ' + yen(p.afterPreview.totalPayments) + '（その場で反映されます）'
: '期間が現在のデータと重なるため、取込後の集計は次回の自動更新（2時間おき）で正確に反映されます。')
+ '</div>'
+ '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-p btn-sm" style="flex:1" onclick="PayPayImportUI.commit()">この内容で取り込む</button>'
+ '<button class="btn btn-s btn-sm" onclick="PayPayImportUI.cancel()">やめる</button></div>';
}
el.innerHTML = html + '</div>';
},

cancel: () => { PayPayImportUI._pending = null; PayPayImportUI.renderPreview();},

commit: async () => {
const p = PayPayImportUI._pending;
if (!p) return;
try {
const res = await fetch('/api/paypay-import', {
method: 'POST', headers: { 'Content-Type': 'application/json'},
body: JSON.stringify({ mode: 'commit', csv: p.csv, fileName: p.fileName, hash: p.hash})
});
const j = await res.json().catch(() => null);
if (!res.ok ||!j?.committed) { showToast('取込に失敗しました: ' + ((j && j.error) || res.status), 'error'); return;}
PayPayImportUI._pending = null;
PayPayImportUI.renderPreview();
showToast(j.moneyUpdated? '📱 PayPay を取り込みました（反映済み）': '📱 PayPay を取り込みました（集計は次回の自動更新で反映されます）', 'success', 5000);
if (typeof renderMoney === 'function') renderMoney(true);
} catch (e) { showToast('取込に失敗しました', 'error');}
}
};
window.PayPayImportUI = PayPayImportUI;

const ExportUI = {
kakeiboCsv: async () => {
if (WAVE3_IS_PAGES()) { showToast('エクスポートは Vercel版でのみ使えます', 'warn'); return;}
try {
const res = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json'}, body: JSON.stringify({ kind: 'kakeibo-csv'})});
if (!res.ok) { showToast('CSV の生成に失敗しました', 'error'); return;}
const blob = await res.blob();
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'kakeibo.csv';
a.click();
setTimeout(() => URL.revokeObjectURL(a.href), 5000);
showToast('📥 家計簿CSVをダウンロードしました', 'success');
} catch (e) { showToast('CSV の生成に失敗しました', 'error');}
},
report: async () => {
if (WAVE3_IS_PAGES()) { showToast('エクスポートは Vercel版でのみ使えます', 'warn'); return;}
try {
const res = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json'}, body: JSON.stringify({ kind: 'report-html'})});
if (!res.ok) { showToast('レポートの生成に失敗しました', 'error'); return;}
const html = await res.text();
const w = window.open('', '_blank');
if (w) { w.document.write(html); w.document.close(); showToast('📄 レポートを開きました（印刷 → PDFに保存できます）', 'success', 5000);}
else showToast('ポップアップがブロックされました', 'warn');
} catch (e) { showToast('レポートの生成に失敗しました', 'error');}
}
};
window.ExportUI = ExportUI;

// ============================================================
// 70 睡眠サマリー（live/healthData を読むだけ）
// ============================================================
const HealthUI = {
// days（{'YYYY-MM-DD': {hours, bed, wake}}）→ 直近7日の一覧と平均（純粋関数・テスト対象）
summarize: (days, todayStr) => {
const list = [];
const base = Date.parse(todayStr + 'T00:00:00Z');
for (let i = 0; i < 7; i++) {
const d = new Date(base - i * 86400000).toISOString().slice(0, 10);
const e = days && days[d];
list.push({ date: d, hours: e? Number(e.hours) || null: null, bed: e?.bed || null, wake: e?.wake || null});
}
const vals = list.filter(x => x.hours!= null).map(x => x.hours);
const avg = vals.length? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100: null;
return { list, avg, count: vals.length};
},

load: async () => {
const el = document.getElementById('health-sleep-c');
if (!el) return;
try {
const s = await _fsReadStringField(HEALTH_DATA_DOC_URL, 'data');
const data = s? JSON.parse(s): null;
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const sum = HealthUI.summarize(data?.days || {}, today);
if (!sum.count) {
el.innerHTML = '<div class="empty">睡眠データはまだ届いていません。iPhoneのショートカットから送ると、ここに直近7日の睡眠が表示されます（手順は設定メモ参照）。</div>';
return;
}
const rows = sum.list.map(x => '<div class="row" style="padding:4px 0"><div class="row-title" style="font-size:12px">' + esc(x.date.slice(5)) + '</div>'
+ '<span class="muted" style="font-size:11px;margin-right:8px">' + (x.bed? esc(x.bed) + ' → ' + esc(x.wake || ''): '') + '</span>'
+ '<span style="font-size:12px;font-weight:700">' + (x.hours!= null? x.hours + '時間': '—') + '</span></div>').join('');
el.innerHTML = '<div style="font-size:13px;font-weight:700;margin-bottom:4px">直近7日の平均: ' + (sum.avg!= null? sum.avg + '時間': '—') + '（記録 ' + sum.count + '日分）</div>' + rows;
} catch (e) { /* 取れなければ何もしない */}
}
};
window.HealthUI = HealthUI;

// ============================================================
// 93 OCR ライブラリ（パイロット）
// ============================================================
const OcrUI = {
_docs: null,

// キーワード検索（純粋関数・テスト対象）。空白区切りは AND。
search: (docs, q) => {
const terms = String(q || '').split(/[\s　]+/).filter(Boolean).map(t => t.toLowerCase());
const list = Array.isArray(docs)? docs: [];
if (!terms.length) return list.slice();
return list.filter(d => {
const hay = ((d.subject || '') + '\n' + (d.text || '')).toLowerCase();
return terms.every(t => hay.includes(t));
});
},

load: async () => {
try {
const s = await _fsReadStringField(OCR_DOCS_DOC_URL, 'data');
const d = s? JSON.parse(s): null;
OcrUI._docs = Array.isArray(d?.docs)? d.docs: [];
} catch (e) { OcrUI._docs = [];}
OcrUI.render();
},

onFile: async (event) => {
const file = event.target.files[0];
event.target.value = '';
if (!file) return;
if (!validateUpload(file)) return;
const subject = (document.getElementById('ocr-subject')?.value || '').trim() || '未分類';
const page = (document.getElementById('ocr-page')?.value || '').trim();
showToast('🔎 文字を読み取っています…', 'success', 4000);
try {
const fd = await prepareFileData(file);
const { text} = await AiService.request({
prompt: '画像の問題ページの文字をすべて正確に文字起こししてください。問題文・選択肢・数式（通常の文字で表現）を含め、余計な説明は付けず、読み取った本文だけを返してください。',
fileData: { base64: fd.base64, mimeType: fd.mimeType},
purpose: 'normal', maxOutputTokens: 4096
});
if (!text) { showToast('文字を読み取れませんでした', 'error'); return;}
if (!OcrUI._docs) await OcrUI.load();
const doc = { id: generateId(), subject, page, text: String(text).slice(0, 20000), createdAt: new Date().toISOString()};
OcrUI._docs = [doc,...(OcrUI._docs || [])].slice(0, 200);
const ok = await _fsWriteStringField(OCR_DOCS_DOC_URL, 'data', JSON.stringify({ docs: OcrUI._docs, updatedAt: new Date().toISOString()})).catch(() => false);
if (!ok) { showToast('保存に失敗しました', 'error'); return;}
OcrUI.render();
showToast('🔎 OCR結果を登録しました（' + text.length + '字）', 'success');
} catch (e) { showToast('OCRに失敗しました: ' + (e.message || e), 'error');}
},

render: () => {
const el = document.getElementById('ocr-list');
if (!el) return;
const q = document.getElementById('ocr-search')?.value || '';
const hits = OcrUI.search(OcrUI._docs || [], q);
if (!OcrUI._docs) { OcrUI.load(); el.innerHTML = '<div class="empty">読み込み中…</div>'; return;}
if (!hits.length) { el.innerHTML = '<div class="empty">' + (q? '見つかりませんでした': 'まだ登録がありません') + '</div>'; return;}
el.innerHTML = '<div class="muted" style="font-size:11px;margin-bottom:6px">' + hits.length + '件</div>' + hits.slice(0, 20).map(d =>
'<div style="border:1px solid var(--border);border-radius:var(--r);padding:8px 10px;margin-bottom:6px">'
+ '<div style="font-size:12px;font-weight:700">' + esc(d.subject || '') + (d.page? ' ・ p.' + esc(d.page): '') + '</div>'
+ '<div style="font-size:12px;line-height:1.7;white-space:pre-wrap;color:var(--muted)">' + esc(String(d.text || '').slice(0, 300)) + (String(d.text || '').length > 300? '…': '') + '</div></div>').join('');
}
};
window.OcrUI = OcrUI;

document.addEventListener('DOMContentLoaded', () => {
setTimeout(() => { try { HealthUI.load();} catch (e) {}}, 5000);
setTimeout(() => { try { if (document.getElementById('ocr-list')) OcrUI.load();} catch (e) {}}, 5600);
setTimeout(() => { try { if (document.getElementById('essay-list')) EssayUI.load();} catch (e) {}}, 6200);
});

// ============================================================
// SelfTest（純粋関数の回帰チェック）
// ============================================================
// SelfTest は 11-boot.js（最後に読み込まれる）で定義されるため、登録は DOMContentLoaded まで遅らせる
document.addEventListener('DOMContentLoaded', () => {
if (typeof SelfTest === 'undefined') return;
SelfTest.add('第3弾 模試写真: 解析結果のフォーム変換', () => {
const d = MockPhotoUI.normalize({ name: '駿台全国模試', date: '2026-10-04', type: 'kyotsu', rank: 1234, deviations: { english: 65.5, japanese: null, math: 70}, scores: { english: 152, math1a: 81}});
assertEq(d.type, 'kyotsu');
assertEq(d.values['m-en'], 65.5);
assertEq(d.values['m-en-score'], 152);
assert(!('m-jp' in d.values), 'null の偏差値は入れないこと');
const k = MockPhotoUI.normalize({ type: 'kijutsu', deviations: { math: 61}, scores: { math: 88}});
assertEq(k.values['m-k-ma'], 61); assertEq(k.values['m-k-ma-score'], 88);
});
SelfTest.add('第3弾 添削キュー: プロンプトと結果反映', () => {
const p = EssayUI.buildPrompt('english', 'I goed to school.');
assert(p.includes('英作文') && p.includes('I goed'), '対象文を含むこと');
const items = EssayUI.applyResult([{ id: 'a', status: 'pending', text: 'x'}], 'a', '添削結果', 'app');
assertEq(items[0].status, 'done'); assertEq(items[0].result, '添削結果');
});
SelfTest.add('第3弾 問題写真: チャット文面の組み立て', () => {
const s = ProblemPhotoUI.compose({ subject: '数学', text: 'x^2-4x+3 の最小値は？', approach: '平方完成する'});
assert(s.includes('数学') && s.includes('平方完成'), '科目と方針を含むこと');
});
SelfTest.add('第3弾 睡眠: 直近7日の集計', () => {
const sum = HealthUI.summarize({ '2026-10-27': { hours: 7}, '2026-10-26': { hours: 6}}, '2026-10-27');
assertEq(sum.list.length, 7); assertEq(sum.count, 2); assertEq(sum.avg, 6.5);
assertEq(sum.list[0].hours, 7); assertEq(sum.list[2].hours, null);
});
SelfTest.add('第3弾 OCR検索: AND 条件と空検索', () => {
const docs = [{ subject: '世界史', text: 'ヘレニズム文化の特徴'}, { subject: '数学', text: '2次関数の最小値'}];
assertEq(OcrUI.search(docs, 'ヘレニズム').length, 1);
assertEq(OcrUI.search(docs, '世界史 文化').length, 1);
assertEq(OcrUI.search(docs, '').length, 2);
});
});
