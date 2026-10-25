// ============================================================
// 🎯 共通テストの出願ガイド（令和9年度＝2027年1月実施）
// ============================================================
// 令和9年度から「完全Web出願」に変わった。紙の願書を郵送する方式ではない。
// 大学入試センター公式（https://www.dnc.ac.jp/kyotsu/web_syutugan.html）で確認した内容。
//
// ⚠️ 日付はすべて公式の記載どおり。変更される可能性があるので、
//    実際に手続きする前に必ず公式ページと「受験案内」を確認すること。
// ============================================================

const KYOTSU = {
  year: '令和9年度（2027年1月実施）',
  updatedAt: '2026-09-21',

  // いちばん大事な締切（ここを過ぎると受験できない）
  hardDeadline: { date: '2026-10-02', time: '17:00', what: '出願内容の登録' },

  links: [
    { t: '共通テスト出願サイト（マイページ）', u: 'https://www.dnc.ac.jp/kyotsu/web_syutugan.html', note: 'ここから出願サイトへ。全ての手続はマイページで行う' },
    { t: '受験案内（PDF）', u: 'https://www.dnc.ac.jp/kyotsu/shiken_jouhou/r9/', note: '冊子の配布は無し。PDFを読む。写真の条件は37ページ、支払方法は29・38ページ' },
    { t: '操作マニュアル 第1編（マイページ作成）', u: 'https://www.dnc.ac.jp/kyotsu/web_syutugan.html', note: '画面の通りに進めば良い' },
    { t: '操作マニュアル 第2編（出願・受験票・成績）', u: 'https://www.dnc.ac.jp/kyotsu/web_syutugan.html', note: '' },
    { t: '志願者向け説明動画', u: 'https://www.dnc.ac.jp/kyotsu/shiken_jouhou/r9/', note: 'Web出願の流れと科目の説明。見ておくと早い' }
  ],

  // ⚠️ 提出書類はゼロ。紙の志願票・卒業見込証明書・払込証明書はすべて廃止された。
  //    出願は「学校がまとめて」ではなく、志願者が個人で最後までやる。
  noDocs: '卒業見込証明書も、紙の志願票も、検定料の払込証明書も提出しません。出願資格を証明する書類は一切不要です（受験案内22ページ）。',
  soloNote: '⚠️ 学校一括出願ではありません。全員が個人でWeb出願します。高校ができるのは出願状況を「見る」ことだけ（しかも本人が情報提供に同意した場合のみ）。ただし高校が独自に校内締切を設けていることが多いので、学校の指示があればそちらに従ってください。',

  // 出願前にそろえるもの
  prepare: [
    { k: 'mail', t: 'メールアドレス（1人1つ）', d: '家族と共用は不可。⚠️ no-reply@cen.dnc.ac.jp / system@p01.mul-pay.com / noreply@gmo-pg.com の3つを受信できる設定に。認証コードが届かないとログインできません。学校のアドレスを使う場合、2027年4月以降も使えるか確認（成績閲覧が4月なので）' },
    { k: 'photo', t: '顔写真のデータ', d: '⚠️2026年7月1日以降に撮影したもの。上半身・無帽・無背景。5MB以内（jpg/png/heic等）。スマホ撮影OK、カラー白黒どちらでも可。アプリ加工は不可、印刷した写真の撮り直しも不可。眼鏡をかけて受験するなら眼鏡をかけて撮影' },
    { k: 'pay', t: '支払いの手段', d: 'クレジットカード（本人名義でなくてOK・一括払いのみ）／コンビニ／Pay-easy から選ぶ。⚠️銀行窓口や共用ATMでは払えません' },
    { k: 'device', t: 'ネット端末と印刷手段', d: 'スマホでもPCでも可（iOS16以上／Android13以上／Edge・Chrome・Safari最新版）。受験票は後でA4の白い紙に印刷が必須なので、コンビニ印刷などの手段も確認しておく' },
    { k: 'code', t: '自分の高校を選べるようにしておく', d: '出願資格は「令和9年3月に卒業見込みの者」を選び、受験案内66ページ以降の高等学校等一覧から自分の学校を検索して選ぶ' },
    { k: 'subject', t: '受ける教科・科目を決めておく', d: '⚠️登録した教科しか当日受験できません。地歴と公民は合わせて「1教科」扱い。志望校の指定科目を先に確認：同志社の共テ利用は数学ⅠA必須、近大3科目型は英語＋高得点2科目' }
  ],

  // 検定料（成績閲覧を希望するかで変わる）
  fees: [
    { t: '3教科以上・成績閲覧あり', v: '18,300円' },
    { t: '3教科以上・成績閲覧なし', v: '18,000円' },
    { t: '2教科以下・成績閲覧あり', v: '12,300円' },
    { t: '2教科以下・成績閲覧なし', v: '12,000円' }
  ],
  feeNote: '⚠️支払方法にかかわらず別途188円の手数料。⚠️地理歴史と公民は合わせて「1教科」として数えます（国語・地歴・公民の3科目を受けても2教科扱い）。国公立型で6教科受けるなら18,000円（閲覧希望で18,300円）。出願受理後は受験しなくても返金されません。',

  // 試験当日の時間割
  timetable: [
    { d: '1日目 2027年1月16日（土）', rows: [
      '地理歴史・公民  2科目 9:30-11:40 ／ 1科目 10:40-11:40',
      '国語  13:00-14:30（90分・200点）',
      '外国語 英語リーディング  15:20-16:40（100点）',
      '外国語 英語リスニング  17:20-18:20（100点）' ] },
    { d: '2日目 2027年1月17日（日）', rows: [
      '理科  2科目 9:30-11:40 ／ 1科目 10:40-11:40',
      '数学①『数学Ⅰ，数学A』  13:00-14:10（70分・100点）',
      '数学②『数学Ⅱ，数学B，数学C』  15:00-16:10（70分・100点）',
      '情報『情報Ⅰ』  17:00-18:00（60分・100点）' ] }
  ],
  timeNote: '⚠️遅刻は開始後20分以内なら受験できますが、英語リスニングだけは17:20までに入室していないと受験できません。地歴公民・理科の2科目登録者は9:50までに入室しないと、その時間は一切受験できません。',

  // 私大の共テ利用方式に出すときの手続き
  seisekiRequest: {
    t: '私立大学の共通テスト利用方式に出すとき',
    d: '共テの出願時には特別な手続きは要りません。必要になるのは志望大学に出願するときで、「成績請求情報の提供」を行います。方法は2つ：①Web方式＝マイページの「申込番号」（26で始まる11桁）を大学の出願サイトに入力して連携（⚠️大学側に登録する氏名カナが共テ出願と一致していないと失敗）／②チケット方式＝マイページで「成績請求チケット」を発行して印刷し提出。どちらを使うかは大学の募集要項に従います。私立大学用は出せる大学数に制限なし。手続きできる期間は2026年12月4日10時〜2027年3月31日17時（大学によってはWeb連携が2026年11月1日から）。'
  },

  // 手順（日付順）
  steps: [
    { phase: '① 事前準備', from: '', to: '2026-10-02',
      items: ['「受験案内」PDFを読む（冊子は配られない）', '上の「出願前にそろえるもの」を全部そろえる', '説明動画を見ておく'] },
    { phase: '② マイページを作る', from: '2026-07-01', to: '2026-10-02', toTime: '17:00',
      items: ['出願サイトでメールアドレスを登録してマイページを作成', 'まだの場合は今日中に作る'] },
    { phase: '③ 出願内容を登録する', from: '2026-09-15', to: '2026-10-02', toTime: '17:00', critical: true,
      items: ['志願者情報の入力', '顔写真データのアップロード', '受験する教科・科目の登録'] },
    { phase: '④ 検定料を払う', from: '2026-09-15', to: '2026-10-02', toTime: '23:59', critical: true,
      items: ['⚠️ 払わないと出願は完了しない（登録しただけでは受験できない）', 'クレジットカード／コンビニ／Pay-easy'] },
    { phase: '⑤ 登録内容の確認・訂正', from: '2026-10-09', to: '2026-10-16', toTime: '17:00',
      items: ['マイページで登録内容を確認し、間違いがあれば訂正する', 'この期間を逃すと直せないので必ず開く'] },
    { phase: '⑤-2 私大への成績提供（共テ利用で出す大学だけ）', from: '2026-11-01', to: '2027-03-31', toTime: '17:00',
      items: ['大学の出願サイトに「申込番号」（26で始まる11桁）を入れて連携する（Web方式）', '大学によってはWeb連携が11月1日から。多くは12月4日10時から', '⚠️大学側に登録する氏名カナが共テ出願と一致していないと連携に失敗する'] },
    { phase: '⑥ 受験票を取得・印刷', from: '2026-12-04', to: '2027-01-15',
      items: ['2026年12月4日10時からマイページで取得できる', '⚠️ 紙に印刷して持参する。スマホの画面表示では試験場に入れない'] },
    { phase: '⑦ 本試験', from: '2027-01-16', to: '2027-01-17', exam: true,
      items: ['2027年1月16日（土）・17日（日）', '追試験・再試験は2027年1月23日（土）・24日（日）'] },
    { phase: '⑧ 成績の閲覧（希望者のみ）', from: '2027-04-01', to: '2027-04-30', toTime: '17:00',
      items: ['出願のときに成績通知を希望した人だけ、マイページで見られる'] }
  ],

  // 出願の受付（10月2日）が終わったあとに、カードの先頭に出す「次にやること」
  after: [
    { from: '2026-11-01', to: '2027-03-31', t: '共テ利用で出す大学への成績提供',
      d: '大学の出願サイトに「申込番号」（26で始まる11桁・マイページに表示）を入れて連携する。大学によっては11月1日から、多くは12月4日10時から。氏名カナが共テ出願と違うと失敗する' },
    { from: '2026-12-04', to: '2027-01-15', t: '受験票を取得してA4の白い紙に印刷',
      d: '12月4日10時からマイページで取得できる。郵送はされない。スマホの画面では試験場に入れない' },
    { from: '2026-12-04', to: '2027-01-15', t: '試験場を確認して下見する',
      d: '試験場は受験票で初めてわかる。最寄りとは限らず、変更もできない。当日の電車・バスの時刻まで調べておく' },
    { from: '2027-01-16', to: '2027-01-17', exam: true, t: '本試験（1月16日・17日）',
      d: '英語リスニングは17:20までに入室していないと受験できない。地歴公民・理科を2科目登録した人は9:50までに入室' }
  ],

  cautions: [
    '登録しただけでは出願にならない。検定料を2026年10月2日23:59までに払って初めて完了する。期限後の出願は一切受け付けられない',
    '顔写真は一度登録すると変更できない（否認されたときだけ再登録）。否認の通知はメールとマイページに来るので必ず確認する。10月16日17:00までに受付できる写真を出し直さないと、受験票が試験当日に使えなくなる',
    '受験教科・科目を変えられるのは2026年10月16日（金）17:00まで。それ以降は一切変更できない',
    '「2科目受験する」と登録したら、当日1科目だけにはできない（必ず2科目採点される）。逆に1科目登録で2科目受験もできない',
    '登録していない教科は当日受けられない。受けても採点されない',
    '受験票は郵送されない。マイページから取得してA4の白い紙に印刷して持参する。スマホ画面では入場できない',
    '試験場は受験票（2026年12月4日以降）でわかる。出願時点では不明で、指定された試験場は変更できない。最寄りとは限らない',
    '髙・﨑などJIS第一・第二水準以外の漢字、ローマ数字は登録エラーになる。代替文字や算用数字で入力する',
    'マイページは1人1つだけ。複数作ってはいけない',
    '受験上の配慮が必要な場合は出願とは別に郵送で申請。第2期の締切は2026年10月2日（金）必着（9月30日消印有効）'
  ]
};

