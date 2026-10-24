// --- 🌟 チャットスレッド管理システム ---
if (!S.chatThreads || S.chatThreads.length === 0) {
  S.chatThreads = [{ id: 'th_default', title: 'メインチャット', updatedAt: Date.now() }];
}
window.currentChatThreadId = S.chatThreads[0].id;

const renderChatThreadsNav = () => {
  const wrap = document.getElementById('chat-threads-wrap');
  if (!wrap || !S.chatThreads) return;
  
  const sortedThreads = [...S.chatThreads].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  let html = sortedThreads.map(t => {
    const isActive = t.id === window.currentChatThreadId;
    const btnClass = isActive ? 'btn-p' : 'btn-s';
    return `<button class="btn ${btnClass} btn-sm" style="white-space:nowrap; padding:4px 12px; font-size:12px; border-radius:16px;" onclick="switchChatThread('${t.id}')">${esc(t.title)}</button>`;
  }).join('');
  html += `<button class="btn btn-s btn-sm" style="white-space:nowrap; padding:4px 12px; font-size:12px; border-radius:16px; border:1px dashed var(--muted);" onclick="createNewChat()">+ 新規</button>`;
  wrap.innerHTML = html;
};

window.switchChatThread = (id) => {
  window.currentChatThreadId = id;
  clearChatSearch();
  renderChat();
};

window.createNewChat = () => {
  showMo('mo-new-chat');
  setTimeout(() => { const el = document.getElementById('new-chat-title'); if(el) el.focus(); }, 100);
};

window.confirmCreateNewChat = () => {
  const titleEl = document.getElementById('new-chat-title');
  const title = titleEl?.value.trim() || '新しいチャット';
  const newId = 'th_' + Date.now();
  S.chatThreads.unshift({ id: newId, title: title, updatedAt: Date.now() });
  window.currentChatThreadId = newId;
  DbService.setMainProfile();
  closeMo('mo-new-chat');
  renderChat();
  showToast(`💬「${title}」を作成しました`);
};

window.renameCurrentChat = () => {
  const thread = S.chatThreads.find(t => t.id === window.currentChatThreadId);
  if(!thread) return;
  const el = document.getElementById('new-chat-title');
  if (el) el.value = thread.title;
  const modal = document.getElementById('mo-new-chat');
  const title = modal?.querySelector('.mo-title');
  if (title) title.textContent = '✏️ チャット名を変更';
  const btn = modal?.querySelector('.btn-p');
  if (btn) { btn.textContent = '変更'; btn.onclick = () => {
    const newTitle = document.getElementById('new-chat-title')?.value.trim();
    if (newTitle) { thread.title = newTitle; thread.updatedAt = Date.now(); DbService.setMainProfile(); renderChatThreadsNav(); }
    closeMo('mo-new-chat');
    if (title) title.textContent = '💬 新しいチャットを作成';
    if (btn) { btn.textContent = '作成'; btn.onclick = confirmCreateNewChat; }
  }; }
  showMo('mo-new-chat');
  setTimeout(() => { const inp = document.getElementById('new-chat-title'); if(inp) { inp.select(); inp.focus(); } }, 100);
};

window.deleteCurrentChat = () => {
  if (S.chatThreads.length <= 1) { showToast('最後のチャットは削除できません', 'warn'); return; }
  const thread = S.chatThreads.find(t => t.id === window.currentChatThreadId);
  const threadTitle = thread ? thread.title : 'このチャット';
  showConfirm(
    '🗑️ チャットを削除',
    `「${threadTitle}」の履歴をすべて削除しますか？この操作は取り消せません。`,
    '削除する',
    () => {
      const LEGACY_DEFAULT_ID = 'th_default';
      const msgsToDelete = S.chatHistory.filter(m => (m.threadId || LEGACY_DEFAULT_ID) === window.currentChatThreadId);
      msgsToDelete.forEach(m => {
        DbService.del('chatHistory', m.id);
        if (m.fileData) { Blobs.del('chat_' + m.id); BlobSync.remove('chat_' + m.id); }
      });
      S.chatHistory = S.chatHistory.filter(m => (m.threadId || LEGACY_DEFAULT_ID) !== window.currentChatThreadId);
      S.chatThreads = S.chatThreads.filter(t => t.id !== window.currentChatThreadId);
      window.currentChatThreadId = S.chatThreads[0].id;
      DbService.setMainProfile();
      renderChat();
      showToast('チャットを削除しました');
    }
  );
};

