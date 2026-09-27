// Vercel serverless function: the Claude features of Signal Board.
// Set ANTHROPIC_API_KEY in the Vercel project's environment variables.
// Optional: ANTHROPIC_MODEL (default claude-sonnet-5), ANTHROPIC_MODEL_QUICK (default claude-haiku-4-5-20251001),
// APP_PASSCODE (when set, callers must send it, so strangers can't spend your API credit).

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MODEL_QUICK = process.env.ANTHROPIC_MODEL_QUICK || "claude-haiku-4-5-20251001";
const MAX_PROMPT = 200000;

module.exports = async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET") return res.status(200).json({available: !!key});
  if (req.method !== "POST") return res.status(405).json({error: "Use POST"});
  if (!key) return res.status(503).json({error: "ANTHROPIC_API_KEY is not set on the server"});
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers["x-app-passcode"] !== pass) return res.status(401).json({error: "Passcode required"});

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({error: "Bad JSON"}); } }
  const {input, json, images, modelTier} = body || {};
  if (!input || (typeof input !== "string" && !Array.isArray(input))) return res.status(400).json({error: "Missing input"});

  // Build messages: a prompt string, or page-kept turns ending on a user turn.
  let turns = typeof input === "string" ? [{role: "user", content: input}] : input.filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content);
  if (!turns.length || turns[turns.length - 1].role !== "user") return res.status(400).json({error: "Input must end on a user turn"});
  const size = turns.reduce((n, t) => n + t.content.length, 0);
  if (size > MAX_PROMPT) return res.status(413).json({error: "Prompt too large"});
  // merge consecutive same-role turns
  const merged = [];
  for (const t of turns) { const last = merged[merged.length - 1]; if (last && last.role === t.role) last.content += "\n\n" + t.content; else merged.push({...t}); }
  if (merged[0].role !== "user") merged.unshift({role: "user", content: "(conversation start)"});
  const lastTurn = merged[merged.length - 1];
  const imgs = Array.isArray(images) ? images.filter(i => i && typeof i.data === "string" && /^image\/(png|jpeg|webp|gif)$/.test(i.media_type)).slice(0, 8) : [];
  const text = lastTurn.content + (json ? "\n\nYour reply will be parsed by a program: reply with only the JSON value, no other text." : "");
  lastTurn.content = [...imgs.map(i => ({type: "image", source: {type: "base64", media_type: i.media_type, data: i.data}})), {type: "text", text}];

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
      body: JSON.stringify({model: modelTier === "quick" ? MODEL_QUICK : MODEL, max_tokens: 8000, messages: merged})
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const status = r.status === 429 || r.status === 529 ? 429 : r.status === 413 ? 413 : 502;
      return res.status(status).json({error: (data.error && data.error.message) || "Anthropic API error " + r.status});
    }
    const out = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    return res.status(200).json({text: out, stop_reason: data.stop_reason});
  } catch (e) {
    return res.status(502).json({error: "Could not reach the Anthropic API"});
  }
};
