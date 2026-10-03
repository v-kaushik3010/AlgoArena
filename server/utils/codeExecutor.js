/**
 * AlgoArena Code Executor
 *
 * Two-tier execution strategy (zero cost, no API key):
 *
 * TIER 1 — Wandbox API (https://wandbox.org)
 *   Free, no auth, supports Java/Python/JS/C++.
 *   Used as the primary engine so the server needs no compilers installed.
 *   Perfect for Render, Railway, Fly.io, or any Node.js hosting.
 *
 * TIER 2 — Local child_process.spawn (fallback)
 *   Kicks in if Wandbox is unreachable (e.g. offline dev, network blip).
 *   Requires the runtime to be installed on the host machine.
 */

const axios  = require("axios");
const { spawn } = require("child_process");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

// ─── Wandbox config ───────────────────────────────────────────────────────────
// https://wandbox.org/api/list.json shows all available compilers

const WANDBOX_URL = "https://wandbox.org/api/compile.json";

const WANDBOX_COMPILERS = {
  javascript: "nodejs-20.17.0",
  js:         "nodejs-20.17.0",
  python:     "cpython-3.14.0",
  python3:    "cpython-3.14.0",
  java:       "openjdk-jdk-22+36",
  cpp:        "gcc-head",
};

// ─── Wandbox runner ───────────────────────────────────────────────────────────

async function runViaWandbox(language, code, input, timeLimitSeconds) {
  const compiler = WANDBOX_COMPILERS[language.toLowerCase()];
  if (!compiler) {
    return {
      output: null,
      error: `Unsupported language: "${language}". Supported: javascript, python, java, cpp.`,
      executionTime: 0, memoryUsed: 0, verdict: "Runtime Error",
    };
  }

  const start = Date.now();

  // Wandbox saves Java as "prog.java" — `public class Main` would fail.
  // Removing `public` is safe: non-public classes have no filename constraint.
  let execCode = code;
  if (language === "java") {
    execCode = code.replace(/public\s+class\s+Main/, "class Main");
  }

  const response = await axios.post(
    WANDBOX_URL,
    {
      code: execCode,
      compiler,
      stdin: input || "",
      "compiler-option-raw": "",
      "runtime-option-raw":  "",
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: (timeLimitSeconds + 20) * 1000,
    }
  );

  const d = response.data;
  const elapsedMs = Date.now() - start;

  // ── Compilation error (Java / C++) ─────────────────────────────────────────
  if (d.compiler_error && d.compiler_error.trim()) {
    return {
      output: null,
      error: d.compiler_error.trim(),
      executionTime: elapsedMs / 1000, memoryUsed: 0, verdict: null,
    };
  }

  // ── Signal-killed (TLE / MLE / OOM) ───────────────────────────────────────
  if (d.signal) {
    return {
      output: null,
      error: "Time Limit Exceeded",
      executionTime: timeLimitSeconds, memoryUsed: 0, verdict: "Time Limit Exceeded",
    };
  }

  // ── Runtime error (non-zero exit + stderr) ────────────────────────────────
  const exitCode = parseInt(d.status, 10);
  if (exitCode !== 0 && d.program_error && d.program_error.trim()) {
    return {
      output: null,
      error: d.program_error.trim(),
      executionTime: elapsedMs / 1000, memoryUsed: 0, verdict: null,
    };
  }

  // ── Success ───────────────────────────────────────────────────────────────
  return {
    output: d.program_output || "",
    error:  d.program_error  || null,
    executionTime: elapsedMs / 1000,
    memoryUsed: 0,
    verdict: null,
  };
}

// ─── Local subprocess fallback ────────────────────────────────────────────────

