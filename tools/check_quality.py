# -*- coding: utf-8 -*-
"""
抽出した教材テキストの品質をチェックする。

・文字化け（置換文字・制御文字）が混じっていないか
・1ページあたりの文字数が極端に少ない教材はないか（OCRの失敗を疑う）
・日本語として成立していないページの割合（記号や英数だけのページ）
・重複ページ（同じ本文が延々と続く＝抽出ミス）

公開前の確認用。読み取り専用で、データは書き換えない。
"""
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(r"C:\Users\user\Desktop\juken_app\textbook-data")
JP = re.compile(r"[ぁ-んァ-ヴ一-龥]")
BAD = re.compile(r"[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]")   # 置換文字・制御文字


def main():
    index = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
    books = index["books"]

    total_pages = total_chars = 0
    bad_char_books, thin_books, dup_books, nonjp_books = [], [], [], []
    sample_lines = []

    for rec in books:
        f = OUT / "books" / f"{rec['id']}.json"
        if not f.exists():
            continue
        book = json.loads(f.read_text(encoding="utf-8"))
        pages = [p for p in book["pages"] if len(p.get("t", "")) >= 20]
        if not pages:
            continue
        chars = sum(len(p["t"]) for p in pages)
        total_pages += len(pages)
        total_chars += chars

        # 1) 文字化け
        bad = sum(len(BAD.findall(p["t"])) for p in pages)
        if bad:
            bad_char_books.append((rec["title"], rec["folder"], bad))

        # 2) 1ページあたりが極端に薄い（OCRがほぼ失敗している疑い）
        per = chars / len(pages)
        if per < 60:
            thin_books.append((rec["title"], rec["folder"], round(per), len(pages)))

        # 3) 日本語がほとんど無いページの割合
        nonjp = sum(1 for p in pages if len(JP.findall(p["t"])) < max(3, len(p["t"]) * 0.05))
        if len(pages) >= 5 and nonjp / len(pages) > 0.5:
            nonjp_books.append((rec["title"], rec["folder"], f"{nonjp}/{len(pages)}"))

        # 4) 同じ本文が大量に重複していないか
        c = Counter(p["t"][:120] for p in pages)
        top, n = c.most_common(1)[0]
        if len(pages) >= 10 and n / len(pages) > 0.5:
            dup_books.append((rec["title"], rec["folder"], f"{n}/{len(pages)}"))

        if len(sample_lines) < 6 and per > 200:
            txt = pages[len(pages) // 2]["t"].replace("\n", " ")
            sample_lines.append(f"  【{rec['title']}】p.{pages[len(pages)//2]['n']}: {txt[:110]}")

    print(f"本文ありページ: {total_pages:,} / 総文字数: {total_chars:,} / 1ページ平均 {total_chars//max(1,total_pages)}字\n")

    def show(title, rows, fmt):
        print(f"■ {title}: {len(rows)}件")
        for r in rows[:12]:
            print("   " + fmt(r))
        if len(rows) > 12:
            print(f"   ...ほか{len(rows)-12}件")
        print()

    show("文字化け（置換文字・制御文字）を含む教材", bad_char_books, lambda r: f"{r[0]}（{r[1]}） {r[2]}個")
    show("1ページ平均60字未満＝OCR失敗の疑い", thin_books, lambda r: f"{r[0]}（{r[1]}） 平均{r[2]}字 / {r[3]}p")
    show("日本語がほぼ無いページが半数超", nonjp_books, lambda r: f"{r[0]}（{r[1]}） {r[2]}")
    show("同じ本文が半数超で重複", dup_books, lambda r: f"{r[0]}（{r[1]}） {r[2]}")

    print("■ 本文のサンプル（中央のページ）")
    for s in sample_lines:
        print(s)


if __name__ == "__main__":
    main()
