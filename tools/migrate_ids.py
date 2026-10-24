# -*- coding: utf-8 -*-
"""
教材IDを決まった値（md5）に付け替える。

以前の book_id は Python の hash() を使っていて、実行するたびに値が変わった。
そのままだと再抽出のたびに同じ教材が別IDになり、取り込み側で重複する。
すでに抽出済みのデータを作り直さずに済むよう、ファイル名と中身のIDだけを
新しい方式に書き換える。

OCRが走っている間は実行しないこと（同じファイルを書き合う）。
"""
import hashlib
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(r"C:\Users\user\Desktop\juken_app\textbook-data")
BOOKS = OUT / "books"


def new_id(rel: str) -> str:
    digest = hashlib.md5(rel.encode("utf-8")).hexdigest()[:10]
    return re.sub(r"[^0-9a-zA-Zぁ-んァ-ヶ一-龥]+", "_", rel)[:80] + "_" + digest


def main():
    index_path = OUT / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))

    renamed = missing = same = 0
    for rec in index["books"]:
        old = rec["id"]
        want = new_id(rec["rel"])
        if old == want:
            same += 1
            continue
        src = BOOKS / f"{old}.json"
        dst = BOOKS / f"{want}.json"
        if src.exists():
            book = json.loads(src.read_text(encoding="utf-8"))
            book["id"] = want
            dst.write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")
            src.unlink()
            renamed += 1
        else:
            missing += 1
        rec["id"] = want

    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    # 付け替え後に取り残されたファイルが無いか確認する
    valid = {b["id"] + ".json" for b in index["books"]}
    orphans = [f.name for f in BOOKS.glob("*.json") if f.name not in valid]

    print(f"付け替え {renamed}冊 / すでに新方式 {same}冊 / 本体が見つからない {missing}冊")
    print(f"孤児ファイル {len(orphans)}件" + ("： " + ", ".join(orphans[:5]) if orphans else ""))


if __name__ == "__main__":
    main()
