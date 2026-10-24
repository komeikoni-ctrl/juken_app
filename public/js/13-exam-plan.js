// ============================================================
// 🗓 2027年度 出願プラン（立命館・同志社・近畿大学／経済・経営・商）
// ============================================================
// 各大学の公式（入試ガイド・要項PDF）で確認した値だけを入れている。
// 公表されていない項目は空のままにして、アプリの「AIが空欄を調べる」機能に任せる。
//
// ⚠️ ここに入れた日付・配点も、出願前に必ず大学公式で最終確認すること。
//    要項は毎年11月ごろに確定版が出る（それまでは入試ガイドの値）。
// ============================================================

const EXAM_PLAN = {
  updatedAt: '2026-09-21',
  // 志望順位（第一志望＝経済学部）
  priority: '経済学部 ＞ 経営学部・商学部',

  entries: [
    // ── 同志社大学（経営学部は無い。経営系は商学部 商学科）──────────────
    {
      key: 'doshisha-econ-zen', name: '同志社大学', dep: '経済学部 経済学科',
      method: '前期', methodLabel: '全学部日程（文系）', priority: 1,
      applyStart: '2026-12-21', applyEnd: '2027-01-07',
      applyNote: 'Web出願＋書類郵送。締切日消印有効',
      examDate: '2027-02-05', resultDate: '2027-02-15',
      fee: 35000,
      subjects: '英語200（100分）／国語150（75分）／地歴・公民・数学から1科目150（75分）＝500点満点。⚠️経済学部は英語に基準点80点あり（79点以下は総得点が足りていても不合格）。選択科目間で得点調整あり',
      url: 'https://www.doshisha.ac.jp/files/nyugk/page/p3_2027.pdf',
      memo: '2026年度実績: 合格最低点361/500(72.2%)・実質倍率3.3倍。検定料は2026年度実績の額（2027年度は未公表）',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'resultDate', 'subjects', 'fee']
    },
    {
      key: 'doshisha-econ-kobetsu', name: '同志社大学', dep: '経済学部 経済学科',
      method: '前期', methodLabel: '学部個別日程', priority: 1,
      applyStart: '2026-12-21', applyEnd: '2027-01-07',
      applyNote: 'Web出願＋書類郵送。締切日消印有効',
      examDate: '2027-02-06', resultDate: '2027-02-15',
      fee: 35000,
      subjects: '配点は全学部日程と同じ（英語200／国語150／選択150＝500点）。⚠️英語の基準点80点あり',
      url: 'https://www.doshisha.ac.jp/files/nyugk/page/p3_2027.pdf',
      memo: '2026年度実績: 合格最低点345/500(69.0%)・実質倍率3.3倍。全学部日程より最低点が16点低い＝取りやすい',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'resultDate', 'subjects', 'fee']
    },
    {
      key: 'doshisha-econ-kyotsu', optional: 'ボーダー84%。余裕があれば', name: '同志社大学', dep: '経済学部 経済学科',
      method: '共テ利用', methodLabel: '共通テスト利用入試', priority: 1,
      applyStart: '2026-12-21', applyEnd: '2027-01-07',
      applyNote: 'Web出願＋書類郵送。締切日消印有効。個別学力検査は課さない',
      resultDate: '2027-02-15',
      fee: 15000,
      subjects: '3教科4科目600点：英語200／国語200／数学ⅠA必須100／選択(数ⅡBC・地歴・公民・理科から1つ)100。個別試験なし',
      url: 'https://www.doshisha.ac.jp/files/nyugk/news/2027kyotsutest.pdf',
      memo: '募集27名。2026年度実質倍率3.8倍。合格最低点は大学非公表。河合塾ボーダー得点率84%（2027年度予想）',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'resultDate', 'subjects', 'fee']
    },
    {
      key: 'doshisha-com-zen', optional: '経済（全学部日程）と同じ2/5。両方は受けられない', name: '同志社大学', dep: '商学部 商学科 商学総合コース',
      method: '前期', methodLabel: '全学部日程（文系）', priority: 2,
      applyStart: '2026-12-21', applyEnd: '2027-01-07',
      applyNote: 'Web出願＋書類郵送。締切日消印有効',
      examDate: '2027-02-05', resultDate: '2027-02-18',
      fee: 35000,
      subjects: '英語200／国語150／選択150＝500点満点。商学部に英語の基準点は無い',
      url: 'https://www.doshisha.ac.jp/files/nyugk/page/p3_2027.pdf',
      memo: '2026年度実績: 合格最低点377/500(75.4%)・実質倍率4.5倍。⚠️経済(全学部)と同じ2/5なので両方は受けられない',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'resultDate', 'subjects', 'fee']
    },
    {
      key: 'doshisha-com-kobetsu', name: '同志社大学', dep: '商学部 商学科 商学総合コース',
      method: '前期', methodLabel: '学部個別日程', priority: 2,
      applyStart: '2026-12-21', applyEnd: '2027-01-07',
      applyNote: 'Web出願＋書類郵送。締切日消印有効',
      examDate: '2027-02-09', resultDate: '2027-02-18',
      fee: 35000,
      subjects: '英語200／国語150／選択150＝500点満点',
      url: 'https://www.doshisha.ac.jp/files/nyugk/page/p3_2027.pdf',
      memo: '2026年度実績: 合格最低点377/500・実質倍率4.4倍。フレックス複合コースを第2志望に指定すると検定料1回分で2コース判定',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'resultDate', 'subjects', 'fee']
    },
    {
      key: 'doshisha-com-kyotsu', optional: '数学ⅡBCが必須・ボーダー82%。余裕があれば', name: '同志社大学', dep: '商学部 商学科 商学総合コース',
      method: '共テ利用', methodLabel: '共通テスト利用入試', priority: 2,
      applyStart: '2026-12-21', applyEnd: '2027-01-07',
      applyNote: 'Web出願＋書類郵送。締切日消印有効。個別学力検査は課さない',
      resultDate: '2027-02-18',
      fee: 15000,
      subjects: '4教科5科目700点：英語200／国語200／数学ⅠA100／⚠️数学ⅡBC必須100／選択(地歴・公民・理科から1つ)100',
      url: 'https://www.doshisha.ac.jp/files/nyugk/news/2027kyotsutest.pdf',
      memo: '募集25名。⚠️経済と違い数学ⅡBCが必須で負担が重い。河合塾ボーダー得点率82%（2027年度予想）。フレックス複合コースは共テ利用の募集なし',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'resultDate', 'subjects', 'fee']
    },

    // ── 立命館大学（商学部は無い。経営学部＝国際経営学科・経営学科）────────
    {
      key: 'rits-econ-zengaku', name: '立命館大学', dep: '経済学部 経済学科 経済専攻',
      method: '前期', methodLabel: '全学統一方式（文系）', priority: 1,
      applyStart: '2027-01-06', applyEnd: '2027-01-22',
      applyNote: 'ネット出願（1/6 10時〜1/22 23時）。書類は締切日消印有効',
      examDate: '2027-02-01', examDateEnd: '2027-02-04',
      examTime: '英語10:20-11:40／国語13:10-14:30／選択15:20-16:40（各80分）',
      resultDate: '2027-02-17', procedureDeadline: '2027-03-01',
      fee: 35000,
      subjects: '英語120／国語100（漢文の独立問題なし）／選択(政経・地理・日本史・世界史・数学から1つ)100＝320点満点',
      venue: 'びわこ・くさつキャンパス ほか全国試験地',
      url: 'https://admission.ritsumei.ac.jp/assets/file/2027/application/guide/38-39.pdf',
      memo: '⚠️2/1〜2/4の4日間あり、試験日が違えば複数日に出願できる（それぞれ35,000円）＝受験機会を増やせる。募集220名で立命の主力。2026年度実績: 合格最低点192/320(60.0%)・競争率3.5倍。2専攻併願制で国際専攻も+10,000円で同時判定',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'examDateEnd', 'examTime', 'resultDate', 'procedureDeadline', 'subjects', 'fee']
    },
    {
      key: 'rits-econ-kobetsu', optional: '数学が必須（150点）。数学で7割取れるなら', name: '立命館大学', dep: '経済学部 経済学科 経済専攻',
      method: '前期', methodLabel: '学部個別配点方式（文系型）', priority: 1,
      applyStart: '2027-01-06', applyEnd: '2027-01-26',
      applyNote: 'ネット出願（1/6 10時〜1/26 23時）。書類は締切日消印有効',
      examDate: '2027-02-07',
      resultDate: '2027-02-20', procedureDeadline: '2027-03-01',
      fee: 35000,
      subjects: '⚠️英語100／国語100／数学150（必須・数Ⅰ Ⅱ A B(数列) C(ベクトル)）＝350点満点。地歴公民は選べず数学必須',
      venue: 'びわこ・くさつキャンパス ほか',
      url: 'https://admission.ritsumei.ac.jp/assets/file/2027/application/guide/38-39.pdf',
      memo: '⚠️数学が必須で配点150点と重い。数学で戦えないなら出願しない判断もあり。募集30名。2026年度実績: 合格最低点245/350(70.0%)・競争率3.7倍。2027年度は数学の大問Ⅲが穴埋め式に変更',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'resultDate', 'procedureDeadline', 'subjects', 'fee']
    },
    {
      key: 'rits-econ-kyotsu', optional: 'ボーダー83%。余裕があれば', name: '立命館大学', dep: '経済学部 経済学科 経済専攻',
      method: '共テ利用', methodLabel: '共通テスト方式（2月選考）', priority: 1,
      applyStart: '2027-01-06', applyEnd: '2027-01-15',
      applyNote: '⚠️共通テスト前に締切（1/15 23時）。本学独自試験なし',
      resultDate: '2027-02-17', procedureDeadline: '2027-03-01',
      fee: 18000,
      subjects: '3教科型600点：英語200＋（国語・数学・公民・地歴・理科・情報から高得点2科目）400。7科目型900点・5教科型1000点もあり',
      url: 'https://admission.ritsumei.ac.jp/assets/file/2027/application/guide/guide-02.pdf',
      memo: '募集150名（2月選考の3型合計）。2026年度実績の合格最低点: 7科目型74.0%／5教科型79.0%／3教科型83.0%。科目数が多い型ほど通りやすい傾向',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'resultDate', 'procedureDeadline', 'subjects', 'fee']
    },
    {
      key: 'rits-keiei-zengaku', name: '立命館大学', dep: '経営学部 経営学科',
      method: '前期', methodLabel: '全学統一方式（文系）', priority: 2,
      applyStart: '2027-01-06', applyEnd: '2027-01-22',
      applyNote: 'ネット出願。書類は締切日消印有効',
      examDate: '2027-02-01', examDateEnd: '2027-02-04',
      resultDate: '2027-02-17', procedureDeadline: '2027-03-01',
      fee: 35000,
      subjects: '英語120／国語100／選択100＝320点満点（経済学部と同じ問題・同じ配点）',
      venue: '大阪いばらきキャンパス ほか',
      url: 'https://admission.ritsumei.ac.jp/assets/file/2027/application/guide/30-31.pdf',
      memo: '⚠️経済学部とはキャンパスが違う（経営＝大阪いばらき／経済＝びわこ・くさつ）。募集188名。2026年度実績: 合格最低点213/320(66.6%)・競争率4.2倍で経済より21点高い。2学科併願制で国際経営学科も+10,000円',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'examDateEnd', 'resultDate', 'procedureDeadline', 'subjects', 'fee']
    },

    // ── 近畿大学（商学部は無い。商学科は経営学部の中）──────────────────
    // 2027年度の入学試験要項が公開済みで、日程・配点・検定料まで確定している
    {
      key: 'kindai-econ-zenkiA', name: '近畿大学', dep: '経済学部 経済学科',
      method: '前期', methodLabel: '一般入試 前期A日程（スタンダード）', priority: 1,
      applyStart: '2027-01-03', applyEnd: '2027-01-23',
      applyNote: 'Web出願。締切日消印有効',
      examDate: '2027-01-30', examDateEnd: '2027-01-31',
      examTime: '英語11:00-12:00／国語13:20-14:20／選択15:00-16:00（各60分）',
      resultDate: '2027-02-10', procedureDeadline: '2027-02-17',
      fee: 32000,
      subjects: '英語100／国語100（⚠️漢文を除く）／地歴・公民・数学から1科目100＝300点満点。数学は数Ⅰ・Ⅱ・A・B(数列)・C(ベクトル)で数Ⅲは範囲外。高得点科目重視方式は最高得点科目を2倍にして400点満点',
      venue: '東大阪キャンパス ほか地方会場',
      url: 'https://kindai.jp/assets/pdf/exam/admissions/2027_nyushiyoko_23_24.pdf',
      memo: '⚠️近大の主力方式。2日間とも受験でき、日ごとに別判定なので受ければチャンス2回。2026年度実績: 合格最低点186〜193/300・倍率6.3〜7.1倍。+7,000円/志願で「高得点科目重視」「学部内併願（国際経済・総合経済政策）」「他学部併願」を追加判定できる',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'examDateEnd', 'examTime', 'resultDate', 'procedureDeadline', 'subjects', 'fee']
    },
    {
      key: 'kindai-com-zenkiA', examNote: '前期Aで判定', name: '近畿大学', dep: '経営学部 商学科',
      method: '前期', methodLabel: '一般入試 前期A日程（他学部併願方式）', priority: 2,
      applyStart: '2027-01-03', applyEnd: '2027-01-23',
      // 試験を別に受けるわけではないので examDate は入れない（受験日の重複チェックに引っかかるため）
      applyNote: '経済学部A日程（1/30・31）の受験結果をそのまま使って判定。試験を別に受ける必要はない',
      resultDate: '2027-02-10', procedureDeadline: '2027-02-17',
      fee: 7000,
      subjects: '経済学部A日程と同じ試験（英語100／国語100／選択100＝300点）の得点で判定。試験を受け直す必要はない',
      url: 'https://kindai.jp/exam/system/general1_a/multiple/',
      memo: '⚠️これが近大で一番お得。1回の受験（1/30・31）で経営学部 商学科も判定してもらえる（追加7,000円のみ）。2026年度実績: 商学科スタンダード 合格最低点194〜196/300・倍率7.4〜7.5倍',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'resultDate', 'procedureDeadline', 'subjects', 'fee']
    },
    {
      key: 'kindai-econ-kyotsu', name: '近畿大学', dep: '経済学部 経済学科',
      method: '共テ利用', methodLabel: '共通テスト利用方式（前期）', priority: 1,
      applyStart: '2027-01-03', applyEnd: '2027-01-15',
      applyNote: '⚠️共通テスト前に締切（1月15日）。個別試験なし',
      resultDate: '2027-02-17', procedureDeadline: '2027-03-04',
      fee: 20000,
      subjects: '3教科3科目型350点：英語150＋（国語・地歴・公民・数学・理科・情報から高得点2科目×100）200。5教科7科目型850点もあり',
      url: 'https://kindai.jp/exam/system/center/subject/',
      memo: '個別試験なしで押さえられる。2026年度実績: 3科目型 倍率3.5倍／7科目型 倍率1.5倍。合格最低点は大学非公表。河合塾ボーダー3科目71%・7科目64%（2027年度予想）。2志願まで20,000円なので国際経済・総合経済政策も同額で併願可',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'resultDate', 'procedureDeadline', 'subjects', 'fee']
    },
    {
      key: 'kindai-econ-zenkiB', name: '近畿大学', dep: '経済学部 経済学科',
      method: '前期', methodLabel: '一般入試 前期B日程', priority: 1,
      applyStart: '2027-01-03', applyEnd: '2027-02-03',
      applyNote: 'Web出願。締切日消印有効',
      examDate: '2027-02-11', examDateEnd: '2027-02-12',
      resultDate: '2027-02-24', procedureDeadline: '2027-03-04',
      fee: 32000,
      subjects: 'A日程と同じ（英語100／国語100／選択100＝300点）',
      url: 'https://kindai.jp/assets/pdf/exam/admissions/2027_nyushiyoko_25_26.pdf',
      memo: '⚠️募集が少なく倍率が跳ね上がる（2026年度実績: 経済学科13〜17倍、総合経済政策は27〜58倍）。A日程が本命で、これは保険。A日程で同じ学科に合格しB日程を欠席した場合、2027年2月21日までに申請すれば検定料が返る',
      researched: ['dep', 'applyStart', 'applyEnd', 'applyNote', 'examDate', 'examDateEnd', 'resultDate', 'procedureDeadline', 'subjects', 'fee']
    }
  ],

  // ===== 方式の選び方（第一志望＝経済学部を前提にした提案）=====
  strategy: [
    { t: '近大 前期A（1/30・31）を押さえの主軸にする', ok: true,
      d: '2日間とも受験でき、日ごとに別判定なのでチャンスが2回。さらに+7,000円の「他学部併願方式」で経営学部 商学科も、+7,000円の「学部内併願」で国際経済・総合経済政策も、同じ1回の試験で判定してもらえる。2026年度の合格最低点は300点中183〜193（61〜64%）。ここを固めると精神的にかなり楽になる。' },
    { t: '立命館は「全学統一方式」に資源を集中する', ok: true,
      d: '2/1〜2/4の4日間あり、日が違えば複数日に出願できる（各35,000円）。経済専攻の合格最低点192/320（60.0%）に対し経営学科は213/320（66.6%）で、経済の方が21点ぶん入りやすい。2専攻併願制で国際専攻も+10,000円で同時判定。' },
    { t: '立命館の「学部個別配点方式」は数学次第', ok: false,
      d: '経済学部の学部個別は⚠️数学が必須で150点（英100・国100・数150）。地歴公民では受けられない。数学で7割取れないなら、ここに35,000円を使うより全学統一をもう1日増やす方が期待値が高い。' },
    { t: '同志社は「学部個別日程」を軸にする', ok: true,
      d: '経済の学部個別（2/6）は合格最低点345/500（69.0%）で、全学部日程（2/5）の361/500（72.2%）より16点低い。倍率は同じ3.3倍。1つに絞るなら学部個別、余裕があれば両方。' },
    { t: '⚠️同志社の経済学部は英語に基準点80点がある', ok: false,
      d: '英語が79点以下だと、3教科の合計が合格点を超えていても不合格。英語は「稼ぐ科目」ではなく「落ちない科目」。配点も200点と最大なので、迷ったら英語に時間を割く。商学部に基準点は無い。' },
    { t: '同志社の全学部日程（2/5）は経済と商が同じ日', ok: false,
      d: '両方は受けられないので、第一志望の経済を選ぶ。商学部は学部個別（2/9）で押さえる。商はコース間の第2志望指定で、検定料1回分のまま商学総合とフレックス複合の両方が判定される。' },
    { t: '共通テスト利用は「近大だけ」が現実的', ok: true,
      d: '必要な得点率は近大前期3科目71%に対し、立命3教科型83%・同志社経済84%。近大なら共テだけで合格を確保できる可能性がある。立命・同志社の共テ利用は「受かったら儲けもの」の位置づけで、本命は個別試験。' },
    { t: '近大のB日程・後期は当てにしない', ok: false,
      d: '2026年度実績でB日程は13〜17倍（総合経済政策は58倍）、後期は22〜31倍。募集が少なく最低点も上がる。あくまでA日程が本命で、B日程は保険。A日程で同じ学科に受かってB日程を欠席すれば、2027年2月21日までの申請で検定料が返る。' }
  ],

  // ===== スケジュール案 =====
  schedule: [
    { when: '2026年9〜10月', until: '2026-10-31', items: [
      '英語を最優先。全大学で配点が最大、かつ同志社経済は80点の基準点がある',
      '世界史は通史を11月までに一周。細かい暗記より流れを先に',
      '国語（漢文）は近大・立命では出題されない。同志社の古典探究に絞る' ] },
    { when: '2026年11月', until: '2026-11-30', items: [
      '立命館・同志社の2027年度入学試験要項が公開 → 検定料・手続締切・募集人員を最終確認',
      '出願用の顔写真と調査書を早めに用意（年末に慌てない）' ] },
    { when: '2026年12月', until: '2026-12-31', items: [
      '12月21日 同志社 出願開始',
      '共通テストの過去問・予想問題で時間配分を固める' ] },
    { when: '2027年1月', until: '2027-01-31', items: [
      '1月3日 近大 出願開始 ／ 1月6日 立命館 出願開始',
      '⚠️1月7日 同志社 出願締切（全方式）',
      '⚠️1月15日 立命館・近大の共通テスト方式 出願締切（共テを受ける前に出願が必要）',
      '1月16・17日 大学入学共通テスト',
      '1月22日 立命館 全学統一 締切 ／ 1月23日 近大 前期A 締切 ／ 1月26日 立命館 学部個別・共テ併用 締切',
      '1月30・31日 近大 前期A（最初の本番）' ] },
    { when: '2027年2月', until: '2027-02-28', items: [
      '2月1〜4日 立命館 全学統一（4日のうち2日程度に絞るのが現実的）',
      '2月5日 同志社 全学部日程（経済）／ 2月6日 同志社 学部個別（経済）',
      '2月7日 立命館 学部個別（数学で出す場合）／ 2月9日 同志社 学部個別（商）',
      '⚠️2月1〜9日は9日間で最大6日が試験。移動と睡眠を先に確保すること',
      '2月10日 近大A発表 ／ 2月15日 同志社経済発表 ／ 2月17日 立命館発表 ／ 2月18日 同志社商発表 ／ 2月20日 立命館個別発表' ] },
    { when: '2027年3月', until: '2027-03-31', items: [
      '3月1日 立命館・同志社の第1次入学手続締切（進学先が決まっていなくても納入が必要な場合あり）',
      '3月7日 立命館 後期分割 ／ 3月8・9日 近大 後期（必要になった場合のみ）' ] }
  ],

  // 出願前に必ず公式で確かめる項目（大学がまだ出していないもの）
  pending: [
    { univ: '同志社大学', items: '2027年度の募集人員・検定料・入学手続締切・出願締切時刻', when: '2026年11月初旬に入学試験要項で公表',
      url: 'https://www.doshisha.ac.jp/admissions_undergrad/general_application/index.html' },
    { univ: '近畿大学', items: '前期A・Bを2日間とも受験する場合の検定料の合計（2出願分になるか）', when: '公式に明記が無いため入学センター(06-6730-1124)へ要確認',
      url: 'https://kindai.jp/exam/apply/fee/' }
  ],

  sources: [
    { title: '同志社 入試ガイド2027 選考日程', uri: 'https://www.doshisha.ac.jp/files/nyugk/page/p3_2027.pdf' },
    { title: '同志社 入試ガイド2027 試験科目・配点', uri: 'https://www.doshisha.ac.jp/files/nyugk/page/p4_7_2027.pdf' },
    { title: '同志社 2027年度 共通テスト利用入試', uri: 'https://www.doshisha.ac.jp/files/nyugk/news/2027kyotsutest.pdf' },
    { title: '同志社 2026年度 一般選抜 入試結果', uri: 'https://www.doshisha.ac.jp/files/nyugk/page/2026_ippan_01_shijugou.pdf' },
    { title: '近大 2027年度 入学試験要項 日程一覧', uri: 'https://kindai.jp/assets/pdf/exam/admissions/2027_nyushiyoko_9_10.pdf' },
    { title: '近大 2027年度 経済学部', uri: 'https://kindai.jp/assets/pdf/exam/admissions/2027_nyushiyoko_47_48.pdf' },
    { title: '近大 2027年度 経営学部', uri: 'https://kindai.jp/assets/pdf/exam/admissions/2027_nyushiyoko_49_50.pdf' },
    { title: '近大 入学検定料', uri: 'https://kindai.jp/exam/apply/fee/' },
    { title: '近大 2026年度 入試結果', uri: 'https://kindai.jp/exam/results/' }
  ]
};

