// ============================================================
// サーバー連携の表示（AI利用量・自動バックアップ・健全性・サーバー側エラー）
// ------------------------------------------------------------
// Vercel Functions 側が Firestore の live/* に書いた集計・診断を
// 読んで表示するだけの層。アプリの同期データ S には載せない
// （live/money と同じ流儀）。
//   live/aiUsage  … 中継（/api/gemini）を通った生成の日次・モデル別集計
//   live/errorLog … アプリから自動送信された直近エラー
//   live/backups  … 自動バックアップの索引（days）
//   live/health   … 毎朝の健全性チェック結果
// GitHub Pages でも読み取り自体は同じ REST で効く（集計の書き手が
// Vercel 側だけなので、Pages 利用分は利用量に数えられない）。
// ============================================================

const AI_USAGE_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/aiUsage';
const ERROR_LOG_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/errorLog';
const BACKUPS_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/backups';
const HEALTH_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/health';
// 今月の概算がこの金額を超えたらホームに控えめに知らせる
const AI_COST_ALERT_YEN = 1000;

// ============================================================
// AI利用量（設定タブの表示 ＋ ホームの注意表示）
// ============================================================
const AiUsageUI = {
  _usage: null,

  // usage.days から対象月（YYYY-MM）の合計を作る（純粋関数・テスト対象）
  _monthTotals: (usage, ym) => {
    const out = { calls: 0, in: 0, out: 0, byModel: {} };
    const days = usage?.days || {};
    for (const day of Object.keys(days)) {
      if (!day.startsWith(ym)) continue;
      const models = days[day] || {};
      for (const m of Object.keys(models)) {
        const v = models[m] || {};
        const b = out.byModel[m] || { calls: 0, in: 0, out: 0 };
        b.calls += v.calls || 0; b.in += v.in || 0; b.out += v.out || 0;
        out.byModel[m] = b;
        out.calls += v.calls || 0; out.in += v.in || 0; out.out += v.out || 0;
      }
    }
    return out;
  },

  // 月の概算コスト（円）。単価の期間判定には月の中日を使う
  _monthCostYen: (totals, ym) => {
    let yen = 0;
    for (const m of Object.keys(totals.byModel || {})) {
      const b = totals.byModel[m];
      yen += AiCost.estimateYen(m, b.in, b.out, ym + '-15');
    }
    return yen;
  },

  load: async () => {
    try {
      const s = await _fsReadStringField(AI_USAGE_DOC_URL, 'usage');
      if (s) { try { AiUsageUI._usage = JSON.parse(s); } catch (e) { /* 壊れていれば未取得扱い */ } }
    } catch (e) { /* 取れなければ表示しないだけ */ }
    AiUsageUI.renderSettings();
    AiUsageUI.renderHomeAlert();
  },

  renderSettings: () => {
    const el = document.getElementById('ai-usage-c');
    if (!el) return;
    const ym = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7); // JST の月（サーバーの日次バケットと合わせる）
    if (!AiUsageUI._usage) {
      el.innerHTML = '<div style="font-size:12px;color:var(--muted)">今月の利用量はまだ集計されていません（Vercel版の中継を使った生成から貯まります）</div>';
      return;
    }
    const t = AiUsageUI._monthTotals(AiUsageUI._usage, ym);
    const yen = AiUsageUI._monthCostYen(t, ym);
    const rows = Object.keys(t.byModel).sort().map(m => {
      const b = t.byModel[m];
      const y = AiCost.estimateYen(m, b.in, b.out, ym + '-15');
      return '<div class="row" style="padding:4px 0"><div style="flex:1;min-width:0"><div class="row-title" style="font-size:12px">' + esc(m) + '</div>'
        + '<div class="row-sub">' + b.calls + '回 ／ 入力 ' + b.in.toLocaleString() + ' ・ 出力 ' + b.out.toLocaleString() + ' トークン</div></div>'
        + '<div style="font-size:12px;font-weight:700">約¥' + Math.round(y).toLocaleString() + '</div></div>';
    }).join('');
    el.innerHTML = '<div style="font-size:13px;font-weight:700;margin-bottom:4px">今月（' + esc(ym) + '）のAI利用量：' + t.calls + '回 ／ 概算 約¥' + Math.round(yen).toLocaleString() + '</div>'
      + (rows || '<div style="font-size:12px;color:var(--muted)">今月はまだ利用がありません</div>')
      + '<div style="font-size:11px;color:var(--muted);line-height:1.6;margin-top:4px">※ Vercel版の中継を通った生成だけを数えています。端末のAPIキーで直接呼んだ分（Pages版など）は含まれません。金額は公開単価からの概算です。</div>';
  },

  renderHomeAlert: () => {
    const el = document.getElementById('home-ai-cost-alert');
    if (!el) return;
    const ym = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7); // JST の月（サーバーの日次バケットと合わせる）
    let html = '';
    if (AiUsageUI._usage) {
      const t = AiUsageUI._monthTotals(AiUsageUI._usage, ym);
      const yen = AiUsageUI._monthCostYen(t, ym);
      if (yen > AI_COST_ALERT_YEN) {
        html = '<div class="card" style="border-left:4px solid var(--a4)"><div style="font-size:13px;line-height:1.7">💸 今月のAI利用料の概算が <b>約¥' + Math.round(yen).toLocaleString() + '</b> になっています（中継経由分のみ）。プリペイド残高の減り具合を確認してください。詳しくは設定タブの「AI利用量」へ。</div></div>';
      }
    }
    el.innerHTML = html;
    el.style.display = html ? 'block' : 'none';
  }
};
window.AiUsageUI = AiUsageUI;

