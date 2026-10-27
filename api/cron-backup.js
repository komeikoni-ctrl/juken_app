// ============================================================
// Firestore 自動バックアップ ＋ データ健全性チェック（Vercel Cron 専用）
// ------------------------------------------------------------
// 毎日 JST 7:30（= 22:30 UTC）に Vercel Cron から呼ばれる。
// ・バックアップ: プロフィール本体と live 系の主要ドキュメントを
//   REST で読み、そのまま（Firestore REST の表現のまま）1日分の
//   スナップショットとして live/backup-<日付> に保存する。
//   実測（2026-10-27）: プロフィール約37KB / money 約120KB /
//   admWatch 約42KB / feeds 約24KB で、1日分 約230KB。
//   索引は live/backups の days に持ち、直近7日分だけ残す。
// ・健全性: プロフィールの存在と _writtenAt の新しさ、主要キー、
//   live/money の更新時刻、サブコレクションの最終更新の目安を
//   検証して live/health に保存。異常がある場合のみ Push で知ら
//   せる（同じ異常の繰り返し送信はしない）。
// 認可: 他の cron と同じ CRON_SECRET。
// 復元 UI は持たない（保存と診断欄での一覧まで）。
// ============================================================
const lib = require('./_pushlib');

const KEEP_DAYS = 7;
const SNAPSHOT_DOCS = [
  ['money', lib.MONEY_DOC],
  ['feeds', lib.FEEDS_DOC],
  ['admWatch', lib.WATCH_DOC],
  ['pushSubs', lib.PUSH_SUBS_DOC],
  ['pushState', lib.PUSH_STATE_DOC],
  ['aiUsage', lib.AI_USAGE_DOC]
];
// プロフィールに最低限あるはずの主要キー（実データのフィールド名で確認済み）
const PROFILE_KEYS = ['userName', 'scoreTargets', 'timetable', 'moneySubs'];
const PROFILE_STALE_MS = 7 * 86400000;   // 7日以上書き込みが無い
const MONEY_STALE_MS = 6 * 3600000;      // お金タブは2時間おき更新 → 6時間途絶で異常
const SUBCOL_STALE_MS = 30 * 86400000;   // サブコレクションの目安: 30日

function backupDocId(dateStr) { return 'live/backup-' + dateStr; }

async function runBackup(today) {
  const snapshot = { at: new Date().toISOString(), date: today, profile: null, docs: {} };
  const profile = await lib.fsGetDoc(lib.PROFILE_DOC);
  snapshot.profile = profile; // REST のドキュメント表現そのまま（復元時にそのまま戻せる）
  for (const [name, path] of SNAPSHOT_DOCS) {
    try { snapshot.docs[name] = await lib.fsGetDoc(path); }
    catch (e) { snapshot.docs[name] = null; }
  }
  const data = JSON.stringify(snapshot);
  await lib.fsSetField(backupDocId(today), 'data', data);

  // 索引を更新し、古い日をローテーション削除する
  const days = await lib.fsGetJson(lib.BACKUPS_INDEX_DOC, 'days', {});
  days[today] = { at: snapshot.at, bytes: Buffer.byteLength(data, 'utf8') };
  const sorted = Object.keys(days).sort();
  const removed = [];
  while (sorted.length > KEEP_DAYS) {
    const old = sorted.shift();
    delete days[old];
    removed.push(old);
    // 削除できない環境では空にして実質的に消す
    const delOk = await lib.fsDeleteDoc(backupDocId(old));
    if (!delOk) { try { await lib.fsSetField(backupDocId(old), 'data', ''); } catch (e) { /* 次回に任せる */ } }
  }
  await lib.fsSetJson(lib.BACKUPS_INDEX_DOC, 'days', days);
  return { bytes: Buffer.byteLength(data, 'utf8'), removed, kept: Object.keys(days).sort() };
}

// Firestore REST の integerValue / timestampValue を数値ミリ秒へ
function fsTimeMs(v) {
  if (v == null) return 0;
  if (typeof v === 'object') {
    if (v.integerValue != null) return Number(v.integerValue) || 0;
    if (v.timestampValue) return Date.parse(v.timestampValue) || 0;
    if (v.stringValue) return Date.parse(v.stringValue) || 0;
  }
  return 0;
}