// Markdownレンダリング関数（ストリーミング中の途中表示でも使う）
const renderChatMd = (raw) => {
  return esc(raw)
    .replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s(.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^[\-\*]\s(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
};

// 🔗 Web検索の出典リンク。AIのボーダー情報などは外れることがあるので必ず出典を見せる
// チャットは毎回検索するとは限らないので、出典が無いときは何も出さない
const renderSources = (sources) => renderSourceChips(sources, '出典（AIがWeb検索した情報源）', '');

// AI回答の下に出す操作ボタン（再生成・読み上げ・ノート保存）
const renderAiActions = (msgId) => `<div class="cb-actions">
  <button class="cb-regen" onclick="regenMsg('${msgId}')">↺ 再生成</button>
  <button class="cb-regen" onclick="speakMsg('${msgId}')" id="speak-${msgId}">🔊 読み上げ</button>
  <button class="cb-regen" onclick="saveMsgAsNote('${msgId}')">📥 ノートに保存</button>
</div>`;

// 🔊 AI回答の読み上げ（移動中の復習用）。もう一度押すと停止
window.speakMsg = (msgId) => {
  if (!('speechSynthesis' in window)) { showToast('このブラウザは読み上げに対応していません', 'warn'); return; }
  const btn = document.getElementById('speak-' + msgId);
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    document.querySelectorAll('[id^="speak-"]').forEach(b => b.textContent = '🔊 読み上げ');
    if (_speakingId === msgId) { _speakingId = null; return; }
  }
  const msg = (S.chatHistory || []).find(m => m.id === msgId);
  if (!msg) return;
  // 記号だらけだと読み上げが不自然になるのでMarkdown記号を落とす
  const plain = String(msg.text || '').replace(/[#*`_>|]/g, '').replace(/\[(\d+)\]/g, '').trim();
  if (!plain) return;
  const u = new SpeechSynthesisUtterance(plain);
  u.lang = 'ja-JP'; u.rate = 1.05;
  const jaVoice = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('ja'));
  if (jaVoice) u.voice = jaVoice;
  u.onend = () => { _speakingId = null; if (btn) btn.textContent = '🔊 読み上げ'; };
  u.onerror = () => { _speakingId = null; if (btn) btn.textContent = '🔊 読み上げ'; };
  _speakingId = msgId;
  if (btn) btn.textContent = '⏹ 停止';
  speechSynthesis.speak(u);
};
let _speakingId = null;

// 📥 AIの回答をそのままノートとして保存する
window.saveMsgAsNote = async (msgId) => {
  const msg = (S.chatHistory || []).find(m => m.id === msgId);
  if (!msg) return;
  const text = String(msg.text || '').trim();
  if (!text) { showToast('保存できる内容がありません', 'warn'); return; }
  showToast('📥 AIが要約してノートにしています...');
  const noteId = generateId();
  let title = text.replace(/[#*`]/g, '').split('\n').find(l => l.trim())?.slice(0, 15) || 'AIの回答';
  let summary = text.replace(/\s+/g, ' ').slice(0, 80);
  let subject = 'AIの回答';
  let keywords = [];
  try {
    const raw = await AiService.call(
      `次の文章に、検索用のタイトル・科目・要約・キーワードを付けてください。\n科目は [${getSubjectsFromTimetable().join(', ')}] から最も近いものを1つ、無ければ "その他"。\n出力はJSONのみ: {"title":"15文字以内","subject":"科目名","summary":"80文字程度","keywords":["語1","語2","語3"]}\n\n---\n${text.slice(0, 4000)}`,
      'あなたは文章を整理するAIです。JSONのみを出力します。', null, true, false, [], 'fast');
    const j = AiService.extractJson(raw);
    title = j.title || title; subject = j.subject || subject;
    summary = j.summary || summary; keywords = Array.isArray(j.keywords) ? j.keywords : [];
  } catch (e) { /* AIが失敗しても本文はそのまま保存する */ }

  const noteObj = { id: noteId, date: DateManager.getTodayStr(), title, subject, summary, keywords, text, pageCount: 1, hasImages: false, fromChat: true };
  S.notes.unshift(noteObj); DbService.set('notes', noteObj);
  renderNotes();
  showToast(`📚 ノート「${title}」として保存しました`);
};

const renderChat = (loadingTid = null) => {
  const el = document.getElementById('chat-msgs'); if (!el) return;
  renderChatThreadsNav();
  
  const LEGACY_DEFAULT_ID = 'th_default';
  const currentMessages = (S.chatHistory || []).filter(m => (m.threadId || LEGACY_DEFAULT_ID) === window.currentChatThreadId);
  
  if (currentMessages.length === 0) { 
    el.innerHTML = '<div class="cb cb-ai">こんにちは！君の全学習状況、成績、予定などはすべて把握しています。悩みや質問があればいつでも相談してね！📚</div>'; 
    return; 
  }

  const renderMd = renderChatMd;

  let html = currentMessages.map((m, idx) => {
    if (m.role === 'ai') {
      return `<div class="cb cb-ai" data-mid="${m.id}">${renderMd(m.text)}${renderSources(m.sources)}${renderAiActions(m.id)}</div>`;
    }
    // ファイル添付対応ユーザーバブル
    let uHtml = '';
    if (m.fileData) {
      if (m.fileData.isImage && m.fileData.base64) {
        uHtml += '<img class="cb-img" src="data:' + esc(m.fileData.mimeType) + ';base64,' + m.fileData.base64 + '" onclick="chatImgToggle(this)">';
      } else if (m.fileData.isImage) {
        // 中身は端末内 or クラウドにある。描画後に hydrateChatImages が読み込んで差し込む
        uHtml += '<div class="cb-pdf" data-chatblob="' + esc(m.id) + '">🖼 画像を読み込み中...</div>';
      } else if (m.fileData.isPdf) {
        uHtml += '<div class="cb-pdf">📄 PDF添付</div>';
      }
    }
    if (m.text) uHtml += (uHtml ? '<br>' : '') + esc(m.text).replace(/\n/g,'<br>');
    if (!uHtml) uHtml = esc(m.displayText || '').replace(/\n/g,'<br>');
    return '<div class="cb cb-user">' + uHtml + '</div>';
  }).join('');
  // 回答の受信中に同期などで描き直されても、受信中の吹き出しが消えないようにする
  if (!loadingTid && _chatPending && _chatPending.threadId === window.currentChatThreadId) loadingTid = _chatPending.tid;
  if (loadingTid) {
    const partial = _chatPending?.tid === loadingTid ? _chatPending.text : '';
    html += `<div class="cb cb-ai" id="${loadingTid}">${partial ? renderChatMd(partial) + '<span class="cb-caret">▊</span>' : '<span style="opacity:.6">考え中...</span>'}</div>`;
  }
  el.innerHTML = html; el.scrollTop = el.scrollHeight;
  hydrateChatImages();
};
// 受信中の回答 { tid, threadId, text }
let _chatPending = null;

// 再読み込み後や別の端末では、添付画像の中身がメモリに無い。端末内→クラウドの順で探して表示する
const hydrateChatImages = async () => {
  const holders = [...document.querySelectorAll('#chat-msgs [data-chatblob]')];
  for (const h of holders) {
    const id = h.dataset.chatblob;
    const msg = (S.chatHistory || []).find(m => m.id === id);
    if (!msg?.fileData) continue;
    const files = await BlobSync.fetch('chat_' + id);
    if (!files?.length) { if (h.isConnected) h.textContent = '🖼 画像（この端末には保存されていません）'; continue; }
    msg.fileData.base64 = files[0].base64;   // 次の描画からはすぐ出せるようにメモリに持つ
    if (!h.isConnected) continue;
    const img = document.createElement('img');
    img.className = 'cb-img';
    img.src = 'data:' + (files[0].mimeType || msg.fileData.mimeType) + ';base64,' + files[0].base64;
    img.onclick = () => chatImgToggle(img);
    h.replaceWith(img);
  }
};

// チャット返答の再生成
// 📚 質問に関係する教材のページを、📚ボタンを押していなくても自動で探して返す。
// 検索は端末内で完結するのでAPIは消費しない。関係するページが無ければ null（何も足さない）。
// 出願・日程など外部の最新情報を聞いているときは、教材を見ても答えは無いので探さない。
const chatAutoTextbook = async (msg) => {
  if (!msg || typeof TB === 'undefined' || shouldUrgeWebSearch(msg)) return null;
  try {
    await TB.load();
    if (!(TB.index || []).length) return null;
    const hits = await TB.autoPick(msg, { limit: 6 });
    if (!hits.length) return null;
    const ctx = await TB.buildContext(hits, 3000);
    return ctx.text ? ctx : null;
  } catch (e) { console.warn('教材の自動検索に失敗（無視して続行）', e); return null; }
};
const CHAT_AUTO_TB_HEAD = '\n\n【生徒の手元の教材から、質問に関係しそうなページを自動で探しました】\n';
const CHAT_AUTO_TB_TAIL = '\n※この教材の内容が質問に関係する場合は、これを根拠に答え、「（書名 p.12）」の形で出典を示すこと。関係しない場合は無視してよい。'
  + 'スキャンを機械で文字にしたページは誤字が混じるので、文脈から補って読むこと。';

window.regenMsg = async (msgId) => {
  const LEGACY_DEFAULT_ID = 'th_default';
  const currentMessages = S.chatHistory.filter(m => (m.threadId || LEGACY_DEFAULT_ID) === window.currentChatThreadId);
  const idx = currentMessages.findIndex(m => m.id === msgId);
  if (idx < 1) return; // AI返答の直前にユーザーメッセージが必要
  const prevUser = currentMessages[idx - 1];
  if (prevUser.role !== 'user') return;

  // 対象AIメッセージをローディング状態に
  const el = document.getElementById('chat-msgs');
  const bubble = el?.querySelector(`[data-mid="${msgId}"]`);
  if (bubble) bubble.innerHTML = '<span style="opacity:.6">再生成中...</span>';

  try {
    const apiHistory = buildApiHistory(currentMessages.slice(0, idx - 1));
    const parts = getContextParts();
    const stablePart = 'あなたは生徒の全状況を完全に把握する専属の塾講師AIです。\n\n【生徒の全データ】\n' + parts.stable;
    const useSearch = shouldUseWebSearch(prevUser.text, false);
    const autoTb = await chatAutoTextbook(prevUser.text);
    const sys = parts.volatile
      + (autoTb ? CHAT_AUTO_TB_HEAD + autoTb.text + CHAT_AUTO_TB_TAIL : '')
      + '\n\n生徒の現状と過去のチャット履歴を踏まえて、励ましつつ実践的な助言をして。'
      + (useSearch ? (shouldUrgeWebSearch(prevUser.text)
          ? 'この質問は最新の外部情報が要るので、記憶で答えず必ずWeb検索して、信憑性の高い情報を回答に含めて。'
          : 'アプリ内の情報や教材で足りないときは、Web検索で信憑性の高い最新情報を調べて補って。') : '');
    const onChunk = (accumulated) => {
      // 同期などで描き直されると吹き出しが作り直されるので、毎回探し直す
      const b = document.getElementById('chat-msgs')?.querySelector(`[data-mid="${msgId}"]`);
      if (b) b.innerHTML = renderChatMd(accumulated) + '<span class="cb-caret">▊</span>';
    };
    // 元の質問に添付があった場合は、それも一緒に送り直す
    let regenFile = null;
    if (prevUser.fileData) {
      const b64 = prevUser.fileData.base64 || (await BlobSync.fetch('chat_' + prevUser.id))?.[0]?.base64;
      if (b64) regenFile = { base64: b64, mimeType: prevUser.fileData.mimeType };
    }
    const { text: raw, sources } = await AiService.request({
      prompt: prevUser.text || 'この添付ファイルの内容について教えてください。', system: sys, systemStable: stablePart,
      fileData: regenFile, useSearch, history: apiHistory, purpose: 'normal', onChunk, maxOutputTokens: 4096
    });
    // 古いAIメッセージを新しい内容で上書き
    const target = S.chatHistory.find(m => m.id === msgId);
    if (target) { target.text = raw; target.sources = sources || []; DbService.set('chatHistory', target); }
    renderChat();
  } catch(e) {
    if (bubble) bubble.innerHTML = `<span style="color:var(--a2)">再生成失敗: ${esc(e.message)}</span><button class="cb-regen" onclick="regenMsg('${msgId}')">↺ 再試行</button>`;
  }
};

window.toggleChatSearch = () => {
  const bar = document.getElementById('chat-search-bar');
  const inp = document.getElementById('chat-search-inp');
  if (!bar) return;
  const isOpen = bar.style.display !== 'none';
  if (isOpen) { clearChatSearch(); } else { bar.style.display = 'block'; if (inp) inp.focus(); }
};

window.clearChatSearch = () => {
  const bar = document.getElementById('chat-search-bar');
  const inp = document.getElementById('chat-search-inp');
  const res = document.getElementById('chat-search-result');
  if (bar) bar.style.display = 'none'; if (inp) inp.value = ''; if (res) res.innerHTML = '';
  renderChat();
};

window.searchChat = () => {
  const q = (document.getElementById('chat-search-inp')?.value || '').trim().toLowerCase();
  const res = document.getElementById('chat-search-result');
  const msgEl = document.getElementById('chat-msgs');
  if (!q) { if (res) res.innerHTML = ''; renderChat(); return; }
  
  const LEGACY_DEFAULT_ID = 'th_default';
  const currentMessages = (S.chatHistory || []).filter(m => (m.threadId || LEGACY_DEFAULT_ID) === window.currentChatThreadId);
  const hits = currentMessages.filter(m => (m.text || '').toLowerCase().includes(q));
  
  if (res) res.textContent = `${hits.length} 件ヒット`;
  if (!msgEl) return;
  if (hits.length === 0) { msgEl.innerHTML = `<div class="empty">「${esc(q)}」に一致するメッセージがありません</div>`; return; }
  
 const reQ = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  msgEl.innerHTML = hits.map(m => {
    const safeText = esc(m.text); // 先に全文を安全に変換
    const highlighted = safeText.replace(reQ, match => `<mark style="background:#fde68a;border-radius:2px;padding:0 2px">${match}</mark>`);
    return `<div class="cb cb-${m.role}" style="opacity:1">${highlighted.replace(/\n/g, '<br>')}</div>`;
  }).join('');
  msgEl.scrollTop = 0;
};

// ===== チャット履歴 → API形式への変換 =====
// 全件そのまま送ると (1) 画像/PDFのbase64が累積して20MB上限を超え chat が 400 で死ぬ
// (2) 毎回の入力トークンが膨らんで遅く・高くなる。直近のみを送るようにする。
const CHAT_HISTORY_TURNS = 20;   // 直近何件のメッセージを送るか
const CHAT_HISTORY_FILES = 2;    // そのうち添付ファイルを残す件数（新しいものを優先）

const buildApiHistory = (messages) => {
  // 過去のエラーメッセージは文脈として無意味なので送らない
  let recent = messages.filter(m => !(m.role === 'ai' && typeof m.text === 'string' && m.text.startsWith('エラー: ')));
  recent = recent.slice(-CHAT_HISTORY_TURNS);
  // 先頭は必ず user から始める（Gemini は model 始まりの履歴を受け付けない）
  while (recent.length && recent[0].role !== 'user') recent.shift();

  let filesLeft = CHAT_HISTORY_FILES;
  const out = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const h = recent[i];
    const parts = [{ text: h.text || h.displayText || '' }];
    if (h.fileData?.base64 && filesLeft > 0) {
      parts.push({ inlineData: { mimeType: h.fileData.mimeType, data: h.fileData.base64 } });
      filesLeft--;
    } else if (h.fileData) {
      parts[0].text = (parts[0].text ? parts[0].text + '\n' : '') + '（※以前添付したファイル。内容は省略）';
    }
    out.unshift({ role: h.role === 'ai' ? 'model' : 'user', parts });
  }
  // エラー行を除いた結果 user が連続することがあるため、同じ role は1ターンにまとめる
  const merged = [];
  for (const turn of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) prev.parts.push(...turn.parts);
    else merged.push(turn);
  }
  return merged;
};

// ===== Web検索を使うかどうか =====
// 検索結果は入力トークンに上乗せされるので、毎回オンにすると無駄が大きい。
// 「外の・変わる情報」を聞かれたときだけ自動でオンにする。🔎ボタンで手動切替も可能。
// 「外の・変わる情報」を指す語だけに絞る。「いつ」「どこ」「変更」のような日常語を入れると
// 「いつも眠い」「どこが間違い？」まで検索が走って無駄にトークンを使う。
const WEB_SEARCH_HINTS = /(倍率|ボーダー|合格最低点|偏差値|配点|試験日|日程|締切|願書|募集要項|入試|出願|学費|受験料|試験会場|オープンキャンパス|今年度|来年度|前年度|最新|過去問|出題傾向|ニュース|調べて|検索して|何日まで|いつまで)/;
window._chatForceSearch = null;   // null=AIに任せる / true=必ず調べさせる / false=しない

// 検索ツールをAIに「渡すかどうか」。
// 渡すだけなら費用はかからず、AIが必要と判断して実際に検索したときだけ検索ぶんが乗る。
// だから既定では渡しておき、AIがアプリの外の情報も読めるようにする。
// 📚で教材を自分で添付したときだけは、教材を根拠に答えてほしい場面なので渡さない。
const shouldUseWebSearch = (msg, hasTextbook) => {
  if (window._chatForceSearch === false) return false;
  if (window._chatForceSearch === true) return true;
  return !hasTextbook;
};
// 入試日程や倍率のように「外の・変わる情報」を聞かれたら、記憶で答えず必ず調べるよう念を押す
const shouldUrgeWebSearch = (msg) =>
  window._chatForceSearch === true || (window._chatForceSearch !== false && WEB_SEARCH_HINTS.test(String(msg || '')));

window.toggleWebSearchMode = () => {
  const order = [null, true, false];
  window._chatForceSearch = order[(order.indexOf(window._chatForceSearch) + 1) % order.length];
  const btn = document.getElementById('chat-websearch-btn');
  const label = window._chatForceSearch === null ? '🔎' : window._chatForceSearch ? '🔎✓' : '🔎✕';
  const msg = window._chatForceSearch === null ? 'Web検索：AIに任せる（必要なときだけ調べます）'
            : window._chatForceSearch ? 'Web検索：必ず調べさせる' : 'Web検索：しない';
  if (btn) { btn.textContent = label; btn.title = msg; }
  showToast(msg);
};

// ===== チャット ファイル添付 状態管理 =====
let _chatAttachedFile = null;

window.onChatFileSelected = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const isImage = file.type.startsWith('image/');
  const isPdf   = file.type === 'application/pdf';
  // 形式・サイズチェック（inlineData方式はリクエスト全体20MBまで＝実ファイル14MB相当）
  if (!validateUpload(file)) return;
  try {
    // 画像は送信前に縮小する（スマホ写真をそのまま送ると遅く・高くなる）
    const { base64, mimeType, size, originalSize } = await prepareFileData(file);
    const previewUrl = isImage ? 'data:' + mimeType + ';base64,' + base64 : null;
    _chatAttachedFile = { base64, mimeType, name: file.name, size, originalSize, previewUrl, isImage, isPdf };
    renderChatFilePreview();
  } catch(e) { showToast('ファイルの読み込みに失敗しました: ' + e.message, 'error'); }
};

// 🎤 音声入力（Web Speech API）。非対応ブラウザではボタン自体を隠す
let _recognition = null, _recognizing = false;
window.toggleVoiceInput = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('chat-mic-btn');
  if (!SR) { showToast('このブラウザは音声入力に対応していません', 'warn'); return; }
  if (_recognizing && _recognition) { _recognition.stop(); return; }

  const inp = document.getElementById('chat-in');
  const baseText = inp ? inp.value : '';
  _recognition = new SR();
  _recognition.lang = 'ja-JP';
  _recognition.interimResults = true;
  _recognition.continuous = false;
  _recognition.onstart = () => { _recognizing = true; if (btn) { btn.textContent = '⏹'; btn.classList.add('mic-on'); } showToast('🎤 話してください...', 'success', 2000); };
  _recognition.onresult = (ev) => {
    let txt = '';
    for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
    if (inp) { inp.value = (baseText ? baseText + ' ' : '') + txt; inp.dispatchEvent(new Event('input')); }
  };
  _recognition.onerror = (ev) => {
    if (ev.error === 'not-allowed') showToast('マイクの使用が許可されていません', 'error');
    else if (ev.error !== 'aborted' && ev.error !== 'no-speech') showToast('音声入力エラー: ' + ev.error, 'error');
  };
  _recognition.onend = () => { _recognizing = false; if (btn) { btn.textContent = '🎤'; btn.classList.remove('mic-on'); } };
  try { _recognition.start(); } catch (e) { _recognizing = false; }
};

