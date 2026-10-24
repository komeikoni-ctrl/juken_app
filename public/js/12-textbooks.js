// ============================================================
// 📚 教材ライブラリ（塾テキスト・参考書・教科書の全文検索＋AI質問）
// ============================================================
// PDFそのものはアプリに入れない。パソコン側（tools/extract_textbooks.py と
// ocr_textbooks.py）で抜き出した「ページ単位のテキスト」だけを端末に取り込む。
//
// ・公開URL（Hosting の public/）には置かない。著作物なので誰でも取れる場所に載せない
// ・保存先は端末の IndexedDB と、本人の Firestore（端末間の同期用。TBSync 参照）
//   ⚠️ Firestore に認証を入れるまでは、ルールが開いていれば第三者も読める点に注意
// ・質問のたびに画像をAIへ送らない。ヒットした数ページの文字だけ送る
//   → APIの消費が画像方式のおよそ1/10以下で済む
// ============================================================

const TB_INDEX_KEY = 'tb_index';           // IndexedDB: 目録
const TB_BOOK_KEY = (id) => 'tb_book_' + id; // IndexedDB: 1冊分のページ本文
const TB_MAX_CONTEXT_CHARS = 7000;         // AIに渡す本文の上限（これで十分効く）
const TB_SNIPPET = 420;                    // 1ページあたりの抜粋の長さ

