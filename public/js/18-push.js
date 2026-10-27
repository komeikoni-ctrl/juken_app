// ============================================================
// プッシュ通知 ＆ 入試情報ウォッチ（Vercel版のみ）
// ------------------------------------------------------------
// 通知: Vercel Functions（/api/push-send 等）＋ Web Push。
//   購読情報は Firestore の live/pushSubs に保存する（お金タブの
//   live/money と同じ REST 方式。アプリの同期データ S には載せない）。
// 入試情報: サーバー（cron-watch）が3大学の公式入学案内ページを
//   毎日チェックし、変更があれば Firestore live/admWatch の
//   updates に積む。ここではそれを読んでホームにカードを出す。
// GitHub Pages には Functions が無いので、有効化は失敗を検知して
// 案内文を出すだけにし、アプリ本体は壊れないようにする。
// ============================================================

const VAPID_PUBLIC_KEY = 'BCE585peGIZqj7y_uRF7NJQjdB1Lg238kNMkw2DMHcwbv8pj8i_Jr8x13vPe0lZBI8sfX0VWviEgwoZI5hEHbhQ';
const PUSH_SUBS_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/pushSubs';
const WATCH_DOC_URL = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents/live/admWatch';
const PUSH_LOCAL_KEY = 'jukenPush2027';   // {endpoint} この端末の購読状態
const WATCH_CACHE_KEY = 'jukenAdmWatch2027'; // {updates:[...], fetchedAt}

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
// 入試情報ウォッチ（ホームのカード）
// ============================================================
const AdmWatchUI = {
  _cache: {
    read: () => { try { return JSON.parse(localStorage.getItem(WATCH_CACHE_KEY) || 'null'); } catch (e) { return null; } },
    write: (o) => { try { localStorage.setItem(WATCH_CACHE_KEY, JSON.stringify(o)); } catch (e) {} }
  },

  // 未読だけを新しい順に（純粋関数: テスト対象）
  _unread: (updates) => (Array.isArray(updates) ? updates : []).filter(u => u && !u.read),

  // カードの中身（純粋関数: テスト対象）
  _cardHtml: (updates) => {
    const un = AdmWatchUI._unread(updates);
    if (!un.length) return '';
    const rows = un.slice(0, 5).map(u => {
      const d = u.at ? new Date(u.at) : null;
      const ds = d ? (d.getMonth() + 1) + '/' + d.getDate() : '';
      return '<div style="padding:8px 0;border-top:1px solid var(--border)">'
        + '<div style="font-weight:800;font-size:13px">🎓 ' + esc(u.uni || '') + ' の入試ページが更新されました'
        + (ds ? ' <span class="muted" style="font-weight:400;font-size:11px">' + ds + ' 検知</span>' : '') + '</div>'
        + (u.snippet ? '<div class="muted" style="font-size:12px;line-height:1.6;margin-top:2px">…' + esc(u.snippet) + '…</div>' : '')
        + (u.url ? '<a href="' + esc(u.url) + '" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent);font-weight:700">公式ページで確認する →</a>' : '')
        + '</div>';
    }).join('');
    return '<div class="card" style="border-left:4px solid var(--accent)">'
      + '<div class="card-hdr"><span class="card-hdr-title">🎓 入試情報の更新</span>'
      + '<button class="btn btn-s btn-sm" onclick="AdmWatchUI.markAllRead()">既読にする</button></div>'
      + rows + '</div>';
  },

  _updates: [],
  load: async () => {
    const cached = AdmWatchUI._cache.read();
    if (cached && Array.isArray(cached.updates)) AdmWatchUI._updates = cached.updates;
    AdmWatchUI.render();
    try {
      const s = await _fsReadStringField(WATCH_DOC_URL, 'updates');
      if (s != null) {
        const arr = JSON.parse(s || '[]');
        if (Array.isArray(arr)) {
          // 既読は端末側の状態を優先する（サーバー側の read は他端末向け）
          const readIds = new Set(AdmWatchUI._updates.filter(u => u.read).map(u => u.id));
          AdmWatchUI._updates = arr.map(u => readIds.has(u.id) ? { ...u, read: true } : u);
          AdmWatchUI._cache.write({ updates: AdmWatchUI._updates, fetchedAt: Date.now() });
        }
      }
    } catch (e) { /* 取れなければキャッシュ表示のまま */ }
    AdmWatchUI.render();
  },

  render: () => {
    const el = document.getElementById('home-adm-watch');
    if (!el) return;
    const html = AdmWatchUI._cardHtml(AdmWatchUI._updates);
    el.innerHTML = html;
    el.style.display = html ? 'block' : 'none';
  },

  markAllRead: async () => {
    AdmWatchUI._updates = AdmWatchUI._updates.map(u => ({ ...u, read: true }));
    AdmWatchUI._cache.write({ updates: AdmWatchUI._updates, fetchedAt: Date.now() });
    AdmWatchUI.render();
    // サーバー側にも既読を伝える（失敗しても端末側の既読は保つ）
    try { await _fsWriteStringField(WATCH_DOC_URL, 'updates', JSON.stringify(AdmWatchUI._updates)); } catch (e) {}
    showToast('入試情報の更新を既読にしました');
  }
};
window.AdmWatchUI = AdmWatchUI;

document.addEventListener('DOMContentLoaded', () => {
  // 設定タブを開いた時にも状態が最新になるよう、描画のたびに軽く更新
  try { AdmWatchUI.load(); } catch (e) {}
});