// 添付のプレビュー。画像・PDFと「教材の抜粋」は同時に付けられるので、必ず両方をここで描く。
// 片方だけを innerHTML で書くと、もう片方が見えないまま送信されてしまう。
const renderChatFilePreview = () => {
  const wrap = document.getElementById('chat-file-preview-wrap');
  if (!wrap) return;
  const f = _chatAttachedFile;
  const tb = window._chatTextbookContext;
  if (!f && !tb) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }

  let html = '';
  if (f) {
    const sizeStr = f.size < 1024*1024 ? Math.round(f.size/1024) + ' KB' : (f.size/1024/1024).toFixed(1) + ' MB';
    const mediaHtml = f.isImage
      ? '<img src="' + f.previewUrl + '" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;">'
      : '<div class="chat-file-preview-icon">📄</div>';
    html += '<div class="chat-file-preview">'
      + mediaHtml
      + '<div class="chat-file-preview-info">'
      + '<div class="chat-file-preview-name">' + esc(f.name) + '</div>'
      + '<div class="chat-file-preview-size">' + sizeStr + (f.isPdf ? ' (PDF)' : '') + '</div>'
      + '</div>'
      + '<button class="chat-file-remove" onclick="removeChatFile()" title="削除">×</button>'
      + '</div>';
  }
  if (tb) {
    const used = tb.used || [];
    html += '<div class="chat-file-preview">'
      + '<div class="chat-file-preview-icon">📚</div>'
      + '<div class="chat-file-preview-info">'
      + '<div class="chat-file-preview-name">教材 ' + used.length + 'ページを添付</div>'
      + '<div class="chat-file-preview-size">' + esc(used.slice(0, 3).map(u => u.title + ' p.' + u.n).join(' / ')) + (used.length > 3 ? ' ほか' : '') + '</div>'
      + '</div>'
      + '<button class="chat-file-remove" onclick="tbClearChatContext()" title="外す">×</button>'
      + '</div>';
  }
  wrap.style.display = 'block';
  wrap.innerHTML = html;
};