function writeTempFile(content, ext) {
  const fp = path.join(os.tmpdir(), `algoarena_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(fp, content, "utf8");
  return fp;
}

function safeDelete(fp) { try { fs.unlinkSync(fp); } catch (_) {} }

function runProcess(cmd, args, stdin, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = "", stderr = "", timedOut = false;

    const child = spawn(cmd, args, { env: process.env, shell: false });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut, elapsedMs: Date.now() - start });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout: "", stderr: err.message, exitCode: -1, timedOut: false, elapsedMs: Date.now() - start });
    });
  });
}

async function runLocalFallback(language, code, input, timeLimitSeconds) {
  const ms  = timeLimitSeconds * 1000;
  const lang = language.toLowerCase();
  let raw;

  if (lang === "javascript" || lang === "js") {
    const fp = writeTempFile(code, ".js");
    try   { raw = await runProcess("node", [fp], input, ms); }
    finally { safeDelete(fp); }

  } else if (lang === "python" || lang === "python3") {
    const fp = writeTempFile(code, ".py");
    try {
      // Try python3 first (Linux/Render), fall back to python (Windows)
      raw = await runProcess("python3", ["-u", fp], input, ms);
      // On Windows: python3 may open MS Store (non-zero exit, no ENOENT)
      const isNotFound = raw.exitCode === -1 ||
        (raw.exitCode !== 0 && (raw.stderr.includes("ENOENT") || raw.stderr.includes("Python was not found")));
      if (isNotFound) {
        raw = await runProcess("python", ["-u", fp], input, ms);
      }
    } finally { safeDelete(fp); }

  } else if (lang === "java") {
    const subDir = path.join(os.tmpdir(), `algoarena_java_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(subDir, { recursive: true });
    const javaFile = path.join(subDir, "Main.java");
    fs.writeFileSync(javaFile, code, "utf8");
    try {
      const compile = await runProcess("javac", [javaFile], "", 10_000);
      if (compile.exitCode !== 0 || compile.timedOut) {
        return {
          output: null,
          error: compile.timedOut ? "Compilation timed out" : compile.stderr,
          executionTime: compile.elapsedMs / 1000, memoryUsed: 0, verdict: null,
        };
      }
      raw = await runProcess("java", ["-cp", subDir, "Main"], input, ms);
    } finally {
      try { fs.rmSync(subDir, { recursive: true, force: true }); } catch (_) {}
    }

  } else {
    return {
      output: null,
      error: `Unsupported language: "${language}"`,
      executionTime: 0, memoryUsed: 0, verdict: "Runtime Error",
    };
  }

  if (raw.timedOut) {
    return { output: null, error: "Time Limit Exceeded", executionTime: timeLimitSeconds, memoryUsed: 0, verdict: "Time Limit Exceeded" };
  }
  if (raw.exitCode !== 0 && raw.stderr) {
    return { output: null, error: raw.stderr.trim(), executionTime: raw.elapsedMs / 1000, memoryUsed: 0, verdict: null };
  }
  return { output: raw.stdout, error: raw.stderr || null, executionTime: raw.elapsedMs / 1000, memoryUsed: 0, verdict: null };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Execute user code against a single test-case input.
 *
 * @param {string} language           "javascript" | "python" | "java" | "cpp"
 * @param {string} code               user's source code
 * @param {string} input              test-case stdin
 * @param {number} [timeLimitSeconds=2]
 *
 * @returns {Promise<{ output, error, executionTime, memoryUsed, verdict }>}
 */
const executeCode = async (language, code, input, timeLimitSeconds = 2) => {
  const lang = language.toLowerCase();

  // ── Tier 1: Wandbox (works on any server, no host compilers needed) ────────
  try {
    console.log(`[Judge] Wandbox → ${lang}`);
    const result = await runViaWandbox(lang, code, input, timeLimitSeconds);
    console.log(`[Judge] Wandbox ok — verdict=${result.verdict} out="${result.output?.slice(0, 40)}"`);
    return result;
  } catch (wandboxErr) {
    console.warn(`[Judge] Wandbox unavailable (${wandboxErr.message}), falling back to local...`);
  }

  // ── Tier 2: Local subprocess (dev machines / Render with compilers) ────────
  try {
    console.log(`[Judge] Local subprocess → ${lang}`);
    const result = await runLocalFallback(lang, code, input, timeLimitSeconds);
    console.log(`[Judge] Local ok — verdict=${result.verdict} out="${result.output?.slice(0, 40)}"`);
    return result;
  } catch (localErr) {
    console.error(`[Judge] Both tiers failed: ${localErr.message}`);
    return {
      output: null,
      error: "Execution service temporarily unavailable. Please try again.",
      executionTime: 0, memoryUsed: 0, verdict: "Runtime Error",
    };
  }
};

module.exports = executeCode;