// AIに渡す要約。出願管理にまだ取り込んでいなくても、チャットのAIが
// 「同志社の経済は英語に基準点がある」「2/5は経済と商が同日」などを踏まえて助言できるようにする。
const examPlanForAI = () => {
  const lines = EXAM_PLAN.entries.map(e =>
    `${e.name} ${e.dep}（${e.methodLabel}）: 試験${e.examDate || (e.examNote ? '別に受けない(' + e.examNote + ')' : 'なし(共テのみ)')}${e.examDateEnd ? '〜' + e.examDateEnd : ''}, `
    + `出願${e.applyStart}〜${e.applyEnd}, 発表${e.resultDate || '?'}, 検定料${e.fee}円, 科目:${e.subjects}`).join('\n');
  const strategy = EXAM_PLAN.strategy.map(s => `${s.ok ? '◎' : '⚠'}${s.t}: ${s.d}`).join('\n');
  return `志望順位: ${EXAM_PLAN.priority}（${EXAM_PLAN.updatedAt}時点・大学公式で確認）\n${lines}\n【方式の選び方】\n${strategy}`;
};

// スケジュール案のうち、今日が入っている時期（「いまここ」を付ける行）
const planNowSchedule = () => {
  const today = DateManager.getTodayStr();
  return EXAM_PLAN.schedule.find(s => s.until >= today) || null;
};

