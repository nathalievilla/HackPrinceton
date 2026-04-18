/**
 * Node -> R execution adapter.
 *
 * IMPORTANT (agent guardrail):
 *   - Every R execution MUST go through `runRScript` so timeout, sandbox dir,
 *     and output capture rules apply uniformly.
 *   - Generated R code is written under the per-job runtime dir; never run R
 *     code from arbitrary paths or via shell strings.
 *   - The adapter falls back to a synthetic result when R is unavailable or
 *     USE_R=false, so the React demo keeps working without R installed.
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const R_TIMEOUT_MS = parseInt(process.env.R_TIMEOUT_MS || "60000", 10);

function detectRRuntime() {
  if (process.env.USE_R === "false") {
    return { available: false, reason: "USE_R=false" };
  }
  try {
    const result = spawnSync("Rscript", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.error) {
      return { available: false, reason: result.error.message };
    }
    const version =
      (result.stderr && result.stderr.trim()) ||
      (result.stdout && result.stdout.trim()) ||
      "unknown";
    return { available: result.status === 0, version };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/**
 * Spawn Rscript on `scriptPath` with the given args. Captures stdout/stderr
 * and enforces a hard timeout. Returns a structured result that callers can
 * use for retry decisions.
 */
function runRScript(scriptPath, args = [], { cwd, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("Rscript", [scriptPath, ...args], {
      cwd: cwd || path.dirname(scriptPath),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch (_) {
        /* ignore */
      }
    }, timeoutMs || R_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exit_code: null,
        runtime_ms: Date.now() - start,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        timed_out: false,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exit_code: code,
        runtime_ms: Date.now() - start,
        stdout,
        stderr,
        timed_out: timedOut,
        error: timedOut ? "r_timeout" : code === 0 ? null : "r_nonzero_exit",
      });
    });
  });
}

/**
 * Convenience: write `rCode` to <jobDir>/analyze.R and execute it with
 * (csvPath, outputJsonPath) as arguments. Reads the JSON the script writes
 * and returns it together with execution metadata.
 */
async function runGeneratedRScript({ jobDir, rCode, csvPath }) {
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, "analyze.R");
  const outputPath = path.join(jobDir, "output.json");
  fs.writeFileSync(scriptPath, rCode, "utf8");

  const exec = await runRScript(scriptPath, [csvPath, outputPath]);

  let parsed = null;
  let parseError = null;
  if (exec.ok && fs.existsSync(outputPath)) {
    try {
      parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } catch (err) {
      parseError = err.message;
    }
  }

  return {
    script_path: scriptPath,
    output_path: outputPath,
    output: parsed,
    parse_error: parseError,
    execution: {
      ok: exec.ok,
      exit_code: exec.exit_code,
      runtime_ms: exec.runtime_ms,
      timed_out: exec.timed_out,
      error: exec.error,
      stdout_tail: tail(exec.stdout, 4000),
      stderr_tail: tail(exec.stderr, 4000),
    },
  };
}

function tail(str, n) {
  if (!str) return "";
  return str.length <= n ? str : str.slice(-n);
}

module.exports = {
  detectRRuntime,
  runRScript,
  runGeneratedRScript,
};
