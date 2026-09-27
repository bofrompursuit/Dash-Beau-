# Signal Board

A dashboard maker. Create dashboards, then add cards by pasting data, attaching files, or adding links. Each card becomes a headline number, pie, bar or trend chart, table, notes, a file gallery, or a world / US map. Claude can read the material and pull out the figures for you.

## What it does

- **Dashboards and cards** – several dashboards, each with a grid of cards in three sizes (small, medium, full width). Cards can be edited, reordered, duplicated and deleted.
- **Paste anything** – CSV or spreadsheet copies, `Label: value` lines, research notes, links. The parser detects tables, units ($, €, £, %), time series and place names and picks a chart.
- **Attach files** – PDF, Word (.docx), Excel (.xlsx/.xls/.ods), CSV, text, SVG and images. Screenshots can be pasted straight in, or dropped anywhere on a dashboard.
  - Spreadsheets and CSVs become chart data immediately.
  - PDF and Word text is extracted in the browser; scanned PDFs are captured as page images.
- **Read with Claude** – sends the pasted text, extracted document text and images to Claude, which returns the card: chart type, values (including values read off chart or table screenshots), a takeaway and sources. It only uses figures present in the material.
- **Brief me** – Claude summarises what stands out across a whole dashboard.
- **Maps** – countries or US states (names or two-letter codes) shade a choropleth; `lat`/`lon` columns plot points.
- Light and dark themes, keyboard focus states, works at phone width.

## Project layout

```
src/signal-board.src.html   Page source (HTML, CSS, JS). Map data is inlined at build time.
src/geo/                    Map shapes: world-atlas countries-110m, us-atlas states-albers-10m (ISC licence)
scripts/build.py            Inlines the map shapes and writes the two built files below
artifact/signal-board.html  Built page as published as a Claude artifact
index.html                  Built page wrapped as a full HTML document for static hosting
examples/starter-board.json Example dashboard used to seed the starter board (made-up figures)
```

Build after editing the source:

```
python3 scripts/build.py
```

## Libraries (loaded from cdnjs)

d3 7.9.0 · topojson 3.0.2 · pdf.js 3.11.174 · mammoth 1.6.0 · SheetJS xlsx 0.18.5 (the last three load only when a matching file is attached).

## Running it

**As a Claude artifact (full features).** Saving, file storage and the Claude features use the Claude artifact runtime (`window.claude`): the `db` capability stores dashboards and cards, `assets` stores uploaded files, and `sample` calls Claude. Publish `artifact/signal-board.html` with the capabilities `db`, `assets` and `sample`.

**As a static site (preview mode).** `index.html` runs on any static host (GitHub Pages, Vercel, Netlify) or straight from disk. Outside Claude there is no `window.claude`, so it opens in preview mode: charts, maps, pasting and file reading all work, but nothing is saved and the Claude buttons are hidden. A standalone deployment needs a storage backend and an AI API in place of the `db`, `assets` and `sample` calls; these are isolated in the `Data` object, the upload step in the card editor's save handler, and the `S.sample` calls.

## Data model

- `boards/{id}` – `{name, order, createdAt, brief?}`
- `cards/{id}` – `{boardId, title, kind, unit, span, order, raw, items[], points[], stat?, scope?, note?, insight?, sources[], attachments[], links[], fromClaude?}`
  - `attachments[]` – `{aid, name, kind, size, summary, text, assetId?}`; the original file is served from `/_blob/{assetId}`.