const TB = {
  index: null,          // [{id,title,subject,folder,pages,textPages,chars}]
  _books: new Map(),    // id -> {pages:[{n,t}]}（一度読んだら使い回す）
  _norm: new Map(),     // id -> [{n, t, nt}] 正規化済み本文

  // ===== 取り込み =====
  // textbook-data/ の中身（index.json と books/*.json、またはまとめた1ファイル）を読む
  importFiles: async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let index = null;
    const books = [];
    for (const f of files) {
      let obj;
      try { obj = JSON.parse(await f.text()); }
      catch (e) { console.warn('読めないファイル', f.name, e); continue; }
      if (Array.isArray(obj?.books) && obj.books[0]?.pages && typeof obj.books[0].pages !== 'number') {
        // まとめた1ファイル形式 { books: [ {..., pages:[{n,t}]} ] }
        obj.books.forEach(b => books.push(b));
        index = { books: obj.books.map(b => ({ ...b, pages: b.pages.length })) };
      } else if (Array.isArray(obj?.books)) {
        index = obj;                       // index.json
      } else if (obj?.id && Array.isArray(obj?.pages)) {
        books.push(obj);                   // books/<id>.json
      }
    }
    if (!index && books.length) {
      index = { books: books.map(b => ({ id: b.id, title: b.title, subject: b.subject, folder: b.folder, pages: b.pages.length, textPages: b.textPages || 0, chars: b.chars || 0 })) };
    }
    if (!index) { showToast('教材データが見つかりませんでした', 'warn'); return; }

    // IndexedDB が使えない環境（プライベートブラウズ等）では保存できないのに
    // 「取り込みました」と出てしまうので、先に書けるかどうかを確かめる
    try { await Blobs.open(); }
    catch (e) { showToast('この環境では教材を保存できません（プライベートブラウズ等）。通常のブラウザでお試しください', 'error', 6000); return; }

    // 既に入っている分と合わせる（差分更新できるように）
    const prev = (await Blobs.get(TB_INDEX_KEY))?.books || [];
    const byId = new Map(prev.map(b => [b.id, b]));
    index.books.forEach(b => byId.set(b.id, { ...(byId.get(b.id) || {}), ...b, pages: typeof b.pages === 'number' ? b.pages : b.pages.length }));

    // 検索用の正規化は取り込み時に済ませておく。
    // iPhone で検索のたびに数十万字を変換すると重いため。
    for (const b of books) {
      const pages = (b.pages || []).filter(p => p.t).map(p => ({ n: p.n, t: p.t, nt: normalizeForSearch(p.t) }));
      await Blobs.set(TB_BOOK_KEY(b.id), { id: b.id, title: b.title, pages });
      TB._forget(b.id);
    }
    // iOS Safari は使わない期間が続くと保存データを消すことがあるので、消さないよう頼んでおく
    try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (e) {}
    const merged = { builtAt: index.builtAt || new Date().toISOString(), books: [...byId.values()] };
    await Blobs.set(TB_INDEX_KEY, merged);
    TB.index = merged.books;

    const withText = merged.books.filter(b => (b.textPages || 0) > 0).length;
    showToast(`📚 教材 ${merged.books.length}冊を取り込みました（本文あり ${withText}冊・${books.length}冊を更新）`);
    renderTextbooks();
    // 取り込んだら、そのまま他の端末にも行き渡るよう自動でクラウドへ上げる（待たずに裏で進める）
    if (typeof window.tbAutoSync === 'function') setTimeout(() => window.tbAutoSync(true), 1500);
  },

  load: async () => {
    if (TB.index) return TB.index;
    const saved = await Blobs.get(TB_INDEX_KEY);
    TB.index = saved?.books || [];
    return TB.index;
  },

  getBook: async (id) => {
    if (TB._books.has(id)) return TB._books.get(id);
    const b = await Blobs.get(TB_BOOK_KEY(id));
    if (b) TB._books.set(id, b);
    return b;
  },

  // 検索用に正規化した本文を用意する（全角半角・カタカナひらがなを吸収）。
  // 教材は200冊・1400万字あるので、全部をメモリに置くとiPhoneが苦しい。
  // 「冊数」ではなく「文字数」で上限を決め、超えたら古いものから捨てる。
  // JSの文字列は1文字2バイトなので、200万字 ≒ 4MB。
  MEM_CHARS: 2000000,
  _memChars: 0,
  // メモリ上の教材を捨てる（文字数カウンタもここで必ず戻す）
  _forget: (id) => {
    const gone = TB._norm.get(id);
    if (gone) TB._memChars -= (gone._chars || 0);
    TB._norm.delete(id); TB._books.delete(id);
  },
  _forgetAll: () => { TB._norm.clear(); TB._books.clear(); TB._memChars = 0; },
  getNormalized: async (id) => {
    if (TB._norm.has(id)) {
      const v = TB._norm.get(id);               // 使ったものを最後尾へ（古いものから捨てる）
      TB._norm.delete(id); TB._norm.set(id, v);
      return v;
    }
    const b = await TB.getBook(id);
    if (!b) return [];
    // 取り込み時に正規化済み（nt）。古いデータのときはその場で作る
    const arr = (b.pages || []).filter(p => p.t).map(p => p.nt ? p : { ...p, nt: normalizeForSearch(p.t) });
    arr._chars = arr.reduce((s, p) => s + p.nt.length, 0);
    TB._norm.set(id, arr);
    TB._memChars += arr._chars;
    while (TB._memChars > TB.MEM_CHARS && TB._norm.size > 1) {
      TB._forget(TB._norm.keys().next().value);
    }
    return arr;
  },

  // ===== 検索 =====
  // クエリを語に分け、語を多く含むページほど上位にする素朴なスコアリング。
  // 教材は100冊・数万ページあるが、正規化済み文字列の indexOf なので十分速い。
  // 日本語は単語の区切りが無いので、文をそのまま検索語にすると何にも当たらない。
  // 漢字・カタカナ・英数の連続を語として取り出す（ひらがなは助詞が多いので長いものだけ）。
  terms: (query) => {
    const raw = String(query || '');
    const rawWords = raw.match(/[一-龥々〆ヵヶ]{2,}|[ァ-ヴー]{2,}|[A-Za-z][A-Za-z0-9']{1,}|[ぁ-ん]{4,}/g) || [];
    // 「ってどんな」「があるの」のような、ひらがなだけの語は助詞や語尾で意味が無い。
    // ⚠️ 判定は正規化の「前」に行うこと。normalizeForSearch はカタカナをひらがなにするので、
    //    正規化後に判定すると「ヘレニズム」が助詞と同じ扱いで捨てられてしまう。
    const contentRaw = rawWords.filter(t => /[^ぁ-ん]/.test(t));
    const pick = contentRaw.length ? contentRaw : rawWords;
    const primary = pick.map(t => normalizeForSearch(t)).filter(t => t.length >= 2);
    // 「仮定法過去完了」のような長い語がそのままでは当たらないとき用に、3文字ずつの窓も用意する
    const fallback = [];
    for (const t of primary) {
      if (t.length >= 5) for (let i = 0; i + 3 <= t.length; i++) fallback.push(t.slice(i, i + 3));
    }
    return { primary: [...new Set(primary)], fallback: [...new Set(fallback)] };
  },

  search: async (query, { subject = '', bookId = '', limit = 12 } = {}) => {
    await TB.load();
    const { primary, fallback } = TB.terms(query);
    let terms = primary;
    if (!terms.length) return [];
    const targets = (TB.index || []).filter(b =>
      (b.textPages || 0) > 0 &&
      (!subject || b.subject === subject) &&
      (!bookId || b.id === bookId));

    const scan = async (words, weight) => {
      const found = [];
      for (const book of targets) {
        const pages = await TB.getNormalized(book.id);
        for (const p of pages) {
          let score = 0, matched = 0;
          for (const t of words) {
            let from = 0, c = 0, i;
            while ((i = p.nt.indexOf(t, from)) >= 0 && c < 8) { c++; from = i + t.length; }
            if (c) { matched++; score += 1 + Math.min(c, 4) * 0.25; }   // 語の種類数を重視、回数は控えめ
          }
          if (!score) continue;
          if (words.length > 1 && matched === words.length) score += 1.5;  // 全語そろったページを優先
          found.push({ bookId: book.id, title: book.title, subject: book.subject, folder: book.folder,
                       n: p.n, score: score * weight, matched, terms: words.length,
                       snippet: TB.snippet(p.t, words) });
        }
      }
      return found;
    };

    let hits = await scan(terms, 1);
    // そのままの語で当たらなければ、3文字ずつに刻んだ語でもう一度だけ探す
    if (!hits.length && fallback.length) hits = await scan(fallback, 0.6);
    hits.sort((a, b) => b.score - a.score || a.n - b.n);
    return TB.dedupeHits(hits, limit);
  },

  // 同じ本のコピー（「〜 (1)」や、別のフォルダに入れた同じPDF）が複数あると、同じページが上位を
  // 独占して、AIに渡せる文字数の枠を同じ内容で使い切ってしまう。
  // 「題名が同じ（末尾の (1) は無視）・ページ番号が同じ・本全体の文字数がほぼ同じ」なら同じ本とみなす。
  dedupeHits: (hits, limit = Infinity) => {
    const chars = new Map((TB.index || []).map(b => [b.id, b.chars || 0]));
    const kept = new Map();      // 題名|ページ -> 採用済みの本の文字数
    const out = [];
    for (const h of hits) {
      if (out.length >= limit) break;
      const key = String(h.title).replace(/\s*[(（]\d+[)）]\s*$/, '').trim() + '|' + h.n;
      const c = chars.get(h.bookId) || 0;
      const same = (kept.get(key) || []).some(k => Math.abs(k - c) <= Math.max(k, c) * 0.1);
      if (same) continue;
      kept.set(key, [...(kept.get(key) || []), c]);
      out.push(h);
    }
    return out;
  },

  // ===== チャット用の自動添付 =====
  // 📚ボタンを押さない普通のチャットに教材を差し込むかどうかを決める。
  // search() の上位をそのまま渡すと、1500万字もあるので「今日」「タスク」程度の語でも
  // どこかのページに当たってしまい、雑談のたびに3000字ぶんのAPI代を無駄にする。
  // そこで「教材の話題になっている語（話題語）」がそろったページだけを採用する。
  //   ・日常語（今日・勉強・志望校名など）は話題語にしない
  //   ・どのページにも出る語（問題・解答など）は話題語にしない
  //   ・ほとんど出ない語（タスク・締切など教材の範囲外の語）も話題語にしない
  //   ・カタカナ語は原文にカタカナで書かれているときだけ当たりとする
  //     （検索用の正規化はカタカナをひらがなにするので、「タスク」が古文の「助く」に当たる）
  //   ・話題語が1つだけなら、同じページに3回以上出ていること（偶然出てきただけのページを拾わない）
  EVERYDAY: new Set(['今日', '明日', '昨日', '今週', '来週', '先週', '今月', '来月', '今年', '去年', '来年', '最近', '毎日', '毎週',
    '時間', '勉強', '学習', '計画', '予定', '方法', '問題', '解答', '質問', '自分', '大学', '学部', '学科', '学校', '先生',
    '受験', '入試', '試験', '本番', '合格', '志望', '志望校', '第一志望', '教科', '科目', '成績', '点数', '得点', '目標',
    '対策', '復習', '予習', '宿題', '課題', '授業', '参考書', '教材', 'テキスト', 'ページ', '過去問', '模試', '偏差値',
    '同志社', '立命館', '近畿', '近大', '関関同立', '経済学部', '経営学部', '商学部', '共通テスト', '出願', '締切',
    'アプリ', 'タスク', 'スケジュール', 'カレンダー', 'メモ', 'コツ', 'ポイント', 'ノート', 'ペース', 'モチベーション', 'メンタル',
    '英語', '数学', '国語', '現代文', '古文', '漢文', '古典', '世界史', '日本史', '地理', '公共', '政治経済',
    '化学', '生物', '物理', '地学', '情報', '理科', '社会'].map(w => normalizeForSearch(w))),

  // 「特定の教科に集中している」とみなす境目。その語が出るページのうち、最多の教科が占める割合。
  // 実測: 一般語は 優先42%・睡眠40%・休憩33%・コツ21%、教科用語は 助動詞46%（英語と古典に分かれる）・
  // 産業革命47%・敬語49%・ルネサンス62%・ヘレニズム95%。
  FOCUS_MIN: 0.45,

  // 語ごとの出現ページ数（df）から話題語を選ぶ。戻り値は words の添字の配列
  topicTerms: (words, df, totalPages) => {
    // 蔵書が多いときだけ下限を設ける（数冊しか無いときは、1ページにしか出ない語も立派な話題語）
    const low = totalPages >= 3000 ? Math.max(5, Math.round(totalPages * 0.0008)) : 1;
    const high = Math.max(40, totalPages * 0.035);
    return words.map((w, i) => i).filter(i => !TB.EVERYDAY.has(words[i]) && df[i] >= low && df[i] <= high);
  },
  // そのページを採用してよいか。counts は語ごとの出現回数、topic は話題語の添字
  // loose=true は「話題語が2つ以上あるのに、そろったページが1つも無かった」ときの救済。
  // 「光合成の仕組み」は教科書では「しくみ」とひらがなで書かれるので2語はそろわない。
  // そのときは、どれか1語が3回以上出る（＝その語を主題にしている）ページを採用する。
  // focused は「特定の教科に集中して出る語」の添字（null なら全部そうだとみなす）。
  // 教科の用語は1つの教科に固まって出る（ヘレニズム→世界史95%、光合成→生物95%）が、
  // 「優先」「休憩」「コツ」のような一般語は全教科に薄く散らばる（最多の教科でも20〜40%）。
  // 当たった語の中に集中型の語が1つも無いページは、勉強の中身の質問ではないとみなして採用しない。
  autoQualifies: (counts, topic, { loose = false, focused = null } = {}) => {
    const hit = topic.filter(i => counts[i] > 0);
    if (focused && !hit.some(i => focused.has(i))) return false;
    if (hit.length >= 2) return true;
    if (hit.length !== 1) return false;
    // 1語だけで決めるときは3回以上。2回だと「優先」「休憩」のような一般語が偶然重なったページを拾う
    return (topic.length === 1 || loose) && counts[hit[0]] >= 3;
  },

  // 自動添付用の語の取り出し。search() 用の terms() より欲張りに拾う：
  //   ・隣り合う語はつないだ形も作る（「フランス」も「革命」も世界史ではありふれているが「フランス革命」は特定的）
  //   ・送り仮名をはさむ語も拾う（「係り結び」→ 係り結、「書き下し文」→ 書き下、し文…）
  //     ただし「の・と・が」などの助詞でつなぐと「現在完了と過去形」のような無意味な語になるので除く
  autoTerms: (query) => {
    const s = String(query || '');
    const seen = new Set();
    const out = [];
    const add = (raw, extra = {}) => {
      const n = normalizeForSearch(raw);
      if (n.length < 2 || seen.has(n)) return;
      seen.add(n);
      out.push({ n, kata: '', weak: false, ...extra });
    };
    const runs = [...s.matchAll(/[一-龥々〆ヵヶ]{2,}|[ァ-ヴー]{2,}|[A-Za-z][A-Za-z0-9']{2,}/g)];
    // カタカナ語は原文と照合するための形も持っておく（長音と空白は読み取りで揺れるので外す）
    runs.forEach(m => add(m[0], /^[ァ-ヴー]+$/.test(m[0]) ? { kata: m[0].replace(/ー/g, '') } : {}));
    for (let k = 0; k + 1 < runs.length; k++) {
      if (runs[k].index + runs[k][0].length === runs[k + 1].index) add(runs[k][0] + runs[k + 1][0]);
    }
    // 「使い方」「求め方」のような「〜方」はどの教科にも出るので、採否には使わず順位づけだけに使う
    (s.match(/[一-龥々]+(?:(?![のとがをにはでもやへ])[ぁ-ん][一-龥々]+)+/g) || [])
      .forEach(r => add(r, { weak: /[ぁ-ん]方$/.test(r) }));
    // 「けり」のようにかぎかっこで名指しされた語は、ひらがなでも拾う
    // （無いと、助動詞「けり」の質問に英語の助動詞のページが出てくる）
    [...s.matchAll(/[「『]([^」』]{2,12})[」』]/g)].forEach(m => add(m[1]));
    return out;
  },

  autoPick: async (query, { limit = 6 } = {}) => {
    await TB.load();
    const terms = TB.autoTerms(query);
    if (!terms.length) return [];
    const words = terms.map(t => t.n);
    const targets = (TB.index || []).filter(b => (b.textPages || 0) > 0);
    const df = words.map(() => 0);
    const bySubject = words.map(() => ({}));      // 語ごとの、教科別の出現ページ数
    const found = [];
    let totalPages = 0;
    for (const book of targets) {
      const pages = await TB.getNormalized(book.id);
      totalPages += pages.length;
      for (const p of pages) {
        let counts = null, literal = null;
        for (let k = 0; k < terms.length; k++) {
          const t = terms[k].n;
          let from = 0, c = 0, i;
          while ((i = p.nt.indexOf(t, from)) >= 0 && c < 8) { c++; from = i + t.length; }
          if (c && terms[k].kata) {
            if (literal === null) literal = p.t.normalize('NFKC').replace(/[ー\s]/g, '');
            if (!literal.includes(terms[k].kata)) c = 0;
          }
          if (c) {
            if (!counts) counts = words.map(() => 0);
            counts[k] = c; df[k]++;
            bySubject[k][book.subject] = (bySubject[k][book.subject] || 0) + 1;
          }
        }
        // ページ本文への参照は持たない（「問題」のような語だと数千ページ分を抱えてiPhoneのメモリを圧迫する）
        if (counts) found.push({ book, n: p.n, counts });
      }
    }
    const topic = TB.topicTerms(words, df, totalPages).filter(i => !terms[i].weak);
    const focused = new Set(topic.filter(i => Math.max(0, ...Object.values(bySubject[i])) / df[i] >= TB.FOCUS_MIN));
    TB._lastAuto = { words, df, topic: topic.map(i => words[i]), focused: [...focused].map(i => words[i]), totalPages };   // 調査用
    if (!focused.size) return [];
    const idf = words.map((w, i) => Math.log(totalPages / Math.max(1, df[i])));
    const topicWords = topic.map(i => words[i]);
    // 話題語ではないが日常語でもない語（「イギリス」「理由」など）は、採否には使わず順位づけにだけ使う。
    // これが無いと、話題語が1つの質問で同点が大量に出て、単にページ番号の若い順になってしまう
    const side = words.map((w, i) => i).filter(i => !topic.includes(i) && !TB.EVERYDAY.has(words[i]) && df[i] > 0);
    let ok = found.filter(f => TB.autoQualifies(f.counts, topic, { focused }));
    if (!ok.length && topic.length >= 2) ok = found.filter(f => TB.autoQualifies(f.counts, topic, { loose: true, focused }));
    const ranked = ok
      .map(f => {
        const hit = topic.filter(i => f.counts[i] > 0);
        let score = hit.reduce((s, i) => s + idf[i] * (1 + Math.min(f.counts[i], 8) * 0.15), 0);
        if (hit.length === topic.length) score *= 1.3;               // 話題語が全部そろったページを優先
        score += side.reduce((s, i) => s + (f.counts[i] ? idf[i] * 0.3 : 0), 0);
        return { bookId: f.book.id, title: f.book.title, subject: f.book.subject, folder: f.book.folder,
                 n: f.n, score, matched: hit.length, terms: topic.length, snippet: '' };
      })
      .sort((a, b) => b.score - a.score || a.n - b.n);
    const top = TB.dedupeHits(ranked, limit);
    for (const h of top) {
      const page = (await TB.getNormalized(h.bookId)).find(x => x.n === h.n);
      if (page) h.snippet = TB.snippet(page.t, topicWords);
    }
    return top;
  },

  // ヒット位置の周辺を切り出す
  snippet: (text, terms) => {
    const nt = normalizeForSearch(text);
    let at = -1;
    for (const t of terms) { const i = nt.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
    // 正規化で文字数がずれるため、おおよその位置として扱う
    const ratio = nt.length ? at / nt.length : 0;
    const center = Math.max(0, Math.round(text.length * ratio));
    const start = Math.max(0, center - Math.round(TB_SNIPPET / 2));
    return (start > 0 ? '…' : '') + text.slice(start, start + TB_SNIPPET).replace(/\s+/g, ' ') + (start + TB_SNIPPET < text.length ? '…' : '');
  },

  // ===== AIに渡す本文を組み立てる =====
  // ヒットしたページの「前後1ページ」も足す。設問と解答が隣のページにあることが多いため。
  buildContext: async (hits, maxChars = TB_MAX_CONTEXT_CHARS) => {
    const wanted = new Map();   // bookId -> Set(page)
    for (const h of hits) {
      if (!wanted.has(h.bookId)) wanted.set(h.bookId, new Set());
      const s = wanted.get(h.bookId);
      s.add(h.n);
      if (s.size < 8) { s.add(h.n - 1); s.add(h.n + 1); }
    }
    let out = '', used = [];
    for (const h of hits) {
      const pages = await TB.getNormalized(h.bookId);
      const nums = [...wanted.get(h.bookId)].filter(n => n >= 1).sort((a, b) => a - b);
      for (const n of nums) {
        const p = pages.find(x => x.n === n);
        if (!p || used.some(u => u.bookId === h.bookId && u.n === n)) continue;
        const block = `\n--- 【${h.title}】${h.folder ? '(' + h.folder + ') ' : ''}p.${n} ---\n${p.t}\n`;
        if (out.length + block.length > maxChars) { if (out) break; }
        out += block;
        used.push({ bookId: h.bookId, title: h.title, n });
      }
      if (out.length >= maxChars) break;
    }
    return { text: out.trim(), used };
  },

  // ===== 質問する =====
  ask: async (question, opts = {}) => {
    const { subject = '', bookId = '', onProgress = null } = opts;
    const say = (t) => { try { onProgress && onProgress(t); } catch (e) {} };
    say('📚 教材を検索中...');
    const hits = await TB.search(question, { subject, bookId, limit: 10 });
    if (!hits.length) return { text: '', hits: [], used: [], notFound: true };

    say('🤖 該当ページをもとに回答を作成中...');
    const { text: ctx, used } = await TB.buildContext(hits);
    const sys = 'あなたは生徒の手元にある教材を読んで教える講師AIです。\n'
      + '・渡された【教材】の本文だけを根拠に答えること。本文に書かれていないことは「教材には見当たりません」と正直に言うこと。\n'
      + '・答えの最後に、使った箇所を「（書名 p.12）」の形で必ず示すこと。\n'
      + '・スキャンを機械で文字にしたページは誤字が混じる。文脈から明らかな誤字は直して読むこと。\n'
      + '・高校生にわかる言葉で、簡潔に。';
    const prompt = `【生徒の質問】\n${question}\n\n【教材の該当ページ】${ctx}`;
    // 教材の内容を答えるだけなのでWeb検索は使わない（そのぶん速くて安い）
    const { text } = await AiService.request({ prompt, system: sys, useSearch: false, purpose: 'normal', maxOutputTokens: 2048 });
    return { text, hits, used, notFound: false };
  }
};

// ============================================================
// ☁️ 教材データのクラウド同期
// ============================================================
// 一度どこかの端末で取り込めば、他の端末には自動で降りてくるようにする。
// ・取り込んだ直後に自動でクラウドへ上げる
// ・起動のたびに、クラウドにあってこの端末に無い教材を自動で降ろす
//
// Firestoreの1ドキュメントは1MBまで。日本語はUTF-8で1文字3バイトになるため、
// 25万文字（≒750KB）ずつに分割する。base64前提の BlobSync より小さい単位が必要。
// 検索用の正規化済み本文（nt）は送らない。受け取った側で作り直せるので、送ると量が倍になるだけ。
//
// ⚠️ 通信は Firestore SDK ではなく REST（fetch）で行う。
//    このアプリは SDK のオフラインキャッシュを有効にしているため、SDK 経由で 750KB の
//    ドキュメントを何百個も読むと、そのたびに SDK が自分のキャッシュにも書き込み、
//    1冊30秒かかるうえ、既定40MBのキャッシュを教材が食い潰して普段のデータまで押し出す。
//    教材は IndexedDB（Blobs）に自前で保存するので、SDK のキャッシュは要らない。
const TBSync = {
  CHUNK: 250000,
  _busy: false,
  _url: (docId) => `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/appData/${DOC_ID}/textbooks/${encodeURIComponent(docId)}?key=${firebaseConfig.apiKey}`,

  // Firestore REST の値の形式との相互変換
  _enc: (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(TBSync._enc) } };
    const fields = {};
    Object.keys(v).forEach(k => { if (v[k] !== undefined) fields[k] = TBSync._enc(v[k]); });
    return { mapValue: { fields } };
  },
  _dec: (v) => {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(TBSync._dec);
    if ('mapValue' in v) { const o = {}; const f = v.mapValue.fields || {}; Object.keys(f).forEach(k => { o[k] = TBSync._dec(f[k]); }); return o; }
    return null;
  },
  _get: async (docId) => {
    const res = await fetch(TBSync._url(docId));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('クラウドから取得できませんでした（' + res.status + '）');
    const f = (await res.json()).fields || {};
    const o = {}; Object.keys(f).forEach(k => { o[k] = TBSync._dec(f[k]); });
    return o;
  },
  _set: async (docId, obj) => {
    const fields = {}; Object.keys(obj).forEach(k => { fields[k] = TBSync._enc(obj[k]); });
    const res = await fetch(TBSync._url(docId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    if (!res.ok) throw new Error('クラウドへ送信できませんでした（' + res.status + '）');
  },

  // 文字列を CHUNK ごとに切る。サロゲートペア（𠮷 や絵文字など2単位で1文字のもの）の
  // 真ん中で切ると、保存時に文字が壊れて JSON として復元できなくなるので、境界を1つ手前にずらす。
  _split: (text) => {
    const out = [];
    let i = 0;
    while (i < text.length) {
      let end = Math.min(text.length, i + TBSync.CHUNK);
      if (end < text.length) {
        const c = text.charCodeAt(end - 1);
        if (c >= 0xD800 && c <= 0xDBFF) end--;
      }
      out.push(text.slice(i, end));
      i = end;
    }
    return out;
  },

  _remoteIndex: async () => ((await TBSync._get('__index')) || {}).books || [],
  _writeIndex: (books) => TBSync._set('__index', { books, updatedAt: Date.now(), device: (typeof DEVICE_ID !== 'undefined' ? DEVICE_ID : '') }),

  // この端末にあってクラウドに無い教材を上げる。
  // 「上げたかどうか」は端末の記録ではなくクラウドの目録と突き合わせて決める
  // （端末の記録に頼ると、クラウド側が消えたときに二度と上がらなくなる）。
  push: async (onProgress) => {
    if (!navigator.onLine) throw new Error('オフラインです');
    const books = await TB.load();
    if (!books.length) throw new Error('取り込んだ教材がありません');
    const remote = await TBSync._remoteIndex();
    const remoteIds = new Set(remote.map(b => b.id));
    const todo = books.filter(b => !remoteIds.has(b.id) && (b.textPages || 0) > 0);
    let n = 0;
    const merged = new Map(remote.map(b => [b.id, b]));
    for (const meta of todo) {
      const book = await TB.getBook(meta.id);
      if (!book) continue;
      const text = JSON.stringify((book.pages || []).map(p => ({ n: p.n, t: p.t })));
      const chunks = TBSync._split(text);
      for (let i = 0; i < chunks.length; i++) {
        await TBSync._set(`${meta.id}__${i}`, { id: meta.id, i, data: chunks[i] });
      }
      // 目録は最後に書く（途中で失敗したものを「ある」と誤認させないため）
      await TBSync._set(`${meta.id}__manifest`, { id: meta.id, chunks: chunks.length, title: book.title });
      merged.set(meta.id, { id: meta.id, title: meta.title, subject: meta.subject || 'その他', folder: meta.folder || '',
                            pages: meta.pages || 0, textPages: meta.textPages || 0, chars: meta.chars || 0 });
      n++;
      onProgress && onProgress(`☁️ 送信中 ${n}/${todo.length}: ${meta.title}`);
      // 途中で止まっても、上げ終えた分は他の端末から見えるように、こまめに目録を更新する
      if (n % 20 === 0) await TBSync._writeIndex([...merged.values()]);
    }
    if (n) await TBSync._writeIndex([...merged.values()]);
    return { sent: n, total: merged.size };
  },

  // クラウドにある教材のうち、この端末に無いものを取ってくる
  pull: async (onProgress) => {
    if (!navigator.onLine) throw new Error('オフラインです');
    const remote = await TBSync._remoteIndex();
    if (!remote.length) return { got: 0, total: 0 };
    const local = new Set((await TB.load()).map(b => b.id));
    const todo = remote.filter(b => !local.has(b.id));
    let n = 0;
    const got = [];
    const saveIndex = async () => {
      const merged = new Map(((await Blobs.get(TB_INDEX_KEY))?.books || []).map(b => [b.id, b]));
      got.forEach(b => merged.set(b.id, b));
      await Blobs.set(TB_INDEX_KEY, { builtAt: new Date().toISOString(), books: [...merged.values()] });
    };
    for (const meta of todo) {
      const m = await TBSync._get(`${meta.id}__manifest`);
      if (!m) continue;
      // 1冊ぶんの分割は並行で取る（順番に取ると200冊で数分かかる）
      const parts = await Promise.all(Array.from({ length: m.chunks || 0 }, (_, i) => TBSync._get(`${meta.id}__${i}`)));
      if (parts.some(c => !c)) continue;                    // 欠けていたら壊れた教材を入れない
      let pages;
      try { pages = JSON.parse(parts.map(c => c.data || '').join('')); } catch (e) { continue; }
      // 検索用の正規化はここで作り直す（送信側は t だけを送っている）
      const full = pages.filter(p => p && p.t).map(p => ({ n: p.n, t: p.t, nt: normalizeForSearch(p.t) }));
      await Blobs.set(TB_BOOK_KEY(meta.id), { id: meta.id, title: meta.title, pages: full });
      got.push(meta);
      n++;
      onProgress && onProgress(`☁️ 受信中 ${n}/${todo.length}: ${meta.title}`);
      // 途中でアプリを閉じても、取れた分は次回から使えるように目録をこまめに保存する
      if (n % 15 === 0) await saveIndex();
    }
    if (n) {
      await saveIndex();
      TB.index = null; TB._forgetAll();
      await TB.load();
      try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (e) {}
    }
    return { got: n, total: remote.length };
  },

  // 受信→送信をまとめて行う。同時に2つ走らせない
  syncAll: async (onProgress) => {
    if (TBSync._busy) return null;
    TBSync._busy = true;
    try {
      const got = await TBSync.pull(onProgress);
      let sent = { sent: 0, total: got.total };
      if ((await TB.load()).length) sent = await TBSync.push(onProgress);
      return { got: got.got, sent: sent.sent, total: Math.max(got.total, sent.total) };
    } finally { TBSync._busy = false; }
  }
};

window.tbSync = async () => {
  const btn = document.getElementById('tb-sync-btn');
  const orig = btn ? btn.textContent : '';
  const say = (t) => { if (btn) btn.textContent = t; };
  if (btn) btn.disabled = true;
  try {
    say('☁️ 同期中...');
    const r = await TBSync.syncAll(say);
    if (!r) { showToast('いま同期中です。終わるまでお待ちください'); return; }
    await renderTextbooks();
    showToast(`☁️ 同期しました（受信${r.got}冊 / 送信${r.sent}冊 / クラウド上 ${r.total}冊）`, 'success', 5000);
  } catch (e) {
    showToast('同期に失敗: ' + e.message, 'error', 5000);
  } finally { if (btn) { btn.textContent = orig; btn.disabled = false; } }
};

// 起動時と取り込み直後に呼ぶ自動同期。失敗しても画面は止めない。
// quiet=true のときは、実際に動きがあったときだけトーストを出す
window.tbAutoSync = async (quiet = true) => {
  try {
    if (!navigator.onLine) return;
    let announced = false;
    const r = await TBSync.syncAll((t) => {
      if (!announced) { announced = true; showToast('☁️ 教材を他の端末と同期しています...', 'success', 4000); }
      const btn = document.getElementById('tb-sync-btn');
      if (btn) btn.textContent = t;
    });
    const btn = document.getElementById('tb-sync-btn');
    if (btn) btn.textContent = '☁️ 他の端末と同期';
    if (r && (r.got || r.sent)) {
      await renderTextbooks();
      showToast(`📚 教材を同期しました（受信${r.got}冊 / 送信${r.sent}冊）`, 'success', 5000);
    } else if (!quiet) {
      showToast('☁️ 教材は同期済みです');
    }
  } catch (e) { console.warn('教材の自動同期に失敗', e); }
};
// 旧名（起動処理から呼ばれている）
window.tbAutoPull = () => window.tbAutoSync(true);

// ===== 画面 =====
window.renderTextbooks = async () => {
  const wrap = document.getElementById('tb-list');
  if (!wrap) return;
  const books = await TB.load();
  const stat = document.getElementById('tb-stat');
  if (!books.length) {
    if (stat) stat.textContent = '';
    wrap.innerHTML = '<div class="muted" style="font-size:12px;line-height:1.7">教材データがまだありません。<br>'
      + 'パソコンで作った <code>textbooks-*.json</code> を、下のボタンから選んでください。<br>'
      + 'iPhone・iPadの場合は、そのファイルを先に iCloud Drive か Google ドライブに入れておくと「ファイル」アプリから選べます。</div>';
    return;
  }
  const withText = books.filter(b => (b.textPages || 0) > 0);
  const chars = books.reduce((s, b) => s + (b.chars || 0), 0);
  if (stat) stat.textContent = `${books.length}冊 / 本文あり${withText.length}冊 / 約${Math.round(chars / 10000)}万字`;

  const bySubject = {};
  books.forEach(b => { (bySubject[b.subject || 'その他'] ||= []).push(b); });
  wrap.innerHTML = Object.keys(bySubject).sort().map(sub => {
    const items = bySubject[sub].sort((a, b) => (b.textPages || 0) - (a.textPages || 0)).map(b => {
      const ok = (b.textPages || 0) > 0;
      const label = ok ? `${b.textPages}/${b.pages}p` : '本文なし';
      // IDは属性で渡す（onclick の文字列に埋めると引用符の扱いで壊れうる）
      return `<button class="tag" ${ok ? '' : 'disabled style="opacity:.45"'} data-tbid="${esc(b.id)}" onclick="tbPickBook(this.dataset.tbid)" title="${esc(b.folder || '')}">${esc(b.title)} <span style="opacity:.6">${label}</span></button>`;
    }).join('');
    return `<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">${esc(sub)}</div><div class="flex-gap">${items}</div></div>`;
  }).join('');
};

window.tbPickBook = (id) => {
  const sel = document.getElementById('tb-book');
  if (sel) { sel.value = sel.value === id ? '' : id; }
  const b = (TB.index || []).find(x => x.id === id);
  showToast(sel && sel.value ? `📖 「${b?.title || ''}」だけを検索します` : '📚 すべての教材を検索します');
  const chip = document.getElementById('tb-scope');
  if (chip) chip.textContent = sel && sel.value ? `📖 ${b?.title || ''}` : '📚 すべての教材';
};

window.tbImport = async (event) => {
  const files = event.target.files;
  if (!files?.length) return;
  const btn = document.getElementById('tb-import-btn');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳ 取り込み中...'; btn.disabled = true; }
  try { await TB.importFiles(files); }
  catch (e) { showToast('取り込み失敗: ' + e.message, 'error'); }
  finally { if (btn) { btn.textContent = orig; btn.disabled = false; } event.target.value = ''; }
};

let _tbAsking = false;
window.tbAsk = async () => {
  if (_tbAsking) return;                          // 連打・Enter連打で回答が上書きされないように
  const inp = document.getElementById('tb-q');
  const q = (inp?.value || '').trim();
  if (!q) { showToast('質問を入力してください', 'warn'); return; }
  const out = document.getElementById('tb-answer');
  const bookId = document.getElementById('tb-book')?.value || '';
  _tbAsking = true;
  if (out) out.innerHTML = '<div class="muted" style="font-size:12px">📚 教材を検索中...</div>';
  try {
    const res = await TB.ask(q, {
      bookId,
      onProgress: (t) => { if (out) out.innerHTML = `<div class="muted" style="font-size:12px">${esc(t)}</div>`; }
    });
    if (res.notFound) {
      if (out) out.innerHTML = '<div class="muted" style="font-size:12px">教材の中に見つかりませんでした。言葉を変えるか、OCRがまだの教材かもしれません。</div>';
      return;
    }
    const cites = res.used.map(u => `<span class="src-chip">${esc(u.title)} p.${u.n}</span>`).join('');
    if (out) out.innerHTML = renderChatMd(res.text)
      + `<div class="cb-sources"><div class="cb-sources-label">📖 参照したページ</div>${cites}</div>`
      + `<div style="margin-top:10px"><button class="btn btn-s btn-sm" onclick="tbSendToChat()">💬 この続きをチャットで聞く</button></div>`;
    window._tbLast = { q, res };
  } catch (e) {
    if (out) out.innerHTML = `<div style="color:var(--a2);font-size:13px">エラー: ${esc(e.message)}</div>`;
  } finally { _tbAsking = false; }
};

// 教材の抜粋をチャットに持ち込む（続けて掘り下げたいとき用）
window.tbSendToChat = async () => {
  const last = window._tbLast;
  if (!last) return;
  const { text: ctx } = await TB.buildContext(last.res.hits, 5000);
  window._chatTextbookContext = { question: last.q, ctx, used: last.res.used };
  showPage('aicoach', document.querySelector('.nav-btn[onclick*="aicoach"]'));
  const inp = document.getElementById('chat-in');
  if (inp) { inp.value = ''; inp.placeholder = '教材の内容について続けて質問...'; inp.focus(); }
  showToast('📚 教材の該当ページをチャットに引き継ぎました');
};

// チャット入力欄の 📚 ボタン：入力中の文章でそのまま教材を検索して添付する
let _tbAttaching = false;
window.tbAttachFromChat = async () => {
  if (_tbAttaching) return;                       // 連打で二重に走らせない
  const inp = document.getElementById('chat-in');
  const q = (inp?.value || '').trim();
  if (!q) { showToast('先に質問を入力してください（その言葉で教材を探します）', 'warn'); return; }
  const btn = document.querySelector('.chat-attach-btn[onclick*="tbAttachFromChat"]');
  _tbAttaching = true;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const hits = await TB.search(q, { limit: 10 });
    if (!hits.length) { showToast('教材の中に見つかりませんでした', 'warn'); return; }
    const { text: ctx, used } = await TB.buildContext(hits, 5000);
    window._chatTextbookContext = { question: q, ctx, used };
    if (typeof renderChatFilePreview === 'function') renderChatFilePreview();
  } catch (e) {
    showToast('教材の検索に失敗: ' + e.message, 'error');
  } finally {
    _tbAttaching = false;
    if (btn) { btn.textContent = '📚'; btn.disabled = false; }
  }
};

window.tbClearChatContext = () => {
  window._chatTextbookContext = null;
  if (typeof renderChatFilePreview === 'function') renderChatFilePreview();
  else {
    const wrap = document.getElementById('chat-file-preview-wrap');
    if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
  }
};
