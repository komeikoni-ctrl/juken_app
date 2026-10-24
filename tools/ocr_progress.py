# -*- coding: utf-8 -*-
"""
OCRの進み具合を、データそのものから厳密に数える。

ざっくり「needs_ocr の本のページ数を足す」やり方だと、
・処理中の本が丸ごと「残り」に数えられる
・文字層がある本の中の一部ページのOCRが数に入らない
ので実態とずれる。ここでは1ページずつ見て数える。

出力はJSON1行（進捗ページに流し込む用）。
"""
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(r"C:\Users\user\Desktop\juken_app\textbook-data")
MIN_CHARS = 20


def main(log_path: str = "", elapsed_min: float = 0.0):
    index = json.loads((OUT / "index.json").read_text(encoding="utf-8"))

    pages_done = pages_left = 0          # OCRを実行したページ／これから実行するページ
    pages_text = 0                       # もともと文字層があったページ
    chars = 0
    books_need = set()                   # OCRが必要だった本
    books_left = set()                   # まだ残っている本

    for rec in index["books"]:
        f = OUT / "books" / f"{rec['id']}.json"
        if not f.exists():
            continue
        book = json.loads(f.read_text(encoding="utf-8"))
        for p in book["pages"]:
            t = p.get("t", "")
            chars += len(t)
            if p.get("ocr"):
                pages_done += 1
                books_need.add(rec["id"])
            elif len(t) >= MIN_CHARS:
                pages_text += 1
            else:
                pages_left += 1
                books_need.add(rec["id"])
                books_left.add(rec["id"])

    current_book, current_page = "", 0
    if log_path and Path(log_path).exists():
        lines = Path(log_path).read_text(encoding="utf-8", errors="ignore").splitlines()
        for ln in reversed(lines):
            m = re.match(r"^\[\d+/\d+\]\s+(.+?)\s+OCR\s", ln)
            if m:
                current_book = m.group(1)
                break
        for ln in reversed(lines):
            m = re.match(r"^\s+(\d+)/(\d+)p", ln)
            if m:
                current_page = int(m.group(1))
                break

    total = pages_done + pages_left
    rate = round(pages_done / elapsed_min) if elapsed_min > 0 else 0
    eta_min = round(pages_left / rate) if rate > 0 else 0

    print(json.dumps({
        "pagesDone": pages_done,
        "pagesLeft": pages_left,
        "pagesTotal": total,
        "pagesFromTextLayer": pages_text,
        "booksOcrTotal": len(books_need),
        "booksOcrDone": len(books_need) - len(books_left),
        "booksAll": len(index["books"]),
        "chars": chars,
        "pagesPerMin": rate,
        "etaMin": eta_min,
        "currentBook": current_book,
        "currentPage": current_page,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "",
         float(sys.argv[2]) if len(sys.argv) > 2 else 0.0)
