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
index.html                  Built page as a full HTML document for your own site
standalone.js               Browser storage + /api/claude in place of the Claude runtime
api/claude.js               Vercel function that calls the Anthropic API
vercel.json                 Vercel settings
examples/starter-board.json Example dashboard used to seed the starter board (made-up figures)
```

Build after editing the source:

```
python3 scripts/build.py
```

## Libraries (loaded from cdnjs)

d3 7.9.0 · topojson 3.0.2 · pdf.js 3.11.174 · mammoth 1.6.0 · SheetJS xlsx 0.18.5 (the last three load only when a matching file is attached).

## Running it

**On Vercel (your own site).** This repo deploys as-is: `index.html` is the app, `standalone.js` stands in for the Claude runtime, and `api/claude.js` is a serverless function for the Claude features.

- Dashboards, cards and uploaded files are saved in the browser you use (IndexedDB). They stay on that device and browser; clearing site data removes them.
- The Claude features ("Read with Claude", "Brief me") need an Anthropic API key. In the Vercel project, open Settings → Environment Variables and add:
  - `ANTHROPIC_API_KEY` (required for Claude features)
  - `APP_PASSCODE` (recommended: without it, anyone with the link can use your API credit; the site asks for the passcode once per browser)
  - `ANTHROPIC_MODEL` (optional, default `claude-sonnet-5`)
  Then redeploy. Without a key the app works fully except the Claude buttons are hidden.

**As a Claude artifact.** `artifact/signal-board.html` is published with the capabilities `db`, `assets` and `sample`; Claude's runtime then provides shared saving, file storage and Claude calls, and `standalone.js` is not used.

**Locally.** `python3 -m http.server` in this folder and open http://localhost:8000 (Claude features need `vercel dev` and a key).

## Data model

- `boards/{id}` – `{name, order, createdAt, brief?}`
- `cards/{id}` – `{boardId, title, kind, unit, span, order, raw, items[], points[], stat?, scope?, note?, insight?, sources[], attachments[], links[], fromClaude?}`
  - `attachments[]` – `{aid, name, kind, size, summary, text, assetId?}`; the original file is served from `/_blob/{assetId}`.
