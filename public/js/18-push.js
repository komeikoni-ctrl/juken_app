// ============================================================
// プッシュ通知（Vercel版のみ）
// ------------------------------------------------------------
// 通知: Vercel Functions（/api/push-send 等）＋ Web Push。
//   購読情報は Firestore の live/pushSubs に保存する（お金タブの
//   live/money と同じ REST 方式。アプリの同期データ S には載せない）。
// 入試情報: サーバー（cron-watch）が3大学の公式入学案内ページを
//   毎日チェックし、変更があればプッシュ通知で知らせる。
//   ホームへのカード表示は 2026-10-31 に廃止した（こにの指示）。
// GitHub Pages には Functions が無いので、有効化は失敗を検知して
// 案内文を出すだけにし、アプリ本体は壊れないようにする。
// ============================================================

const VAPID_PUBLIC_KEY = 'BCE585peGIZqj7y_uRF7NJQjdB1Lg238kNMkw2DMHcwbv8pj8i_Jr8x13vPe0lZBI8sfX0VWviEgwoZI5hEHbhQ';
const PUSH_SUBS_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/pushSubs';
const PUSH_LOCAL_KEY = 'jukenPush2027';   // {endpoint} この端末の購読状態

function _b64ToBytes(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Firestore の JSON 文字列フィールドを読む（money と同じ流儀）
async function _fsReadStringField(url, field) {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const doc = await res.json();
  const s = doc?.fields?.[field]?.stringValue;
  return typeof s === 'string' ? s : null;
}
async function _fsWriteStringField(url, field, value) {
  const res = await fetch(url + '?updateMask.fieldPaths=' + encodeURIComponent(field), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [field]: { stringValue: value } } })
  });
  return res.ok;
}

// ============================================================
// プッシュ通知
// ============================================================
const PushUI = {
  isSupported: () => ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window),
  isPagesHost: () => location.hostname.endsWith('github.io'),

  _local: {
    read: () => { try { return JSON.parse(localStorage.getItem(PUSH_LOCAL_KEY) || 'null'); } catch (e) { return null; } },
    write: (o) => { try { o ? localStorage.setItem(PUSH_LOCAL_KEY, JSON.stringify(o)) : localStorage.removeItem(PUSH_LOCAL_KEY); } catch (e) {} }
  },

  // ブラウザの購読 → Firestore 保存用の形
  _subPayload: (sub) => {
    const j = sub.toJSON ? sub.toJSON() : sub;
    return { endpoint: j.endpoint, keys: { p256dh: j.keys?.p256dh || '', auth: j.keys?.auth || '' } };
  },

  _saveSubscription: async (payload) => {
    const cur = JSON.parse((await _fsReadStringField(PUSH_SUBS_DOC_URL, 'subs')) || '[]');
    const list = (Array.isArray(cur) ? cur : []).filter(s => s && s.endpoint !== payload.endpoint);
    list.push(payload);
    return _fsWriteStringField(PUSH_SUBS_DOC_URL, 'subs', JSON.stringify(list));
  },
  _removeSubscription: async (endpoint) => {
    const cur = JSON.parse((await _fsReadStringField(PUSH_SUBS_DOC_URL, 'subs')) || '[]');
    const list = (Array.isArray(cur) ? cur : []).filter(s => s && s.endpoint !== endpoint);
    return _fsWriteStringField(PUSH_SUBS_DOC_URL, 'subs', JSON.stringify(list));
  },

  refreshSettings: async () => {
    const st = document.getElementById('push-status');
    const toggle = document.getElementById('push-toggle');
    const btnTest = document.getElementById('push-test-btn');
    if (!st) return;
    const setState = (on, canToggle, canTest) => {
      if (toggle) { toggle.checked = !!on; toggle.disabled = !canToggle; }
      if (btnTest) btnTest.disabled = !canTest;
    };
    if (PushUI.isPagesHost()) {
      st.textContent = 'GitHub Pages版ではプッシュ通知は使えません。Vercel版（juken-app-sigma.vercel.app）で有効化してください。';
      setState(false, false, false);
      return;
    }
    if (!PushUI.isSupported()) {
      st.textContent = 'このブラウザ／表示方法では通知に対応していません。iPhoneでは「ホーム画面に追加」したアプリから開いてください。';
      setState(false, false, false);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (Notification.permission === 'denied') {
        st.textContent = '通知がブロックされています。端末の「設定」アプリでこのアプリの通知を許可してください。';
        setState(false, false, false);
      } else if (sub) {
        st.textContent = '✅ 通知はオンです。出願の開始・締切（3日前・前日・当日）と入試情報の更新をお知らせします。オフにすると購読を解除し、送信対象からも外れます。';
        setState(true, true, true);
      } else {
        st.textContent = '通知はオフです。トグルをオンにすると購読を登録します。';
        setState(false, true, false);
      }
    } catch (e) {
      st.textContent = '状態を確認できませんでした。';
      setState(false, true, false);
    }
  },

  enable: async () => {
    try {
      if (PushUI.isPagesHost()) { showToast('Pages版では使えません。Vercel版で開いてください', 'warn'); return; }
      if (!PushUI.isSupported()) { showToast('この環境では通知に対応していません（ホーム画面に追加したアプリから開いてください）', 'warn'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { showToast('通知が許可されませんでした', 'warn'); PushUI.refreshSettings(); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToBytes(VAPID_PUBLIC_KEY) });
      }
      const ok = await PushUI._saveSubscription(PushUI._subPayload(sub));
      if (!ok) { showToast('購読情報の保存に失敗しました', 'warn'); return; }
      PushUI._local.write({ endpoint: sub.endpoint, at: Date.now() });
      showToast('🔔 通知を有効にしました！テスト通知で確認できます');
    } catch (e) {
      console.warn('[push] enable failed', e);
      showToast('通知の有効化に失敗しました', 'warn');
    }
    PushUI.refreshSettings();
  },

  disable: async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await PushUI._removeSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      PushUI._local.write(null);
      showToast('通知を無効にしました');
    } catch (e) { showToast('無効化に失敗しました', 'warn'); }
    PushUI.refreshSettings();
  },

  test: async () => {
    try {
      const res = await fetch('/api/push-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true })
      });
      if (!res.ok) { showToast('テスト通知の送信に失敗しました（' + res.status + '）', 'warn'); return; }
      const r = await res.json();
      if (!r.total) showToast('購読が見つかりません。先に通知を有効化してください', 'warn');
      else showToast('テスト通知を送りました（' + r.sent + '件）。通知が届くか確認してください');
    } catch (e) { showToast('テスト通知の送信に失敗しました', 'warn'); }
  }
};
window.PushUI = PushUI;
window.enablePush = () => PushUI.enable();
window.disablePush = () => PushUI.disable();
// 設定のトグル: オン→購読を登録、オフ→購読解除＋サーバー側の送信対象からも除外
window.togglePush = (on) => { if (on) PushUI.enable(); else PushUI.disable(); };
window.testPush = () => PushUI.test();

// ============================================================
// 入試情報ウォッチのホーム表示は廃止（2026-10-31 こにの指示「ホームに受験情報入れるのやめて」）
// サーバー側の監視（cron-watch）とプッシュ通知は従来どおりで、
// ホーム画面にはカードを出さないし、admWatch の取得もしない。
// ============================================================
