/**
 * Gemini generateContent target.
 * Vertex when VERTEX_API_KEY is set (or GEMINI_PROVIDER=vertex).
 * GEMINI_PROVIDER=studio pins AI Studio even if a Vertex key is present.
 * Deployed Function without VERTEX_API_KEY stays on AI Studio until vars are set.
 */
function geminiProvider(env) {
  const e = env || process.env;
  const raw = String(e.GEMINI_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (raw === "vertex" || raw === "studio") return raw;
  if (String(e.VERTEX_API_KEY || "").trim()) return "vertex";
  return "studio";
}

function geminiRequestTarget({ model, env } = {}) {
  const e = env || process.env;
  const provider = geminiProvider(e);
  if (provider === "vertex") {
    const apiKey = String(e.VERTEX_API_KEY || "").trim();
    if (!apiKey) {
      throw new Error(
        "VERTEX_API_KEY not set (Agent Platform / Vertex key required)",
      );
    }
    const project = String(
      e.VERTEX_PROJECT_ID || e.GOOGLE_CLOUD_PROJECT || "",
    ).trim();
    const location =
      String(e.VERTEX_LOCATION || e.GOOGLE_CLOUD_LOCATION || "global").trim() ||
      "global";
    const host =
      location === "global"
        ? "https://aiplatform.googleapis.com"
        : `https://${encodeURIComponent(location)}-aiplatform.googleapis.com`;
    const path = project
      ? `/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`
      : `/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    return {
      provider,
      url: `${host}${path}?key=${encodeURIComponent(apiKey)}`,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
    };
  }

  const apiKey = String(e.GOOGLE_AI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error(
      "GOOGLE_AI_API_KEY not set on Function (Google AI Studio key required)",
    );
  }
  return {
    provider: "studio",
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    headers: { "Content-Type": "application/json" },
  };
}

function resolveGeminiAuth(env) {
  geminiRequestTarget({ model: "gemini-3.7-flash", env: env || process.env });
  return { provider: geminiProvider(env || process.env) };
}

module.exports = {
  geminiProvider,
  geminiRequestTarget,
  resolveGeminiAuth,
};
