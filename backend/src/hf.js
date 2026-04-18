/**
 * Hugging Face Serverless Inference client.
 *
 * IMPORTANT (agent guardrail):
 *   - Every Gemma agent call MUST go through `callGemma`. Do not import the
 *     `@huggingface/inference` SDK from agents.js or routes directly.
 *   - All calls have a hard timeout and at most 1 retry (for the typical
 *     503 "model is loading" response).
 *   - On total failure, returns `{ ok: false, error, status }`. Callers
 *     decide whether to fall back to deterministic templates so the demo
 *     never crashes when HF is down or rate-limited.
 *   - Never log `HF_TOKEN`. Only log model + status.
 */

const { InferenceClient } = require("@huggingface/inference");

const HF_TOKEN = process.env.HF_TOKEN || "";
const HF_MODEL = process.env.HF_MODEL || "google/gemma-2-27b-it";
const HF_TIMEOUT_MS = parseInt(process.env.HF_TIMEOUT_MS || "60000", 10);
// Inference Providers routing. Default "hf-inference" pins to HF's own
// infrastructure instead of auto-routing to partner providers (Together,
// Fireworks, etc.) which usually require linked accounts/credits.
// Override via HF_PROVIDER if you want a specific partner.
const HF_PROVIDER = process.env.HF_PROVIDER || "hf-inference";

let _client = null;
function client() {
  if (!_client) {
    _client = new InferenceClient(HF_TOKEN || undefined);
  }
  return _client;
}

function isConfigured() {
  return !!HF_TOKEN;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Call the configured Gemma model with a chat-style messages array.
 *
 * @param {Array<{role: "system"|"user"|"assistant", content: string}>} messages
 * @param {{ model?: string, max_tokens?: number, temperature?: number }} opts
 * @returns {Promise<{ ok: boolean, text?: string, model?: string, error?: string, status?: number }>}
 */
async function callGemma(messages, opts = {}) {
  if (!isConfigured()) {
    return { ok: false, error: "HF_TOKEN not configured", status: 0 };
  }
  const model = opts.model || HF_MODEL;
  const max_tokens = opts.max_tokens || 1024;
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.2;

  const attempt = async () =>
    client().chatCompletion({
      model,
      provider: HF_PROVIDER,
      messages,
      max_tokens,
      temperature,
    });

  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const result = await withTimeout(attempt(), HF_TIMEOUT_MS, `HF chatCompletion (${model})`);
      const text = result?.choices?.[0]?.message?.content || "";
      return { ok: true, text, model };
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status || 0;
      // Retry once on 503 "model is loading" or transient network errors.
      const retryable = status === 503 || /loading|temporar|ETIMEDOUT|ECONN/i.test(err.message || "");
      if (i === 0 && retryable) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error(`[hf] call failed (${status || "no-status"}): ${err.message}`);
      return { ok: false, error: err.message, status, model };
    }
  }
  return { ok: false, error: lastErr?.message || "unknown", model };
}

module.exports = {
  HF_MODEL,
  HF_TIMEOUT_MS,
  isConfigured,
  callGemma,
};