window.removeChatFile = () => { _chatAttachedFile = null; renderChatFilePreview(); };

window.chatImgToggle = (img) => {
  const expanded = img.dataset.expanded === '1';
  img.style.maxWidth  = expanded ? '220px' : '100%';
  img.style.maxHeight = expanded ? '200px' : 'none';
  img.dataset.expanded = expanded ? '0' : '1';
};

window.doChat = async () => {
  const inp = document.getElementById('chat-in');
  const msg = inp.value.trim();
  const fileData = _chatAttachedFile ? { base64: _chatAttachedFile.base64, mimeType: _chatAttachedFile.mimeType } : null;
  if (!msg && !fileData) return;
  inp.value = '';
  const attachedName = _chatAttachedFile ? _chatAttachedFile.name : '';
  const attachedIsImage = _chatAttachedFile ? _chatAttachedFile.isImage : false;
  const attachedIsPdf   = _chatAttachedFile ? _chatAttachedFile.isPdf   : false;
  _chatAttachedFile = null; renderChatFilePreview();
  if(!S.chatHistory) S.chatHistory = [];
  
  const searchBar = document.getElementById('chat-search-bar');
  if (searchBar && searchBar.style.display !== 'none') clearChatSearch();

  const LEGACY_DEFAULT_ID = 'th_default';
  const currentMessages = S.chatHistory.filter(m => (m.threadId || LEGACY_DEFAULT_ID) === window.currentChatThreadId);
  const apiHistory = buildApiHistory(currentMessages);

  // fileData: メモリ内はbase64込み、Firebase保存時はbase64を除外（サイズ超過防止）
  const userMsg = {
    id: generateId(), role: 'user', text: msg,
    displayText: msg || (attachedName ? '📎 ' + attachedName : ''),
    fileData: fileData ? { mimeType: fileData.mimeType, base64: fileData.base64, isImage: attachedIsImage, isPdf: attachedIsPdf } : null,
    timestamp: Date.now(), threadId: window.currentChatThreadId
  };
  S.chatHistory.push(userMsg);
  // Firestoreの1MB上限に入らないので、メッセージ本体からは base64 を外して保存される（DbService._forServer）。
  // 添付の中身は端末内に保存し、分割してクラウドにも上げる（再読み込み後・他の端末でも見られるように）
  DbService.set('chatHistory', userMsg);
  if (fileData) BlobSync.save('chat_' + userMsg.id, [{ mimeType: fileData.mimeType, base64: fileData.base64 }]);

  const thread = S.chatThreads.find(t => t.id === window.currentChatThreadId);
  if (thread) thread.updatedAt = Date.now();
  DbService.setMainProfile();

  // 受信中に別のチャットへ切り替えても、返事は質問したチャットに入れる
  const threadId = window.currentChatThreadId;
  const tid = 't-' + Date.now();
  _chatPending = { tid, threadId, text: '' };
  renderChat(tid);
  try {
    // 📚 教材の抜粋が添えられているときは、生徒データ全部ではなく要点だけを渡す。
    // 教材の中身を答えるのに学習ログ9万字は要らないうえ、余計な情報は回答をぶれさせる。
    let tb = window._chatTextbookContext || null;

    // 📚ボタンを押していなくても、質問に関係する教材のページがあれば自動で拾って渡す。
    // 採用の基準は TB.autoPick を参照（雑談に無関係なページを混ぜてAPI代を無駄にしないため厳しめ）。
    const autoTb = tb ? null : await chatAutoTextbook(msg);
    const useSearch = shouldUseWebSearch(msg, !!tb);
    const stablePart = tb
      ? null
      : 'あなたは生徒の全状況を完全に把握する専属の塾講師AIです。\n\n【生徒の全データ】\n' + getContextParts().stable;
    const sys = tb
      ? 'あなたは生徒の手元にある教材を読んで教える専属の塾講師AIです。\n'
        + '・【教材】の本文を最優先の根拠にし、書かれていないことは「教材には見当たりません」と言うこと。\n'
        + '・使った箇所は「（書名 p.12）」の形で示すこと。\n'
        + '・スキャンを機械で文字にしたページは誤字が混じるので、文脈から補って読むこと。\n\n'
        + '【生徒の状況（要点）】\n' + getLightContext()
        + '\n\n【教材の該当ページ】\n' + tb.ctx
      : getContextParts().volatile
        + (autoTb ? CHAT_AUTO_TB_HEAD + autoTb.text + CHAT_AUTO_TB_TAIL : '')
        + '\n\n生徒の現状と過去のチャット履歴を踏まえて、励ましつつ実践的な助言をして。'
        + (useSearch ? (shouldUrgeWebSearch(msg)
            ? 'この質問は最新の外部情報が要るので、記憶で答えず必ずWeb検索して、信憑性の高い情報を回答に含めて。'
            : 'アプリ内の情報や教材で足りないときは、Web検索で信憑性の高い最新情報を調べて補って。') : '')
        + '画像やPDFが送られた場合は内容を詳しく読み取って答えてください。';
    const sendMsg = msg || (fileData ? 'この' + (attachedIsPdf ? 'PDF' : '画像') + 'の内容について教えてください。' : '');
    if (tb && typeof tbClearChatContext === 'function') tbClearChatContext();

    // ストリーミング：届いた分から順に吹き出しへ書き込む（体感速度が大きく変わる）
    const onChunk = (accumulated) => {
      if (_chatPending?.tid === tid) _chatPending.text = accumulated;
      // 吹き出しは途中で描き直されることがあるので、毎回探し直す
      const bubble = document.getElementById(tid);
      if (!bubble) return;
      bubble.innerHTML = renderChatMd(accumulated) + '<span class="cb-caret">▊</span>';
      const box = document.getElementById('chat-msgs');
      if (box) box.scrollTop = box.scrollHeight;
    };
    const { text: raw, sources } = await AiService.request({
      prompt: sendMsg, system: sys, systemStable: stablePart, fileData,
      useSearch, history: apiHistory, purpose: 'normal', onChunk, maxOutputTokens: 4096
    });

    const aiMsg = { id: generateId(), role: 'ai', text: raw, sources: sources || [], timestamp: Date.now(), threadId };
    if (_chatPending?.tid === tid) _chatPending = null;
    S.chatHistory.push(aiMsg); DbService.set('chatHistory', aiMsg); renderChat();
    maybeAutoTitleThread(threadId);
  } catch(e) {
    const errMsg = { id: generateId(), role: 'ai', text: 'エラー: ' + e.message, timestamp: Date.now(), threadId };
    if (_chatPending?.tid === tid) _chatPending = null;
    S.chatHistory.push(errMsg); DbService.set('chatHistory', errMsg); renderChat();
  }
};

