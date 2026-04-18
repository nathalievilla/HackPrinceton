/**
 * Input/output validators.
 *
 * IMPORTANT (agent guardrail):
 *   - Required output keys are part of the API contract React renders against.
 *     If you add new keys, update AGENTS.md and the frontend renderer.
 *   - Validation must produce structured errors (not throw opaque strings) so
 *     React can show clear stage-level messages.
 */

const fs = require("fs");
const path = require("path");

const REQUIRED_OUTPUT_KEYS = ["shap", "survival", "subgroups", "demographics", "efficacy", "data_cleaning"];
function validateUploadedCsv(filePath) {
  const errors = [];
  if (!fs.existsSync(filePath)) {
    errors.push("uploaded file is missing on disk");
    return { ok: false, errors };
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) errors.push("uploaded file is empty");
  if (path.extname(filePath).toLowerCase() !== ".csv") {
    errors.push("file must be a .csv");
  }
  return { ok: errors.length === 0, errors, size_bytes: stat.size };
}

function validateRRunOutput(output) {
  const errors = [];
  if (!output || typeof output !== "object") {
    errors.push("R output is not a JSON object");
    return { ok: false, errors };
  }
  for (const key of REQUIRED_OUTPUT_KEYS) {
    if (!(key in output)) errors.push(`missing required key: ${key}`);
  }
  if (output.shap && (!Array.isArray(output.shap.features) || !Array.isArray(output.shap.importance))) {
    errors.push("shap.features and shap.importance must be arrays");
  }
  if (output.survival && (!Array.isArray(output.survival.time_points) || typeof output.survival.curves !== "object")) {
    errors.push("survival.time_points must be an array and survival.curves must be an object");
  }
  if (output.subgroups && !Array.isArray(output.subgroups)) {
    errors.push("subgroups must be an array");
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  REQUIRED_OUTPUT_KEYS,
  validateUploadedCsv,
  validateRRunOutput,
};