async function runHealth(profile, nowMs) {
  const issues = [];
  const details = {};

  // --- プロフィール ---
  if (!profile || !profile.fields) {
    issues.push({ key: 'profile-missing', msg: 'プロフィール（本体データ）が見つかりません' });
  } else {
    const f = profile.fields;
    const writtenAt = fsTimeMs(f._writtenAt);
    details.profileWrittenAt = writtenAt ? new Date(writtenAt).toISOString() : null;
    if (writtenAt && nowMs - writtenAt > PROFILE_STALE_MS) {
      issues.push({ key: 'profile-stale', msg: 'プロフィールの最終保存から7日以上経っています（端末側の同期を確認してください）' });
    }
    const missing = PROFILE_KEYS.filter(k => !(k in f));
    details.profileMissingKeys = missing;
    if (missing.length) {
      issues.push({ key: 'profile-keys', msg: 'プロフィールに主要キーが欠けています: ' + missing.join(', ') });
    }
  }

  // --- live/money の鮮度 ---
  try {
    const moneyDoc = await lib.fsGetDoc(lib.MONEY_DOC);
    const s = moneyDoc?.fields?.money?.stringValue;
    const money = s ? JSON.parse(s) : null;
    const upd = money?.updatedAt ? Date.parse(money.updatedAt) : 0;
    details.moneyUpdatedAt = upd ? new Date(upd).toISOString() : null;
    if (!money) issues.push({ key: 'money-missing', msg: 'お金タブのデータ（live/money）が見つかりません' });
    else if (upd && nowMs - upd > MONEY_STALE_MS) {
      issues.push({ key: 'money-stale', msg: 'お金タブの自動更新が6時間以上止まっています' });
    }
  } catch (e) {
    details.moneyError = String(e && e.message || e);
  }

  // --- サブコレクションの最終更新（目安: 先頭サンプルの updateTime 最大値） ---
  details.subcollections = {};
  for (const col of ['tasks', 'chatHistory']) {
    try {
      const docs = await lib.fsSampleCollection(lib.PROFILE_DOC + '/' + col, 5);
      let max = 0;
      for (const d of docs) { const t = Date.parse(d.updateTime || '') || 0; if (t > max) max = t; }
      details.subcollections[col] = max ? new Date(max).toISOString() : null;
      if (max && nowMs - max > SUBCOL_STALE_MS) {
        issues.push({ key: 'subcol-stale-' + col, msg: '「' + col + '」の最終更新（目安）から30日以上経っています' });
      }
    } catch (e) {
      details.subcollections[col] = 'unknown';
    }
  }

  return { issues, details };
}

module.exports = async (req, res) => {
  try {
    if (!lib.cronAuthorized(req)) return lib.sendJson(res, 401, { error: 'unauthorized' });
    const nowMs = Date.now();
    const today = lib.todayJst();

    const backup = await runBackup(today);

    // 健全性チェック（バックアップで読んだプロフィールを再利用）
    let profile = null;
    try { profile = await lib.fsGetDoc(lib.PROFILE_DOC); } catch (e) { /* missing として扱う */ }
    const { issues, details } = await runHealth(profile, nowMs);
    const health = { checkedAt: new Date(nowMs).toISOString(), ok: issues.length === 0, issues, details };
    const prev = await lib.fsGetJson(lib.HEALTH_DOC, 'health', null);
    await lib.fsSetJson(lib.HEALTH_DOC, 'health', health);

    // 異常がある場合のみ Push（前回と同じ異常の再送はしない）
    let pushResult = null;
    if (issues.length) {
      const prevKeys = new Set((prev?.issues || []).map(i => i.key));
      const fresh = issues.filter(i => !prevKeys.has(i.key));
      if (fresh.length) {
        pushResult = await lib.sendPushToAll({
          title: '🩺 データ健全性の警告',
          body: fresh.map(i => i.msg).join(' / ').slice(0, 220),
          url: '/', tag: 'juken-health'
        });
      }
    }
    return lib.sendJson(res, 200, {
      ok: true, date: today,
      backup: { bytes: backup.bytes, kept: backup.kept, removed: backup.removed },
      health: { ok: health.ok, issues: issues.map(i => i.key) },
      push: pushResult
    });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 60 };