// ===== 画面 =====
window.renderExamPlan = () => {
  const c = document.getElementById('plan-c');
  if (!c) return;
  const wasOpen = rememberExpandOpen(c);
  const upd = document.getElementById('plan-updated');
  if (upd) upd.textContent = EXAM_PLAN.updatedAt + ' 時点';

  const existing = new Set((S.applications || []).map(a => `${a.name}|${a.dep}|${a.methodLabel || a.method}`));
  const isTaken = (e) => existing.has(`${e.name}|${e.dep}|${e.methodLabel}`);
  // 追加する行はチェックで選ぶ。全部まとめて入れると、同じ日で両方は受けられない組み合わせ
  // （同志社の経済と商の全学部日程）や、条件つきの方式（数学必須の立命館学部個別）まで入ってしまう。
  // 最初は「方式の選び方」でおすすめしているものだけにチェックを入れておく。
  if (!window._planPick) window._planPick = new Set(EXAM_PLAN.entries.filter(e => !e.optional).map(e => e.key));
  const pick = window._planPick;
  // スマホの幅では「2027-02-01」だと大学名の列が潰れるので「2/1」にする（年は表の上に出している）
  const md = (d) => { const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${+m[1]}/${+m[2]}` : String(d); };
  const rows = [...EXAM_PLAN.entries]
    .sort((a, b) => String(a.examDate || '9999').localeCompare(String(b.examDate || '9999')))
    .map(e => {
      const taken = isTaken(e);
      return `<tr${taken ? ' style="opacity:.45"' : ''}>
        <td style="width:26px"><input type="checkbox" id="plan-pick-${esc(e.key)}" aria-label="${esc(e.name + ' ' + e.methodLabel)}を追加する" style="width:18px;height:18px"
          ${taken ? 'checked disabled' : (pick.has(e.key) ? 'checked' : '')} onchange="planPickToggle('${esc(e.key)}', this.checked)"></td>
        <td style="white-space:nowrap">${esc(e.examDate ? md(e.examDate) + (e.examDateEnd ? '〜' + md(e.examDateEnd) : '') : (e.examNote || '共テのみ'))}</td>
        <td style="white-space:nowrap">${esc(e.name.replace('大学', ''))}<br><span style="font-size:10px;color:var(--muted)">${esc(e.dep.split(/\s+/)[0])}</span></td>
        <td style="font-size:11px">${esc(e.methodLabel)}${e.optional ? `<br><span style="font-size:10px;color:var(--a2)">△ ${esc(e.optional)}</span>` : ''}</td>
        <td style="text-align:right;white-space:nowrap">${e.fee ? yen(e.fee) : '-'}</td>
        <td style="font-size:10px;color:var(--muted)">${taken ? '追加済' : ''}</td>
      </tr>`;
    }).join('');

  const notyet = EXAM_PLAN.entries.filter(e => !isTaken(e) && pick.has(e.key));
  const remaining = EXAM_PLAN.entries.filter(e => !isTaken(e)).length;
  const feeSum = notyet.reduce((s, e) => s + (e.fee || 0), 0);

  c.innerHTML = `
    <div style="font-size:11px;color:var(--a2);font-weight:700;margin-bottom:8px">⚠️ 日程・配点は公式で確認済みですが、検定料や手続締切など未公表の項目があります。出願前に必ず大学公式で最終確認してください。</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="color:var(--muted);font-size:10px;text-align:left">
        <th></th><th>受験日<br>(2027年)</th><th>大学・学部</th><th>方式</th><th style="text-align:right">検定料</th><th></th>
      </tr></thead><tbody>${rows}</tbody>
    </table></div>
    ${EXAM_PLAN.pending.map(p => `<div style="font-size:11px;color:var(--muted);margin-top:8px">📌 ${esc(p.univ)}: ${esc(p.items)} は${esc(p.when)} → <a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">確認ページ</a></div>`).join('')}

    <div class="expand-section" style="margin-top:12px">
      <div class="expand-hdr" onclick="toggleExpand(this)"><div class="expand-title">🎯 どの方式に出すべきか（${EXAM_PLAN.strategy.length}件）</div><span class="expand-arrow">▼</span></div>
      <div class="expand-body">
        ${EXAM_PLAN.strategy.map(s => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:13px;font-weight:700;color:${s.ok ? 'var(--a3)' : 'var(--a2)'}">${s.ok ? '◎' : '⚠️'} ${esc(s.t)}</div>
            <div style="font-size:12px;line-height:1.7;color:var(--muted);margin-top:3px">${esc(s.d)}</div>
          </div>`).join('')}
      </div>
    </div>

    <div class="expand-section">
      <div class="expand-hdr" onclick="toggleExpand(this)"><div class="expand-title">🗓 いつ何をするか（スケジュール案）</div><span class="expand-arrow">▼</span></div>
      <div class="expand-body">
        ${EXAM_PLAN.schedule.map(s => ({ ...s, now: s === planNowSchedule() })).map(s => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:12px;font-weight:700;color:${s.now ? 'var(--accent)' : 'var(--text)'}">${esc(s.when)}${s.now ? '（いまここ）' : ''}</div>
            <ul style="margin:4px 0 0 16px;font-size:12px;line-height:1.75;color:var(--muted)">
              ${s.items.map(i => `<li>${esc(i)}</li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>
    </div>
    ${renderSourceChips(EXAM_PLAN.sources, '出典（大学公式）', '')}
    <div style="font-size:11px;color:var(--muted);margin-top:10px">チェックを入れた方式だけが追加されます。△は条件つき（最初はチェックを外してあります）。</div>
    <button class="btn btn-p btn-sm btn-full mt8" onclick="applyExamPlan()" ${notyet.length ? '' : 'disabled'}>
      ${notyet.length ? `📮 チェックした${notyet.length}件を出願管理に追加（検定料 計${yen(feeSum)}）`
        : (remaining ? '追加する方式にチェックを入れてください' : '✅ すべて追加済みです')}
    </button>`;
  restoreExpandOpen(c, wasOpen);
};

// チェックを入れるたびに描き直すので、開いていた折りたたみが勝手に閉じないようにする
const rememberExpandOpen = (container) => [...container.querySelectorAll('.expand-hdr')].map(h => h.classList.contains('open'));
const restoreExpandOpen = (container, wasOpen) => {
  if (!wasOpen || !wasOpen.length) return;          // 初回の描画は既定の開閉のまま
  [...container.querySelectorAll('.expand-hdr')].forEach((h, i) => {
    if (typeof wasOpen[i] !== 'boolean') return;
    h.classList.toggle('open', wasOpen[i]);
    if (h.nextElementSibling) h.nextElementSibling.classList.toggle('open', wasOpen[i]);
  });
};

window.planPickToggle = (key, on) => {
  if (!window._planPick) return;
  if (on) window._planPick.add(key); else window._planPick.delete(key);
  renderExamPlan();
};

window.applyExamPlan = () => {
  const existing = new Set((S.applications || []).map(a => `${a.name}|${a.dep}|${a.methodLabel || a.method}`));
  const pick = window._planPick || new Set(EXAM_PLAN.entries.filter(e => !e.optional).map(e => e.key));
  const add = EXAM_PLAN.entries.filter(e => pick.has(e.key) && !existing.has(`${e.name}|${e.dep}|${e.methodLabel}`));
  if (!add.length) { showToast('追加する方式にチェックを入れてください'); return; }

  showConfirm('出願プランを取り込む',
    `${add.length}件を出願管理に追加します。日程・配点は大学公式で確認した値ですが、未公表の項目は空欄のままです（「AIが空欄を調べる」で補えます）。`,
    '追加する',
    () => {
      for (const e of add) {
        const obj = {
          id: generateId(), name: e.name, dep: e.dep, method: e.method, methodLabel: e.methodLabel,
          applyStart: e.applyStart || '', applyEnd: e.applyEnd || '', applyNote: e.applyNote || '',
          examDate: e.examDate || '', examDateEnd: e.examDateEnd || '', examTime: e.examTime || '',
          subjects: e.subjects || '', resultDate: e.resultDate || '', procedureDeadline: e.procedureDeadline || '',
          fee: e.fee || 0, feePaid: false, enrollFee: 0, venue: e.venue || '', url: e.url || '', memo: e.memo || '',
          docs: DEFAULT_APP_DOCS.map(label => ({ label, done: false })),
          // 大学公式のPDFで確認した値。「AIが推測したかもしれない」ではなく
          // 「公式で確認済み・出願前に最終確認」として出典つきで印をつける
          aiFields: e.researched || [],
          aiSources: [{ title: e.name + ' 公式', uri: e.url || '' }],
          aiBasis: '大学公式の入試ガイド・要項PDFで確認（' + EXAM_PLAN.updatedAt + '）',
          aiFetchedAt: EXAM_PLAN.updatedAt
        };
        S.applications.push(obj);
        DbService.set('applications', obj);
      }
      DbService.setMainProfile();
      renderApplications(); renderExamPlan();
      showToast(`📮 ${add.length}件を追加しました。出願前に公式で最終確認してください`, 'success', 6000);
    });
};