// 期限までの残り日数（マイナスなら過ぎている）
const kyotsuDaysLeft = (dateStr) => DateManager.daysBetween(dateStr);

// AIに渡す要約。チャットで「共テの締切いつ？」「検定料いくら？」と聞かれても答えられるようにする。
// 「あと何日」のような毎日変わる値は入れない（AIは今日の日付から自分で計算できる。
// ここは滅多に変わらない stable 側に入るので、変動値を混ぜるとキャッシュが外れる）。
const kyotsuForAI = () => {
  const prep = (typeof S !== 'undefined' && S.kyotsuPrep) || {};
  const steps = KYOTSU.steps.map(s => `${s.phase}: ${s.from ? s.from + '〜' : ''}${s.to}${s.toTime ? ' ' + s.toTime : ''}`).join(' / ');
  const fees = KYOTSU.fees.map(f => `${f.t}=${f.v}`).join(', ');
  const done = KYOTSU.prepare.filter(p => prep[p.k]).map(p => p.t);
  const todo = KYOTSU.prepare.filter(p => !prep[p.k]).map(p => p.t);
  return `${KYOTSU.year}。完全Web出願・個人出願・提出書類なし（顔写真データのみ）。`
    + `手順と期限: ${steps}。検定料: ${fees}（別途手数料188円、地歴と公民は合わせて1教科）。`
    + `出願準備チェック 済:[${done.join('、') || 'なし'}] 未:[${todo.join('、') || 'なし'}]。`
    + `マイページでの出願完了の確認: ${prep.applied ? '確認済み' : '未確認'}。`
    + `出願後にやること: ${KYOTSU.after.map(a => `${a.t}(${a.from}〜${a.to})`).join(' / ')}。`
    + `注意: ${KYOTSU.cautions.slice(0, 4).join(' / ')}`;
};

