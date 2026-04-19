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

// Flexible system - no longer requires specific columns
// The system will auto-detect the best columns to use for analysis
const SUGGESTED_INPUT_COLUMNS = ["age", "trt", "label"]; // For reference only

// Column type detection patterns
const COLUMN_PATTERNS = {
  age: /\b(age|years?|yrs?)\b/i,
  treatment: /\b(trt|treatment|arm|group|drug|therapy|intervention)\b/i,
  outcome: /\b(label|outcome|response|event|death|survival|dropout|adverse|status|result)\b/i,
  demographic: /\b(gender|sex|race|ethnicity|weight|height|bmi)\b/i,
  clinical: /\b(bp|pressure|cholesterol|glucose|creatinine|lab|test)\b/i,
  id: /\b(id|subject|patient|participant|number|#)\b/i
};

const REQUIRED_OUTPUT_KEYS = ["shap", "survival", "subgroups", "demographics", "efficacy", "data_cleaning"];

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
 * Analyzes CSV columns and suggests the best ones for clinical analysis.
 * Now works with any CSV structure - no required columns!
 */
function validateCsvColumns(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    
    if (lines.length < 2) {
      return {
        ok: false,
        errors: [{ code: "insufficient_data", message: "CSV must have at least a header and one data row." }],
        columns: [],
      };
    }
    
    const headerLine = lines[0].trim();
    if (!headerLine) {
      return {
        ok: false,
        errors: [{ code: "empty_header", message: "CSV header row is empty" }],
        columns: [],
      };
    }
    
    const columns = headerLine
      .split(",")
      .map((c) => c.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    
    // Auto-detect column types
    const detected = {
      age: columns.find(col => COLUMN_PATTERNS.age.test(col)),
      treatment: columns.find(col => COLUMN_PATTERNS.treatment.test(col)),
      outcome: columns.find(col => COLUMN_PATTERNS.outcome.test(col)),
      demographic: columns.filter(col => COLUMN_PATTERNS.demographic.test(col)),
      clinical: columns.filter(col => COLUMN_PATTERNS.clinical.test(col)),
      id: columns.find(col => COLUMN_PATTERNS.id.test(col))
    };
    
    // Get a sample of data to analyze column types
    const sampleRows = lines.slice(1, Math.min(6, lines.length)).map(line => 
      line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ""))
    );
    
    const columnAnalysis = columns.map((col, idx) => {
      const values = sampleRows.map(row => row[idx]).filter(v => v && v !== '');
      const numericValues = values.filter(v => !isNaN(parseFloat(v)));
      const uniqueValues = [...new Set(values)];
      
      return {
        name: col,
        index: idx,
        type: numericValues.length > values.length * 0.8 ? 'numeric' : 
              uniqueValues.length <= 10 ? 'categorical' : 'text',
        uniqueCount: uniqueValues.length,
        sampleValues: uniqueValues.slice(0, 5),
        hasNumerics: numericValues.length > 0
      };
    });
    
    return {
      ok: true, // Always OK - we work with any CSV!
      errors: [],
      columns,
      detected,
      columnAnalysis,
      suggestions: {
        message: "CSV successfully analyzed. The system will auto-select the best columns for clinical analysis.",
        totalColumns: columns.length,
        totalRows: lines.length - 1,
        detectedTypes: Object.entries(detected).filter(([_, v]) => v).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      }
    };
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
  validateUploadedCsv,
  validateCsvColumns,
  validateRRunOutput,
  SUGGESTED_INPUT_COLUMNS,
  REQUIRED_OUTPUT_KEYS,
  COLUMN_PATTERNS,
};
