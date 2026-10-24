# -*- coding: utf-8 -*-
"""
教材データをクラウド（Firestore）に上げ下げする。アプリの TBSync と同じ形式で読み書きする。

アプリ側でも同期はできるが、30MB・約450ドキュメントを一気に上げるのは
パソコンから直接やるほうが速くて確実（ブラウザのタブが裏に回ると極端に遅くなる）。

使い方:
    python tools/tb_cloud.py status  <docId>     クラウドにある教材の数を見る
    python tools/tb_cloud.py push    <docId>     bundle/ の教材のうち、クラウドに無いものを上げる
    python tools/tb_cloud.py verify  <docId>     クラウドから読み戻して bundle と1文字ずつ照合する
    python tools/tb_cloud.py wipe    <docId>     その docId の教材を全部消す（検証用データの掃除）

docId は  sandbox_test_data（検証用） か  perfect_sync_data_2027（本番）。
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

PROJECT = "juken2027-63058"
API_KEY = "AIzaSyAqvY2gfztJvOsyxPnrfw11nAD8FocvNgU"       # 公開JSに載っているWeb用キー（秘密ではない）
BUNDLE = Path(r"C:\Users\user\Desktop\juken_app\textbook-data\bundle")
CHUNK = 240000          # 文字数。1文字最大4バイトでも1MiB未満に収まる大きさ
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def enc(v):
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [enc(x) for x in v]}}
    return {"mapValue": {"fields": {k: enc(x) for k, x in v.items()}}}


def dec(v):
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "arrayValue" in v:
        return [dec(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: dec(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def url(doc_id, name):
    return f"{BASE}/appData/{doc_id}/textbooks/{urllib.parse.quote(name, safe='')}?key={API_KEY}"


def request(method, target, body=None, tries=4):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    for attempt in range(tries):
        req = urllib.request.Request(target, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 500, 503) and attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"{method} 失敗 {e.code}: {e.read()[:200]!r}")
        except urllib.error.URLError:
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise


def get(doc_id, name):
    r = request("GET", url(doc_id, name))
    return {k: dec(v) for k, v in r.get("fields", {}).items()} if r else None


def put(doc_id, name, obj):
    request("PATCH", url(doc_id, name), {"fields": {k: enc(v) for k, v in obj.items()}})


def list_doc_names(doc_id):
    names, token = [], ""
    while True:
        target = f"{BASE}/appData/{doc_id}/textbooks?key={API_KEY}&pageSize=300&mask.fieldPaths=id" + (f"&pageToken={token}" if token else "")
        r = request("GET", target) or {}
        names += [d["name"].rsplit("/", 1)[1] for d in r.get("documents", [])]
        token = r.get("nextPageToken", "")
        if not token:
            return names


def load_bundle():
    books = []
    for f in sorted(BUNDLE.glob("textbooks-*.json")):
        books += json.loads(f.read_text(encoding="utf-8"))["books"]
    return books


def meta_of(b):
    return {"id": b["id"], "title": b["title"], "subject": b.get("subject", "その他"), "folder": b.get("folder", ""),
            "pages": len(b["pages"]), "textPages": b.get("textPages", len(b["pages"])), "chars": b.get("chars", 0)}


def cmd_status(doc_id):
    idx = get(doc_id, "__index")
    books = (idx or {}).get("books", [])
    print(f"{doc_id}: 目録 {len(books)}冊 / 総文字 {sum(b.get('chars', 0) for b in books):,}")


def cmd_push(doc_id):
    books = load_bundle()
    remote = (get(doc_id, "__index") or {}).get("books", [])
    merged = {b["id"]: b for b in remote}
    todo = [b for b in books if b["id"] not in merged]
    print(f"bundle {len(books)}冊 / クラウド {len(remote)}冊 / これから送る {len(todo)}冊", flush=True)

    def send(b):
        text = json.dumps([{"n": p["n"], "t": p["t"]} for p in b["pages"]], ensure_ascii=False, separators=(",", ":"))
        chunks = [text[i:i + CHUNK] for i in range(0, len(text), CHUNK)]
        for i, c in enumerate(chunks):
            put(doc_id, f"{b['id']}__{i}", {"id": b["id"], "i": i, "data": c})
        put(doc_id, f"{b['id']}__manifest", {"id": b["id"], "chunks": len(chunks), "title": b["title"]})
        return b, len(chunks)

    done = docs = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for b, n in pool.map(send, todo):
            merged[b["id"]] = meta_of(b)
            done += 1
            docs += n + 1
            if done % 25 == 0 or done == len(todo):
                # 途中で止まっても、上げ終えた分は使えるように目録をこまめに更新する
                put(doc_id, "__index", {"books": list(merged.values()), "updatedAt": int(time.time() * 1000), "device": "pc-uploader"})
                print(f"  {done}/{len(todo)}冊（{docs}ドキュメント）", flush=True)
    if not todo:
        print("送るものはありません（同期済み）")
    print(f"完了: クラウド上 {len(merged)}冊")


def cmd_verify(doc_id):
    books = load_bundle()
    idx = {b["id"] for b in (get(doc_id, "__index") or {}).get("books", [])}
    missing = [b["title"] for b in books if b["id"] not in idx]

    def check(b):
        m = get(doc_id, f"{b['id']}__manifest")
        if not m:
            return b["title"], "目録なし"
        parts = [get(doc_id, f"{b['id']}__{i}") for i in range(m["chunks"])]
        if any(p is None for p in parts):
            return b["title"], "分割が欠けている"
        pages = json.loads("".join(p["data"] for p in parts))
        want = [(p["n"], p["t"]) for p in b["pages"]]
        have = [(p["n"], p["t"]) for p in pages]
        return b["title"], ("" if want == have else "本文が一致しない")

    bad = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for n, (title, err) in enumerate(pool.map(check, books), 1):
            if err:
                bad.append(f"{title}: {err}")
            if n % 50 == 0:
                print(f"  照合 {n}/{len(books)}", flush=True)
    print(f"照合 {len(books)}冊: 一致 {len(books) - len(bad)} / 不一致 {len(bad)} / 目録に無い {len(missing)}")
    for line in bad[:10]:
        print("   NG", line)


def cmd_wipe(doc_id):
    if doc_id != "sandbox_test_data":
        raise SystemExit("本番の教材は消しません（wipe は sandbox_test_data 専用）")
    names = list_doc_names(doc_id)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda n: request("DELETE", url(doc_id, n)), names))
    print(f"{doc_id}: {len(names)}ドキュメントを削除")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    {"status": cmd_status, "push": cmd_push, "verify": cmd_verify, "wipe": cmd_wipe}[sys.argv[1]](sys.argv[2])