window.renderKyotsu = () => {
  const c = document.getElementById('kyotsu-c');
  if (!c) return;
  // チェックを入れるたびに描き直すので、開いていた折りたたみが勝手に閉じないようにする
  const wasOpen = rememberExpandOpen(c);
  const left = kyotsuDaysLeft(KYOTSU.hardDeadline.date);
  // 出願の受付が終わったら、出願前の説明は畳んで「次にやること」を前に出す
  if (left < 0) { renderKyotsuAfter(c); restoreExpandOpen(c, wasOpen); return; }
  const urgent = left >= 0 && left <= 21;
  // 締切の表示は KYOTSU.hardDeadline.date から作る（日付を直書きすると、データ更新時に表示だけ古いまま残る）
  const dlDate = DateManager.parseSafe(KYOTSU.hardDeadline.date);
  const dlText = `${dlDate.getFullYear()}年${dlDate.getMonth() + 1}月${dlDate.getDate()}日（${'日月火水木金土'[dlDate.getDay()]}）`;
  const badge = left > 0
    ? `<div style="background:${urgent ? 'var(--a2)' : 'var(--accent)'};color:#fff;border-radius:12px;padding:10px 12px;margin-bottom:10px">
         <div style="font-size:11px;opacity:.9">${esc(KYOTSU.hardDeadline.what)}の締切まで</div>
         <div style="font-size:22px;font-weight:800;line-height:1.2">あと ${left} 日</div>
         <div style="font-size:11px;opacity:.9">${dlText}${esc(KYOTSU.hardDeadline.time)} まで</div>
       </div>`
    : left === 0
      ? `<div style="background:var(--a2);color:#fff;border-radius:12px;padding:10px 12px;margin-bottom:10px"><div style="font-size:18px;font-weight:800">今日が締切です（17:00まで）</div></div>`
      : '';

  const { stepHtml, prepHtml, feeHtml, ttHtml, saved } = kyotsuParts();

  c.innerHTML = badge
    + `<div style="font-size:12px;line-height:1.7;color:var(--muted);margin-bottom:8px">
         <strong>完全Web出願</strong>です。紙の願書を郵送するのではなく、出願サイトのマイページで全部やります。冊子の「受験案内」は配布されないのでPDFを読みます。</div>`
    + `<div style="font-size:12px;line-height:1.7;color:var(--a2);font-weight:700;margin-bottom:6px">${esc(KYOTSU.soloNote)}</div>`
    + `<div style="font-size:12px;line-height:1.7;color:var(--a3);margin-bottom:10px">📄 提出書類はゼロ: ${esc(KYOTSU.noDocs)}</div>`
    + `<div class="expand-section"><div class="expand-hdr open" onclick="toggleExpand(this)"><div class="expand-title">📦 出願前にそろえるもの（${KYOTSU.prepare.filter(p => saved[p.k]).length}/${KYOTSU.prepare.length}）</div><span class="expand-arrow">▼</span></div><div class="expand-body open">${prepHtml}</div></div>`
    + `<div class="expand-section"><div class="expand-hdr open" onclick="toggleExpand(this)"><div class="expand-title">🗓 手順と期限</div><span class="expand-arrow">▼</span></div><div class="expand-body open">${stepHtml}</div></div>`
    + kyotsuSection('💴 検定料', feeHtml + `<div style="font-size:11px;line-height:1.7;color:var(--a2);margin-top:6px">${esc(KYOTSU.feeNote)}</div>`)
    + kyotsuSection('⏰ 当日の時間割', ttHtml + `<div style="font-size:11px;line-height:1.7;color:var(--a2)">${esc(KYOTSU.timeNote)}</div>`)
    + kyotsuSection('🎫 ' + KYOTSU.seisekiRequest.t, `<div style="font-size:12px;line-height:1.8;color:var(--muted)">${esc(KYOTSU.seisekiRequest.d)}</div>`)
    + kyotsuSection(`⚠️ やりがちな失敗（${KYOTSU.cautions.length}件）`, kyotsuList(KYOTSU.cautions))
    + kyotsuSection('🔗 公式リンク', kyotsuLinksHtml());
  restoreExpandOpen(c, wasOpen);
};

