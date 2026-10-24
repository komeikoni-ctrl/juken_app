# -*- coding: utf-8 -*-
"""
books/*.json を1つのファイルにまとめる。

iPhone / iPad では「ファイル」アプリから100個のJSONを選ぶのは現実的でないので、
まとめた1ファイルを iCloud Drive などに置いて、それを選んでもらう。

大きくなりすぎる場合は科目ごとに分割する（1ファイル ~12MB を目安）。

使い方:
    python tools/bundle_textbooks.py
出力:
    textbook-data/bundle/textbooks-<科目>.json  （分割したとき）
    textbook-data/bundle/textbooks-all.json     （1つに収まるとき）
"""
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(r"C:\Users\user\Desktop\juken_app\textbook-data")
BUNDLE = OUT / "bundle"
SPLIT_BYTES = 12 * 1024 * 1024

# ── ページの品質判定 ──────────────────────────────────────────
# 手書きページをOCRにかけると「= びれ一 3 ) いー。从 ( 5 ら仁の一」のような
# 意味を成さない文字列になる。こういうページを入れるとAIが混乱するだけなので落とす。
# 日本語が一定割合あるか、英単語として読める部分が一定割合あれば「本文」とみなす。
JP_CHARS = re.compile(r"[ぁ-んァ-ヴ一-龥]")
EN_WORDS = re.compile(r"[A-Za-z]{3,}")


def page_is_readable(text: str) -> bool:
    n = len(text)
    if n < 40:
        return False
    jp = len(JP_CHARS.findall(text))
    en = sum(len(w) for w in EN_WORDS.findall(text))
    return (jp / n) >= 0.20 or (en / n) >= 0.30


def write(path: Path, books: list) -> int:
    payload = {"books": books}
    text = json.dumps(payload, ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    size = len(text.encode("utf-8"))
    pages = sum(len(b["pages"]) for b in books)
    print(f"  {path.name}: {len(books)}冊 {pages}ページ {size/1024/1024:.1f}MB")
    return size


def main():
    index = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
    BUNDLE.mkdir(parents=True, exist_ok=True)
    for old in BUNDLE.glob("textbooks-*.json"):
        old.unlink()

    books, skipped, dropped_pages, dropped_books = [], 0, 0, []
    for rec in index["books"]:
        f = OUT / "books" / f"{rec['id']}.json"
        if not f.exists():
            continue
        book = json.loads(f.read_text(encoding="utf-8"))
        # 本文が無い教材は入れても検索に出ないだけなので省く（容量のむだ）
        raw = [p for p in book["pages"] if len(p.get("t", "")) >= 20]
        pages = [p for p in raw if page_is_readable(p["t"])]
        dropped_pages += len(raw) - len(pages)
        if raw and not pages:
            dropped_books.append(f"{rec['folder']}/{rec['title']}（{len(raw)}p）")
        if not pages:
            skipped += 1
            continue
        books.append({"id": book["id"], "title": book["title"], "subject": book.get("subject", "その他"),
                      "folder": book.get("folder", ""), "textPages": len(pages),
                      "chars": sum(len(p["t"]) for p in pages),
                      "pages": [{"n": p["n"], "t": p["t"]} for p in pages]})

    total = len(json.dumps({"books": books}, ensure_ascii=False).encode("utf-8"))
    print(f"本文ありの教材 {len(books)}冊（除外 {skipped}冊） 合計 {total/1024/1024:.1f}MB")
    print(f"読めないページとして除外: {dropped_pages:,}ページ")
    if dropped_books:
        print(f"全ページが読めず丸ごと除外した教材 {len(dropped_books)}冊:")
        for b in dropped_books[:15]:
            print(f"   {b}")
        if len(dropped_books) > 15:
            print(f"   ...ほか{len(dropped_books)-15}冊")

    if total <= SPLIT_BYTES:
        write(BUNDLE / "textbooks-all.json", books)
    else:
        by_subject = {}
        for b in books:
            by_subject.setdefault(b["subject"], []).append(b)
        print("大きいので科目ごとに分けます:")
        for subject, group in sorted(by_subject.items()):
            # 1科目でも大きすぎる場合はさらに連番で割る
            chunk, chunk_bytes, part = [], 0, 1
            for b in group:
                size = len(json.dumps(b, ensure_ascii=False).encode("utf-8"))
                if chunk and chunk_bytes + size > SPLIT_BYTES:
                    write(BUNDLE / f"textbooks-{subject}{part}.json", chunk)
                    chunk, chunk_bytes, part = [], 0, part + 1
                chunk.append(b)
                chunk_bytes += size
            if chunk:
                name = f"textbooks-{subject}.json" if part == 1 else f"textbooks-{subject}{part}.json"
                write(BUNDLE / name, chunk)

    print(f"\n出力先: {BUNDLE}")
    print("この中のファイルを iCloud Drive などに入れて、アプリの「教材データを読み込む」から選んでください。")


if __name__ == "__main__":
    main()
