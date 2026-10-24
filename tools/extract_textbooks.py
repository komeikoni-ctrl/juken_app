# -*- coding: utf-8 -*-
"""
教材PDF（塾テキスト・参考書・教科書など）から本文テキストを抽出する。

Goodnotes の自動バックアップ（Google Drive）にある PDF を読み、
ページ単位のテキストを JSON にまとめる。ここでは API を一切使わない。
文字層を持たないスキャンPDFは text が空になるので、別途 OCR にかける
（ocr_textbooks.py）。

出力先は juken_app/textbook-data/（public/ の外）。
public/ に置くと firebase deploy で公開URLに載ってしまうため。
"""
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"G:\マイドライブ\GoodNotes")
OUT = Path(r"C:\Users\user\Desktop\juken_app\textbook-data")

# 教材の判定。
# 当初はファイル名に「テキスト」等が含まれるものだけを拾っていたが、
# 「学校/テキスト/家庭科.pdf」のように“フォルダ名がテキストで、ファイル名は科目名”
# という置き方が多く、101冊・2.8GBを取りこぼしていた。
# そこで「手書きノートを除いた全部」を教材として扱う方式に変える。
EXCLUDE_NAME = re.compile(r"^(ノート|名称未設定)")
EXCLUDE_DIR = re.compile(r"(^|/)(ノート|予習)/")
# これより大きいものは読み込みに時間とメモリがかかりすぎるので後回し
MAX_BYTES = 400 * 1024 * 1024

SUBJECT_HINTS = [
    ("世界史", "世界史"), ("日本史", "日本史"), ("地理", "地理"),
    ("現代文", "国語"), ("古文", "国語"), ("漢文", "国語"), ("国語", "国語"), ("論表", "国語"),
    ("英語", "英語"), ("英作", "英語"), ("英文", "英語"), ("リンケージ", "英語"),
    ("イディオム", "英語"), ("upgrade", "英語"), ("長文", "英語"), ("キートレーニング", "英語"),
    ("数学", "数学"), ("数字", "数学"),
    ("物理", "物理"), ("化学", "化学"), ("生物", "生物"),
    ("公共", "公共"), ("政治", "政治経済"), ("経済", "政治経済"), ("情報", "情報"),
    ("保健", "保健"), ("家庭", "家庭科"),
]


def guess_subject(parts: str) -> str:
    low = parts.lower()
    for key, subj in SUBJECT_HINTS:
        if key.lower() in low:
            return subj
    return "その他"


def clean(text: str) -> str:
    """PDFのテキストは改行と空白が暴れるので、検索とAI送信に耐える形に整える。"""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u3000", " ")
    # 1文字ずつ改行されている縦書きPDF対策：単独文字の行が続く場合は連結する
    lines = [ln.strip() for ln in text.splitlines()]
    out, buf = [], []
    for ln in lines:
        if len(ln) == 1:
            buf.append(ln)
            continue
        if buf:
            out.append("".join(buf))
            buf = []
        if ln:
            out.append(ln)
    if buf:
        out.append("".join(buf))
    joined = "\n".join(out)
    joined = re.sub(r"[ \t]{2,}", " ", joined)
    joined = re.sub(r"\n{3,}", "\n\n", joined)
    return joined.strip()


def book_id(path: Path) -> str:
    """教材のID。同じファイルなら毎回必ず同じIDになること。

    以前は Python の hash() を使っていたが、これは実行ごとに値が変わる
    （ハッシュのランダム化）。再抽出のたびに同じ教材が別IDになり、
    取り込み側で重複する事故になるので md5 に変えた。
    """
    rel = path.relative_to(ROOT).as_posix()
    digest = hashlib.md5(rel.encode("utf-8")).hexdigest()[:10]
    return re.sub(r"[^0-9a-zA-Zぁ-んァ-ヶ一-龥]+", "_", rel)[:80] + "_" + digest


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "books").mkdir(exist_ok=True)

    cands = []
    for p in ROOT.rglob("*.pdf"):
        rel = p.relative_to(ROOT).as_posix()
        if EXCLUDE_NAME.search(p.stem) or EXCLUDE_DIR.search(rel):
            continue
        cands.append(p)
    cands.sort(key=lambda p: p.as_posix())
    print(f"対象 {len(cands)} 件", flush=True)

    # 前回の結果を引き継ぐ（抽出済みのものは読み直さない＝Driveからの再ダウンロードを避ける）
    done = {}
    if (OUT / "index.json").exists():
        try:
            for rec in json.loads((OUT / "index.json").read_text(encoding="utf-8"))["books"]:
                if (OUT / "books" / f"{rec['id']}.json").exists():
                    done[rec["rel"]] = rec
        except Exception as e:
            print(f"前回のindexを読めませんでした（最初からやり直します）: {e}", flush=True)

    index = []
    for i, path in enumerate(cands, 1):
        rel_done = path.relative_to(ROOT).as_posix()
        if rel_done in done:
            index.append(done[rel_done])
            continue
        try:
            size = path.stat().st_size
        except OSError as e:
            print(f"  ! {path.name}: {e}", flush=True)
            continue

        rel = path.relative_to(ROOT).as_posix()
        bid = book_id(path)
        title = path.stem
        folder = str(path.parent.relative_to(ROOT).as_posix())
        subject = guess_subject(folder + "/" + title)

        if size > MAX_BYTES:
            print(f"[{i}/{len(cands)}] skip(大) {rel} {size/1024/1024:.0f}MB", flush=True)
            index.append({"id": bid, "title": title, "folder": folder, "subject": subject,
                          "rel": rel, "mb": round(size / 1024 / 1024, 1),
                          "pages": 0, "textPages": 0, "chars": 0, "status": "skipped_large"})
            continue

        try:
            doc = pymupdf.open(path)
        except Exception as e:
            print(f"[{i}/{len(cands)}] NG {rel}: {e}", flush=True)
            index.append({"id": bid, "title": title, "folder": folder, "subject": subject,
                          "rel": rel, "mb": round(size / 1024 / 1024, 1),
                          "pages": 0, "textPages": 0, "chars": 0, "status": "open_failed"})
            continue

        pages, chars, text_pages = [], 0, 0
        for n in range(doc.page_count):
            try:
                raw = doc[n].get_text("text")
            except Exception:
                raw = ""
            t = clean(raw)
            if len(t) >= 20:
                text_pages += 1
            chars += len(t)
            pages.append({"n": n + 1, "t": t})
        doc.close()

        status = "ok" if text_pages else "needs_ocr"
        rec = {"id": bid, "title": title, "folder": folder, "subject": subject, "rel": rel,
               "mb": round(size / 1024 / 1024, 1), "pages": len(pages),
               "textPages": text_pages, "chars": chars, "status": status}
        index.append(rec)

        with open(OUT / "books" / f"{bid}.json", "w", encoding="utf-8") as f:
            json.dump({**rec, "pages": pages}, f, ensure_ascii=False)

        print(f"[{i}/{len(cands)}] {status:9} {rel}  {len(pages)}p  文字{chars}  文字ありページ{text_pages}", flush=True)

    with open(OUT / "index.json", "w", encoding="utf-8") as f:
        json.dump({"builtAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                   "books": index}, f, ensure_ascii=False, indent=1)

    ok = sum(1 for b in index if b["status"] == "ok")
    ocr = sum(1 for b in index if b["status"] == "needs_ocr")
    print(f"\n完了: 文字層あり {ok} 冊 / OCR必要 {ocr} 冊 / 合計 {len(index)} 冊")
    print(f"総文字数 {sum(b['chars'] for b in index):,}")


if __name__ == "__main__":
    main()
