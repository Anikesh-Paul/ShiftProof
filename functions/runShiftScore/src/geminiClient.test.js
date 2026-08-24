const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  geminiProvider,
  geminiRequestTarget,
  resolveGeminiAuth,
} = require("./geminiClient");

test("VERTEX_API_KEY selects vertex unless GEMINI_PROVIDER pins studio", () => {
  assert.equal(
    geminiProvider({
      VERTEX_API_KEY: "vertex-secret",
      GOOGLE_AI_API_KEY: "studio-secret",
    }),
    "vertex",
  );
  assert.equal(
    geminiProvider({
      GEMINI_PROVIDER: "studio",
      VERTEX_API_KEY: "vertex-secret",
      GOOGLE_AI_API_KEY: "studio-secret",
    }),
    "studio",
  );
});

test("unknown GEMINI_PROVIDER with no Vertex key is studio", () => {
  assert.equal(geminiProvider({ GEMINI_PROVIDER: "openai" }), "studio");
});

test("studio URL stays on generativelanguage and does not mention Vertex", () => {
  const t = geminiRequestTarget({
    model: "gemini-3.7-flash",
    env: {
      GEMINI_PROVIDER: "studio",
      GOOGLE_AI_API_KEY: "studio-secret",
      VERTEX_API_KEY: "vertex-secret",
    },
  });
  assert.equal(t.provider, "studio");
  assert.match(t.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.7-flash:generateContent\?key=/);
  assert.ok(!t.url.includes("aiplatform"));
  assert.equal(t.headers["Content-Type"], "application/json");
  assert.equal(t.headers["x-goog-api-key"], undefined);
});

test("vertex without project uses Agent Platform API-key URL", () => {
  const t = geminiRequestTarget({
    model: "gemini-3.7-flash",
    env: { GEMINI_PROVIDER: "vertex", VERTEX_API_KEY: "vertex-secret" },
  });
  assert.equal(t.provider, "vertex");
  assert.equal(
    t.url,
    "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.7-flash:generateContent?key=vertex-secret",
  );
  assert.equal(t.headers["x-goog-api-key"], "vertex-secret");
});

test("Vertex key without GEMINI_PROVIDER uses the project-scoped Vertex URL", () => {
  const t = geminiRequestTarget({
    model: "gemini-3.7-flash",
    env: {
      VERTEX_API_KEY: "vertex-secret",
      VERTEX_PROJECT_ID: "jammu-hackathon",
    },
  });
  assert.equal(t.provider, "vertex");
  assert.match(t.url, /aiplatform\.googleapis\.com\/v1\/projects\/jammu-hackathon/);
});

test("vertex with project uses project-scoped URL", () => {
  const t = geminiRequestTarget({
    model: "gemini-3.7-flash",
    env: {
      GEMINI_PROVIDER: "VERTEX",
      VERTEX_API_KEY: "vertex-secret",
      VERTEX_PROJECT_ID: "jammu-hackathon",
      VERTEX_LOCATION: "global",
    },
  });
  assert.equal(
    t.url,
    "https://aiplatform.googleapis.com/v1/projects/jammu-hackathon/locations/global/publishers/google/models/gemini-3.7-flash:generateContent?key=vertex-secret",
  );
});

test("vertex missing key throws; studio is not used as a silent fallback", () => {
  assert.throws(
    () =>
      geminiRequestTarget({
        model: "gemini-3.7-flash",
        env: {
          GEMINI_PROVIDER: "vertex",
          GOOGLE_AI_API_KEY: "studio-secret",
        },
      }),
    /VERTEX_API_KEY/,
  );
});

test("studio missing key still throws the existing error", () => {
  assert.throws(
    () =>
      geminiRequestTarget({
        model: "gemini-3.7-flash",
        env: {},
      }),
    /GOOGLE_AI_API_KEY/,
  );
});

test("resolveGeminiAuth uses Vertex when a Vertex key is present", () => {
  const { provider } = resolveGeminiAuth({
    GOOGLE_AI_API_KEY: "studio-secret",
    VERTEX_API_KEY: "vertex-secret",
    VERTEX_PROJECT_ID: "jammu-hackathon",
  });
  assert.equal(provider, "vertex");
});

test("no Vertex key keeps studio as the deployed-function default", () => {
  const { provider } = resolveGeminiAuth({
    GOOGLE_AI_API_KEY: "studio-secret",
  });
  assert.equal(provider, "studio");
});
