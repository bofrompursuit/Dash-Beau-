/*
 * Signal Board standalone runtime.
 *
 * Inside Claude, the page uses Claude's artifact runtime (window.claude) for
 * saving (db), file storage (assets) and AI (sample). On its own site there is
 * no such runtime, so this file provides the same calls:
 *   db      -> IndexedDB in this browser
 *   assets  -> file blobs in IndexedDB, shown through object URLs
 *   sample  -> POST /api/claude (a Vercel function that calls the Anthropic API)
 * It does nothing when the real runtime is present.
 */
(function () {
  if (window.claude) return;
  window.__standalone = true;

  /* ---------- IndexedDB ---------- */
  const DB_NAME = "signal-board", DB_VER = 1;
  let idbP = null;
  function idb() {
    return idbP ||= new Promise((ok, bad) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs", {keyPath: "path"});
        if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs", {keyPath: "id"});
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => bad(r.error);
    });
  }
  async function tx(store, mode, fn) {
    const d = await idb();
    return new Promise((ok, bad) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => ok(req && req.result);
      t.onerror = () => bad(t.error);
      t.onabort = () => bad(t.error);
    });
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");

  /* ---------- db ---------- */
  const cache = new Map();          // path -> data
  const listeners = new Map();      // collection path -> Set<fn>
  let dbReady = null;
  function loadDocs() {
    return dbReady ||= tx("docs", "readonly", s => s.getAll()).then(rows => { for (const r of rows || []) cache.set(r.path, r.data); }).then(seedOnce).catch(() => {});
  }
  // First visit in this browser: add the example dashboard once. A marker doc
  // records that it ran, so deleting the examples never brings them back.
  const SEED_MARK = "_meta/seed";
  async function seedOnce() {
    if (cache.has(SEED_MARK)) return;
    const hadData = [...cache.keys()].some(p => p.startsWith("boards/") || p.startsWith("cards/"));
    const mark = {seededAt: Date.now(), skipped: hadData};
    if (!hadData) {
      try {
        const r = await fetch("/examples/starter-board.json", {cache: "no-store"});
        if (!r.ok) return;
        const data = await r.json();
        const rows = [];
        for (const b of data.boards || []) { const {id, ...rest} = b; rows.push({path: "boards/" + id, data: rest}); }
        for (const c of data.cards || []) { const {id, ...rest} = c; rows.push({path: "cards/" + id, data: rest}); }
        await tx("docs", "readwrite", s => { for (const row of rows) s.put(row); });
        for (const row of rows) cache.set(row.path, row.data);
      } catch { return; }
    }
    cache.set(SEED_MARK, mark);
    await tx("docs", "readwrite", s => s.put({path: SEED_MARK, data: mark})).catch(() => {});
  }
  const split = path => { const parts = path.split("/"); return {col: parts.slice(0, -1).join("/"), id: parts[parts.length - 1]}; };
  const docSnap = (path) => { const data = cache.get(path); const {id} = split(path); return {id, exists: data !== undefined, data: () => data === undefined ? undefined : clone(data), metadata: {fromCache: false, hasPendingWrites: false}}; };
  function colSnap(col) {
    const docs = [];
    for (const path of cache.keys()) if (split(path).col === col) docs.push(docSnap(path));
    docs.sort((a, b) => a.id < b.id ? -1 : 1);
    return {docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {fromCache: false, hasPendingWrites: false}};
  }
  function notify(col) { const set = listeners.get(col); if (set) for (const fn of set) queueMicrotask(() => fn()); }
  function listen(col, fn) { if (!listeners.has(col)) listeners.set(col, new Set()); listeners.get(col).add(fn); return () => listeners.get(col).delete(fn); }
  function merge(a, b) { for (const [k, v] of Object.entries(b)) { if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) merge(a[k], v); else a[k] = v; } return a; }
  function docRef(path) {
    const {col, id} = split(path);
    return {
      id, path,
      async get() { await loadDocs(); return docSnap(path); },
      async set(data) { await loadDocs(); const d = clone(data); cache.set(path, d); await tx("docs", "readwrite", s => s.put({path, data: d})); notify(col); },
      async update(data) { await loadDocs(); if (!cache.has(path)) throw {code: "invalid_argument", message: "Document does not exist"}; const d = merge(clone(cache.get(path)), clone(data)); cache.set(path, d); await tx("docs", "readwrite", s => s.put({path, data: d})); notify(col); },
      async delete() { await loadDocs(); cache.delete(path); await tx("docs", "readwrite", s => s.delete(path)); notify(col); },
      onSnapshot(next) { let last; const fire = () => { const s = docSnap(path); next(s); }; loadDocs().then(fire); return listen(col, fire); },
      collection(sub) { return colRef(path + "/" + sub); }
    };
  }
  function colRef(path) {
    return {
      path,
      doc(id) { return docRef(path + "/" + (id || rid(10))); },
      async add(data) { const r = docRef(path + "/" + rid(10)); await r.set(data); return r; },
      async get() { await loadDocs(); return colSnap(path); },
      onSnapshot(next) { const fire = () => next(colSnap(path)); loadDocs().then(fire); return listen(path, fire); },
      where() { return this; }, orderBy() { return this; }, limit() { return this; }
    };
  }
  const db = Object.freeze({doc: docRef, collection: colRef});

  /* ---------- assets ---------- */
  const urls = new Map();
  let blobsReady = null;
  function loadBlobs() {
    return blobsReady ||= tx("blobs", "readonly", s => s.getAll()).then(rows => { for (const r of rows || []) urls.set(r.id, URL.createObjectURL(r.blob)); }).catch(() => {});
  }
  window.__assetUrl = id => urls.get(id) || null;
  const assets = Object.freeze({
    async upload(blob, opts) {
      if (!(blob instanceof Blob) || !blob.size) throw {code: "invalid_request", message: "Empty file"};
      const type = (opts && opts.type) || blob.type || "application/octet-stream";
      const stored = blob.type === type ? blob : new Blob([blob], {type});
      const id = rid(16);
      await tx("blobs", "readwrite", s => s.put({id, blob: stored, createdAt: Date.now()}));
      const url = URL.createObjectURL(stored); urls.set(id, url);
      return {id, url, sizeBytes: stored.size, contentType: type};
    },
    async list() { const rows = await tx("blobs", "readonly", s => s.getAll()); return {assets: (rows || []).map(r => ({id: r.id, url: urls.get(r.id), contentType: r.blob.type, sizeBytes: r.blob.size, createdAt: new Date(r.createdAt).toISOString()})), usage: {files: (rows || []).length, bytes: (rows || []).reduce((n, r) => n + r.blob.size, 0), maxFiles: Infinity, maxBytes: Infinity}}; },
    async delete(ref) { const id = String(ref).replace(/^.*\//, ""); await tx("blobs", "readwrite", s => s.delete(id)); const u = urls.get(id); if (u) URL.revokeObjectURL(u); urls.delete(id); return {deleted: true}; }
  });

  /* ---------- sample (Claude via /api/claude) ---------- */
  const API = "/api/claude";
  const PASS_KEY = "sb.passcode";
  const getPass = () => { try { return localStorage.getItem(PASS_KEY) || ""; } catch { return ""; } };
  const setPass = v => { try { localStorage.setItem(PASS_KEY, v); } catch {} };
  async function toJpegBase64(blob, maxSide = 1568) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL("image/jpeg", 0.82);
    return url.slice(url.indexOf(",") + 1);
  }
  async function prepImages(images) {
    if (!images) return [];
    const list = images instanceof Blob ? [images] : Array.from(images);
    const out = []; let total = 0;
    for (const b of list.slice(0, 8)) {
      try { const data = await toJpegBase64(b); if (total + data.length > 3.6e6) break; total += data.length; out.push({media_type: "image/jpeg", data}); }
      catch { throw {code: "image_rejected", message: "An image could not be read"}; }
    }
    return out;
  }
  async function call(input, opts, json) {
    opts = opts || {};
    const body = JSON.stringify({input, json, modelTier: opts.modelTier || "default", images: await prepImages(opts.images)});
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try { r = await fetch(API, {method: "POST", headers: {"content-type": "application/json", "x-app-passcode": getPass()}, body, signal: opts.signal}); }
      catch (e) { if (opts.signal && opts.signal.aborted) throw {code: "cancelled", message: "Cancelled"}; throw {code: "upstream_error", message: "Network error"}; }
      if (r.status === 401 && attempt === 0) {
        const p = window.prompt("Enter the passcode for this dashboard's Claude features:");
        if (!p) throw {code: "not_granted", message: "No passcode"};
        setPass(p.trim()); continue;
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const code = r.status === 402 ? "billing" : r.status === 401 ? "not_granted" : r.status === 429 ? "rate_limited" : r.status === 413 ? "prompt_too_large" : r.status === 503 ? "sampling_disabled" : "upstream_error";
        throw {code, message: data.error || ("HTTP " + r.status)};
      }
      if (!data.text || !String(data.text).trim()) throw {code: "empty_completion", message: "No answer"};
      return String(data.text);
    }
    throw {code: "not_granted", message: "Passcode rejected"};
  }
  function parseJson(text) {
    try { return JSON.parse(text); } catch {}
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { try { return JSON.parse(fence[1]); } catch {} }
    const a = text.search(/[\[{]/), b = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
    throw {code: "invalid_json", message: "The answer was not valid JSON", text};
  }
  async function sample(input, opts) {
    const text = await call(input, opts, false);
    if (opts && opts.onText) try { opts.onText({text, delta: text}); } catch {}
    return {text, truncated: false, modelTierApplied: (opts && opts.modelTier) || "default"};
  }
  sample.json = async (input, opts) => {
    const text = await call(input, opts, true);
    if (opts && opts.onText) try { opts.onText({text, delta: text}); } catch {}
    return parseJson(text);
  };
  sample.limits = async () => ({maxPromptBytes: 200000, images: {maxCount: 8, maxInputBytes: 20e6, mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"]}});

  let sampleAvail = null;
  function checkSample() {
    return sampleAvail ||= fetch(API, {method: "GET"}).then(r => r.ok ? r.json() : {available: false}).then(d => !!d.available).catch(() => false);
  }

  window.claude = Object.freeze({
    async use(name) {
      if (name === "db") { await loadDocs(); return db; }
      if (name === "assets") { await loadBlobs(); return assets; }
      if (name === "sample") return (await checkSample()) ? sample : null;
      return null;
    }
  });
})();