// 折りたたみ1つ分（最初は閉じておく）
const kyotsuSection = (title, body, open = false) =>
  `<div class="expand-section"><div class="expand-hdr${open ? ' open' : ''}" onclick="toggleExpand(this)"><div class="expand-title">${esc(title)}</div><span class="expand-arrow">▼</span></div><div class="expand-body${open ? ' open' : ''}">${body}</div></div>`;
const kyotsuList = (arr) => `<ul style="margin:6px 0 0 16px;font-size:12px;line-height:1.9;color:var(--muted)">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
const kyotsuLinksHtml = () => KYOTSU.links.map(l => `<div style="padding:6px 0;border-bottom:1px solid var(--border)">
    <a href="${esc(safeUrl(l.u))}" target="_blank" rel="noopener noreferrer" style="font-size:13px;font-weight:700">${esc(l.t)}</a>
    ${l.note ? `<div style="font-size:11px;color:var(--muted);line-height:1.6">${esc(l.note)}</div>` : ''}</div>`).join('');
const kyotsuMd = (d) => { const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${+m[1]}/${+m[2]}` : String(d); };

// 出願の受付が終わったあと（10月3日以降）の表示。
// 出願前の準備や検定料は済んだ話なので一番下に畳み、これから先の手続きと本番までの日数を前に出す。
const renderKyotsuAfter = (c) => {
  const { stepHtml, prepHtml, feeHtml, ttHtml, saved } = kyotsuParts();
  const today = DateManager.getTodayStr();
  const examLeft = kyotsuDaysLeft('2027-01-16');
  const badge = examLeft > 0
    ? `<div style="background:var(--accent);color:#fff;border-radius:12px;padding:10px 12px;margin-bottom:10px">
         <div style="font-size:11px;opacity:.9">共通テスト本番（2027年1月16日・17日）まで</div>
         <div style="font-size:22px;font-weight:800;line-height:1.2">あと ${examLeft} 日</div>
       </div>` : '';
  // 出願が本当に完了しているか（検定料の支払いまで済んでいるか）はマイページでしか確かめられない
  const applied = !!saved.applied;
  const appliedHtml = `<label style="display:flex;gap:8px;align-items:flex-start;padding:9px 10px;margin-bottom:10px;border-radius:10px;cursor:pointer;${applied ? 'background:rgba(52,199,89,0.12)' : 'background:rgba(255,59,48,0.10);border:1px solid var(--a2)'}">
      <input type="checkbox" ${applied ? 'checked' : ''} onchange="kyotsuCheck('applied',this.checked)" style="margin-top:3px;flex-shrink:0">
      <span style="font-size:12px;line-height:1.6">${applied
        ? '<strong>✅ 出願完了を確認済み</strong>（マイページで受理・検定料の支払い済みを確認）'
        : '<strong style="color:var(--a2)">マイページで「出願完了」になっているか確認してください</strong><br>登録だけで検定料を払っていないと受験できません。確認できたらチェックを入れてください'}</span>
    </label>`;

  const upcoming = KYOTSU.after.filter(a => a.to >= today);
  const nextHtml = upcoming.map(a => {
    const open = a.from <= today;
    const status = open ? `<span style="color:var(--a3);font-weight:700">${a.exam ? '本番' : 'いまできる'}</span>`
      : `<span style="color:var(--muted)">あと${kyotsuDaysLeft(a.from)}日${a.exam ? '' : 'で開始'}</span>`;
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
        <div style="font-size:13px;font-weight:700">${open ? '▶ ' : ''}${esc(a.t)}</div>
        <div style="font-size:10px;white-space:nowrap">${kyotsuMd(a.from)}〜${kyotsuMd(a.to)}　${status}</div>
      </div>
      <div style="font-size:12px;line-height:1.7;color:var(--muted);margin-top:2px">${esc(a.d)}</div>
    </div>`;
  }).join('');

  c.innerHTML = badge + appliedHtml
    + `<div style="font-size:13px;font-weight:800;margin:4px 0 2px">📌 次にやること</div>${nextHtml || '<div class="empty">共通テストの手続きはすべて終わりました</div>'}`
    + kyotsuSection('⏰ 当日の時間割', ttHtml + `<div style="font-size:11px;line-height:1.7;color:var(--a2)">${esc(KYOTSU.timeNote)}</div>`, examLeft <= 30)
    // 出願前の注意のうち、本番に関わるもの（2科目登録・未登録の教科・受験票・試験場）だけ残す
    + kyotsuSection('⚠️ 本番までの注意', kyotsuList(KYOTSU.cautions.slice(3, 7)))
    + kyotsuSection('🎫 ' + KYOTSU.seisekiRequest.t, `<div style="font-size:12px;line-height:1.8;color:var(--muted)">${esc(KYOTSU.seisekiRequest.d)}</div>`)
    + kyotsuSection('🗓 手順と期限（全体）', stepHtml)
    + kyotsuSection('📦 出願のときの記録（そろえたもの・検定料）', prepHtml + '<div style="margin-top:8px">' + feeHtml + '</div>')
    + kyotsuSection('🔗 公式リンク', kyotsuLinksHtml());
};

// 出願前・出願後のどちらの表示でも使う部品
const kyotsuParts = () => {
  const today = DateManager.getTodayStr();
  const stepHtml = KYOTSU.steps.map(s => {
    const started = !s.from || s.from <= today;
    const ended = s.to && s.to < today;
    const nowHere = started && !ended;
    const period = s.from && s.to ? `${s.from.replace(/-/g, '/')} 〜 ${s.to.replace(/-/g, '/')}${s.toTime ? ' ' + s.toTime : ''}`
      : s.to ? `${s.to.replace(/-/g, '/')} まで` : '';
    const color = ended ? 'var(--muted)' : s.critical ? 'var(--a2)' : nowHere ? 'var(--accent)' : 'var(--text)';
    return `<div style="padding:9px 0;border-bottom:1px solid var(--border);${ended ? 'opacity:.5' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <div style="font-size:13px;font-weight:700;color:${color}">${ended ? '✓ ' : ''}${esc(s.phase)}${nowHere && !s.exam ? ' <span style="font-size:10px">← いまここ</span>' : ''}</div>
        <div style="font-size:10px;color:var(--muted);white-space:nowrap">${esc(period)}</div>
      </div>
      <ul style="margin:4px 0 0 16px;font-size:12px;line-height:1.7;color:var(--muted)">${s.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`;
  }).join('');

  const saved = kyotsuPrepGet();
  const prepHtml = KYOTSU.prepare.map(p => `
    <label style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" ${saved[p.k] ? 'checked' : ''} onchange="kyotsuCheck('${esc(p.k)}',this.checked)" style="margin-top:3px;flex-shrink:0">
      <span><span style="font-size:13px;font-weight:700">${esc(p.t)}</span>
      <span style="display:block;font-size:11px;line-height:1.6;color:var(--muted)">${esc(p.d)}</span></span>
    </label>`).join('');

  const feeHtml = KYOTSU.fees.map(f => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0"><span>${esc(f.t)}</span><strong>${esc(f.v)}</strong></div>`).join('');
  const ttHtml = KYOTSU.timetable.map(d => `<div style="margin-bottom:8px"><div style="font-size:12px;font-weight:700">${esc(d.d)}</div>
      <ul style="margin:3px 0 0 16px;font-size:11px;line-height:1.8;color:var(--muted)">${d.rows.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`).join('');

  return { stepHtml, prepHtml, feeHtml, ttHtml, saved };
};

// チェックの状態は S に持たせてクラウド同期に乗せる（端末を変えても引き継がれる）。
// 以前 localStorage に入れていた分は初回に拾い上げる。
const kyotsuPrepGet = () => {
  if (!S.kyotsuPrep || typeof S.kyotsuPrep !== 'object') {
    let old = {};
    try { old = JSON.parse(localStorage.getItem('kyotsuPrep') || '{}'); } catch (e) {}
    S.kyotsuPrep = old;
  }
  return S.kyotsuPrep;
};

window.kyotsuCheck = (key, on) => {
  const saved = kyotsuPrepGet();
  saved[key] = !!on;
  S.kyotsuPrep = saved;
  DbService.setMainProfile();          // クラウドへ
  try { localStorage.setItem('kyotsuPrep', JSON.stringify(saved)); } catch (e) {}
  renderKyotsu();
};

// 共通テストの日程をカレンダーの予定として入れる
window.addKyotsuEvents = () => {
  const evs = [
    { date: '2026-10-02', title: '⚠️共テ 出願登録の締切（17時）', type: 'deadline' },
    { date: '2026-10-09', title: '共テ 登録内容の確認・訂正 開始', type: 'other' },
    { date: '2026-10-16', title: '共テ 訂正の締切（17時）', type: 'deadline' },
    { date: '2026-11-01', title: '共テ 私大への成績提供（Web連携）が始まる大学あり', type: 'other' },
    { date: '2026-12-04', title: '共テ 受験票を取得・印刷できる日', type: 'other' },
    { date: '2026-12-04', title: '共テ 私大への成績提供（Web連携）開始', type: 'other' },
    { date: '2027-01-16', title: '大学入学共通テスト 1日目', type: 'exam' },
    { date: '2027-01-17', title: '大学入学共通テスト 2日目', type: 'exam' }
  ];
  let added = 0;
  for (const e of evs) {
    if ((S.events || []).some(x => x.date === e.date && x.title === e.title)) continue;
    const obj = { id: generateId(), date: e.date, title: e.title, type: e.type, time: '' };
    S.events.push(obj); DbService.set('events', obj); added++;
  }
  DbService.setMainProfile();
  if (typeof renderCal === 'function') renderCal();
  showToast(added ? `📅 共通テストの予定を${added}件カレンダーに追加しました` : 'すでに追加済みです');
};
