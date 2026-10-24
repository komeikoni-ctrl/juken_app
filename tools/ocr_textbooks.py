# -*- coding: utf-8 -*-
"""
文字層を持たないスキャン教材を、Windows 標準OCR（日本語）で文字化する。

Gemini などの API は一切使わない。PDFのページを PyMuPDF で画像にして、
Windows.Media.Ocr に渡すだけ。完全にローカルで完結する。

extract_textbooks.py が作った textbook-data/ を読み、
テキストが空のページだけを埋めて上書きする（途中で止めても再開できる）。

使い方:
    python tools/ocr_textbooks.py            # 全部
    python tools/ocr_textbooks.py upgrade    # 名前に一致する教材だけ
"""
import asyncio
import json
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf
import winrt.windows.graphics.imaging as imaging
import winrt.windows.media.ocr as ocr
import winrt.windows.storage.streams as streams

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"G:\マイドライブ\GoodNotes")
OUT = Path(r"C:\Users\user\Desktop\juken_app\textbook-data")
# 200dpi 相当。これ以上上げても精度はあまり変わらず、遅くなるだけ
ZOOM = 200 / 72
MIN_CHARS = 20          # これ未満のページは「文字が無い」とみなしてOCR対象にする
MAX_PAGES_PER_BOOK = 0  # 0 なら全ページ

_engine = ocr.OcrEngine.try_create_from_user_profile_languages()
if _engine is None:
    raise SystemExit("OCRエンジンを作成できません（日本語OCRパックが必要）")


# Windows OCR \u306f\u5358\u8a9e\u3054\u3068\u306b\u533a\u5207\u3063\u3066\u8fd4\u3059\u305f\u3081\u3001\u65e5\u672c\u8a9e\u3060\u3068\u300c\u6587 \u578b\u300d\u300c\u3053 \u306e \u7ae0\u300d\u306e\u3088\u3046\u306b
# 1\u6587\u5b57\u305a\u3064\u7a7a\u767d\u304c\u5165\u308b\u3002\u65e5\u672c\u8a9e\u6587\u5b57\u306b\u306f\u3055\u307e\u308c\u305f\u7a7a\u767d\u306f\u6d88\u3059\uff08\u82f1\u5358\u8a9e\u306e\u533a\u5207\u308a\u306f\u6b8b\u3059\uff09\u3002
CJK = r"\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f\u3001-\u303f"
_JP_SPACE = re.compile(rf"(?<=[{CJK}])[ \t]+(?=[{CJK}])")


def clean(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\u3000", " ")
    for _ in range(3):                      # \u300c\u6587 \u578b \u3067 \u3059\u300d\u306e\u3088\u3046\u306b\u9023\u7d9a\u3059\u308b\u5834\u5408\u304c\u3042\u308b\u305f\u3081\u6570\u56de\u304b\u3051\u308b
        text = _JP_SPACE.sub("", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


async def ocr_png(png: bytes) -> str:
    """PNGバイト列 → OCRテキスト"""
    stream = streams.InMemoryRandomAccessStream()
    writer = streams.DataWriter(stream.get_output_stream_at(0))
    writer.write_bytes(png)
    await writer.store_async()
    await writer.flush_async()
    stream.seek(0)
    decoder = await imaging.BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    result = await _engine.recognize_async(bitmap)
    return "\n".join(line.text for line in result.lines)


async def run(filter_word: str = ""):
    index_path = OUT / "index.json"
    if not index_path.exists():
        raise SystemExit("先に extract_textbooks.py を実行してください")
    index = json.loads(index_path.read_text(encoding="utf-8"))

    targets = []
    for rec in index["books"]:
        if rec["status"] == "skipped_large":
            continue
        if filter_word and filter_word.lower() not in (rec["title"] + rec["folder"]).lower():
            continue
        book_file = OUT / "books" / f"{rec['id']}.json"
        if book_file.exists():
            targets.append((rec, book_file))

    print(f"対象 {len(targets)} 冊", flush=True)
    grand_done = 0
    for bi, (rec, book_file) in enumerate(targets, 1):
        book = json.loads(book_file.read_text(encoding="utf-8"))
        # 前回エラーで空のまま「済み」になったページも、もう一度やり直す
        todo = [p for p in book["pages"]
                if len(p.get("t", "")) < MIN_CHARS and not (p.get("ocr") and p.get("t"))]
        if not todo:
            continue
        if MAX_PAGES_PER_BOOK:
            todo = todo[:MAX_PAGES_PER_BOOK]

        src = ROOT / rec["rel"]
        if not src.exists():
            print(f"[{bi}/{len(targets)}] 見つからない: {rec['rel']}", flush=True)
            continue

        print(f"[{bi}/{len(targets)}] {rec['folder']}/{rec['title']}  OCR {len(todo)}p …", flush=True)
        doc = pymupdf.open(src)
        by_no = {p["n"]: p for p in book["pages"]}
        done = 0
        for p in todo:
            try:
                pix = doc[p["n"] - 1].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM))
                text = clean(await ocr_png(pix.tobytes("png")))
                by_no[p["n"]]["t"] = text
                by_no[p["n"]]["ocr"] = True
            except Exception as e:
                print(f"    p{p['n']} 失敗: {e}", flush=True)
            done += 1
            if done % 25 == 0:
                book_file.write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")
                print(f"    {done}/{len(todo)}p", flush=True)
        doc.close()

        book["textPages"] = sum(1 for p in book["pages"] if len(p.get("t", "")) >= MIN_CHARS)
        book["chars"] = sum(len(p.get("t", "")) for p in book["pages"])
        book["status"] = "ok" if book["textPages"] else "no_text"
        book_file.write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")

        rec["textPages"], rec["chars"], rec["status"] = book["textPages"], book["chars"], book["status"]
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
        grand_done += done
        print(f"    → 文字ありページ {book['textPages']}/{len(book['pages'])}  総文字 {book['chars']:,}", flush=True)

    print(f"\n完了: {grand_done} ページをOCRしました")


if __name__ == "__main__":
    asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else ""))
