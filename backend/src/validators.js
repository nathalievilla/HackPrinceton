/**
 * Input/output validators.
 *
 * IMPORTANT (agent guardrail):
 *   - Required input columns MUST stay in sync with the frontend
 *     (hack-princeton/src/Dashboard.jsx REQUIRED_COLUMNS).
 *   - Required output keys are part of the API contract React renders against.
 *     If you add new keys, update AGENTS.md and the frontend renderer.
 *   - Validation must produce structured errors (not throw opaque strings) so
 *     React can show clear stage-level messages.
 */

const fs = require("fs");
const path = require("path");

<<<<<<< Updated upstream
const REQUIRED_OUTPUT_KEYS = ["shap", "survival", "subgroups", "demographics", "efficacy", "data_cleaning"];
=======
// Must match REQUIRED_COLUMNS in hack-princeton/src/Dashboard.jsx (lowercased).
const REQUIRED_INPUT_COLUMNS = ["age", "trt", "label"];
const REQUIRED_OUTPUT_KEYS = ["shap", "survival", "subgroups"];

>>>>>>> Stashed changes
function validateUploadedCsv(filePath) {
  const errors = [];
  if (!fs.existsSync(filePath)) {
    errors.push({ code: "missing_file", message: "uploaded file is missing on disk" });
    return { ok: false, errors };
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    errors.push({ code: "empty_file", message: "uploaded file is empty" });
  }
  if (path.extname(filePath).toLowerCase() !== ".csv") {
    errors.push({ code: "wrong_extension", message: "file must be a .csv" });
  }
  return { ok: errors.length === 0, errors, size_bytes: stat.size };
}

/**
 * Reads only the header line and confirms required columns exist
 * (case-insensitive). Returns structured errors so the frontend can
 * surface them verbatim.
 */
function validateCsvColumns(filePath, required = REQUIRED_INPUT_COLUMNS) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const firstLine = (raw.split(/\r?\n/, 1)[0] || "").trim();
    if (!firstLine) {
      return {
        ok: false,
        errors: [{ code: "empty_header", message: "CSV header row is empty" }],
        columns: [],
      };
    }
    const columns = firstLine
      .split(",")
      .map((c) => c.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    const lower = columns.map((c) => c.toLowerCase());
    const missing = required.filter((r) => !lower.includes(r));
    if (missing.length > 0) {
      return {
        ok: false,
        errors: missing.map((column) => ({
          code: "missing_column",
          column,
          message: `Required column "${column}" is missing.`,
        })),
        columns,
      };
    }
    return { ok: true, errors: [], columns };
  } catch (err) {
    return {
      ok: false,
      errors: [{ code: "read_error", message: err.message }],
      columns: [],
    };
  }
}

function validateRRunOutput(output) {
  const errors = [];
  if (!output || typeof output !== "object") {
    errors.push({ code: "not_object", message: "R output is not a JSON object" });
    return { ok: false, errors };
  }
  for (const key of REQUIRED_OUTPUT_KEYS) {
    if (!(key in output)) {
      errors.push({ code: "missing_key", key, message: `missing required key: ${key}` });
    }
  }
  if (output.shap && (!Array.isArray(output.shap.features) || !Array.isArray(output.shap.importance))) {
    errors.push({ code: "shap_shape", message: "shap.features and shap.importance must be arrays" });
  }
  if (output.survival && (!Array.isArray(output.survival.time_points) || typeof output.survival.curves !== "object")) {
    errors.push({ code: "survival_shape", message: "survival.time_points must be an array and survival.curves must be an object" });
  }
  if (output.subgroups && !Array.isArray(output.subgroups)) {
    errors.push({ code: "subgroups_shape", message: "subgroups must be an array" });
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  REQUIRED_INPUT_COLUMNS,
  REQUIRED_OUTPUT_KEYS,
  validateUploadedCsv,
  validateCsvColumns,
  validateRRunOutput,
};