// ============================================================
// サーバー診断（バックアップ・健全性・サーバー側エラー）
// ============================================================
const ServerDiagUI = {
  _health: null,
  _backups: null,
  _serverErrors: null,

  // 健全性カードの HTML（純粋関数・テスト対象）。異常が無ければ空文字
  _healthCardHtml: (health) => {
    const issues = (health && Array.isArray(health.issues)) ? health.issues : [];
    if (!health || health.ok || !issues.length) return '';
    const rows = issues.map(i => '<div style="font-size:13px;line-height:1.7">⚠️ ' + esc(i.msg || i.key || '') + '</div>').join('');
    return '<div class="card" style="border-left:4px solid var(--a2)"><div class="card-hdr"><span class="card-hdr-title">🩺 データの健全性チェック</span></div>' + rows
      + '<div class="muted" style="font-size:11px;margin-top:4px">毎朝の自動チェックで異常が見つかりました。詳しくは設定タブの「アプリ情報・動作確認」へ。</div></div>';
  },

  loadAll: async () => {
    try {
      const [h, b, e] = await Promise.all([
        _fsReadStringField(HEALTH_DOC_URL, 'health').catch(() => null),
        _fsReadStringField(BACKUPS_DOC_URL, 'days').catch(() => null),
        _fsReadStringField(ERROR_LOG_DOC_URL, 'entries').catch(() => null)
      ]);
      if (h) { try { ServerDiagUI._health = JSON.parse(h); } catch (err) {} }
      if (b) { try { ServerDiagUI._backups = JSON.parse(b); } catch (err) {} }
      if (e) { try { ServerDiagUI._serverErrors = JSON.parse(e); } catch (err) {} }
    } catch (e) { /* 取れなければ表示しないだけ */ }
    ServerDiagUI.renderHomeAlert();
    ServerDiagUI.renderSettings();
    if (typeof AiUsageUI !== 'undefined') AiUsageUI.load();
  },

  renderHomeAlert: () => {
    const el = document.getElementById('home-health-alert');
    if (!el) return;
    const html = ServerDiagUI._healthCardHtml(ServerDiagUI._health);
    el.innerHTML = html;
    el.style.display = html ? 'block' : 'none';
  },

  renderSettings: () => {
    const el = document.getElementById('server-diag-c');
    if (!el) return;
    const parts = [];
    // 健全性
    const h = ServerDiagUI._health;
    if (h) {
      parts.push('<div style="font-size:12px;font-weight:700;margin-bottom:4px">🩺 健全性チェック（' + esc(h.checkedAt ? new Date(h.checkedAt).toLocaleString('ja-JP') : '') + '）</div>');
      if (h.ok) parts.push('<div style="font-size:12px;color:var(--muted)">異常は見つかりませんでした ✅</div>');
      else parts.push((h.issues || []).map(i => '<div style="font-size:12px;color:var(--a2);padding:2px 0">⚠️ ' + esc(i.msg || '') + '</div>').join(''));
    } else {
      parts.push('<div style="font-size:12px;color:var(--muted)">健全性チェックはまだ実行されていません（毎朝7:30に自動実行）</div>');
    }
    // バックアップ
    const days = ServerDiagUI._backups || {};
    const keys = Object.keys(days).sort().reverse();
    parts.push('<div style="font-size:12px;font-weight:700;margin:10px 0 4px">💾 自動バックアップ（直近' + keys.length + '日分）</div>');
    if (keys.length) {
      parts.push(keys.map(d => '<div class="row" style="padding:3px 0"><div class="row-title" style="font-size:12px">' + esc(d) + '</div><span class="muted" style="font-size:11px">' + Math.round((days[d].bytes || 0) / 1024) + ' KB</span></div>').join(''));
    } else {
      parts.push('<div style="font-size:12px;color:var(--muted)">バックアップはまだありません（毎朝7:30に自動作成）</div>');
    }
    // サーバー側エラー
    const errs = Array.isArray(ServerDiagUI._serverErrors) ? ServerDiagUI._serverErrors : [];
    parts.push('<div style="font-size:12px;font-weight:700;margin:10px 0 4px">🐞 サーバーに届いた直近エラー（' + errs.length + '件）</div>');
    if (errs.length) {
      parts.push(errs.slice(0, 5).map(e => '<div class="row" style="padding:4px 0"><div style="flex:1;min-width:0"><div class="row-title" style="font-size:12px;color:var(--a2);word-break:break-all">' + esc(e.message || '') + '</div><div class="row-sub">' + esc(e.at ? new Date(e.at).toLocaleString('ja-JP') : '') + ' ／ v' + esc(e.version || '') + ' ／ ' + esc(e.page || '') + '</div></div></div>').join(''));
    } else {
      parts.push('<div style="font-size:12px;color:var(--muted)">サーバーに届いたエラーはありません</div>');
    }
    parts.push('<button class="btn btn-s btn-sm mt12" onclick="ServerDiagUI.loadAll()">🔄 診断情報を更新</button>');
    el.innerHTML = parts.join('');
  }
};
window.ServerDiagUI = ServerDiagUI;

document.addEventListener('DOMContentLoaded', () => {
  // 起動を妨げないよう少し遅らせて読みに行く
  setTimeout(() => { try { ServerDiagUI.loadAll(); } catch (e) {} }, 3500);
});