// 💬 スレッド名の自動生成
// 既定名のままのスレッドで最初のやり取りが終わったら、内容から短い題名を付ける
const AUTO_TITLE_DEFAULTS = ['メインチャット', '新しいチャット'];
const maybeAutoTitleThread = async (threadId = window.currentChatThreadId) => {
  const thread = S.chatThreads.find(t => t.id === threadId);
  if (!thread || thread.autoTitled) return;
  if (!AUTO_TITLE_DEFAULTS.includes(thread.title)) return;
  const LEGACY_DEFAULT_ID = 'th_default';
  const msgs = S.chatHistory.filter(m => (m.threadId || LEGACY_DEFAULT_ID) === threadId);
  if (msgs.length < 2) return;
  const firstUser = msgs.find(m => m.role === 'user');
  const firstAi = msgs.find(m => m.role === 'ai' && !String(m.text||'').startsWith('エラー: '));
  if (!firstUser || !firstAi) return;
  try {
    const raw = await AiService.call(
      `次のやり取りに、内容がひと目で分かる日本語のタイトルを1つ付けてください。12文字以内、記号や鉤括弧は使わず、タイトルのみを出力すること。\n\n生徒: ${String(firstUser.text||'').slice(0,300)}\nAI: ${String(firstAi.text||'').slice(0,300)}`,
      'あなたは短い見出しを付けるAIです。タイトルだけを出力します。', null, false, false, [], 'fast');
    const title = raw.replace(/[「」『』"'#*\n]/g, '').trim().slice(0, 14);
    if (!title) return;
    thread.title = title; thread.autoTitled = true; thread.updatedAt = Date.now();
    DbService.setMainProfile();
    renderChatThreadsNav();
  } catch (e) { /* 失敗しても既定名のままで問題ない */ }
};


