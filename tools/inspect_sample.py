# -*- coding: utf-8 -*-
"""怪しい教材の本文を目視確認するための一時スクリプト。"""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
OUT = Path(r"C:\Users\user\Desktop\juken_app\textbook-data")

WANT = [("ロ", "."), ("世紀", "学校/世界史"), ("国語", "模試/全統/高二7月"), ("英語", "模試/全統/高二7月")]

index = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
for rec in index["books"]:
    if (rec["title"], rec["folder"]) not in WANT:
        continue
    f = OUT / "books" / f"{rec['id']}.json"
    if not f.exists():
        continue
    book = json.loads(f.read_text(encoding="utf-8"))
    pages = [p for p in book["pages"] if len(p.get("t", "")) >= 20]
    if not pages:
        print(f"=== {rec['folder']}/{rec['title']} : 本文ありページなし ===\n")
        continue
    avg = rec["chars"] // max(1, len(pages))
    mid = pages[len(pages) // 2]
    print(f"=== {rec['folder']}/{rec['title']}  {len(pages)}p 平均{avg}字 ===")
    print(repr(mid["t"][:280]))
    print()
