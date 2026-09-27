#!/usr/bin/env python3
"""Build Signal Board.

Inlines the map shapes into the page source and writes:
  artifact/signal-board.html  - the page as published as a Claude artifact
  index.html                  - the same page as a full HTML document for your own site (uses standalone.js)
Usage: python3 scripts/build.py
"""
import json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "src" / "signal-board.src.html").read_text()
world = json.dumps(json.loads((root / "src/geo/countries-110m.json").read_text()), separators=(",", ":"))
us = json.dumps(json.loads((root / "src/geo/states-albers-10m.json").read_text()), separators=(",", ":"))
assert "/*__WORLD__*/null" in src and "/*__US__*/null" in src, "map placeholders missing"
page = src.replace("/*__WORLD__*/null", world).replace("/*__US__*/null", us)

(root / "artifact").mkdir(exist_ok=True)
(root / "artifact" / "signal-board.html").write_text(page)

shell = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    "<style>:root{color-scheme:light}body{margin:0;font:14px/1.5 system-ui,sans-serif}"
    "img{max-width:100%}[hidden]{display:none!important}</style>"
    '<script src="/standalone.js"></script></head><body>'
)
(root / "index.html").write_text(shell + page + "</body></html>")
print("Built artifact/signal-board.html and index.html (%d KB)" % (len(page) // 1024))
