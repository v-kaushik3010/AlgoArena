/**
 * AlgoArena Code Executor — Free, self-hosted judge
 *
 * Runs user code in isolated child processes (child_process.spawn).
 * Works on any machine that has the runtime installed:
 *   - JavaScript → Node.js (always available — this IS the server runtime)
 *   - Python     → python3 (pre-installed on Render's Ubuntu image)
 *   - Java       → javac + java (installed via render.yaml build command)
 *
 * Each test case:
 *   1. Source is written to a temp file
 *   2. Process is spawned, test input piped to stdin
 *   3. Hard wall-clock timeout enforced (SIGKILL)
 *   4. stdout compared to expected output by the submission controller
 *
 * Security note: User code runs directly on the server process.
 * Acceptable for personal / educational projects. Add Docker sandboxing
 * for a public-facing platform with untrusted users.
 */

const { spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeTempFile(content, extension) {
  const name = `algoarena_${Date.now()}_${Math.random().toString(36).slice(2)}${extension}`;
  const fp   = path.join(os.tmpdir(), name);
  fs.writeFileSync(fp, content, "utf8");
  return fp;
}

function safeDelete(fp) {
  try { fs.unlinkSync(fp); } catch (_) {}
}

/**
 * Spawn a process, pipe stdin, collect stdout/stderr, enforce a hard timeout.
 */
function runProcess(cmd, args, stdin, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = "", stderr = "", timedOut = false;

    const child = spawn(cmd, args, { env: process.env, shell: false });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

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

// ─── Language runners ─────────────────────────────────────────────────────────

async function runJavaScript(code, input, timeoutMs) {
  const fp = writeTempFile(code, ".js");
  try {
    return await runProcess("node", [fp], input, timeoutMs);
  } finally {
    safeDelete(fp);
  }
}

async function runPython(code, input, timeoutMs) {
  const fp = writeTempFile(code, ".py");
  try {
    // -u = unbuffered I/O (no lost output on crash)
    // Try "python3" first (Linux/Render), fall back to "python" (Windows/some Linux)
    let result = await runProcess("python3", ["-u", fp], input, timeoutMs);
    if (result.exitCode === -1 && result.stderr.includes("ENOENT")) {
      result = await runProcess("python", ["-u", fp], input, timeoutMs);
    }
    return result;
  } finally {
    safeDelete(fp);
  }
}

/**
 * Java: compile with javac, then run.
 * Submission MUST declare `public class Main` (competitive programming convention).
 */
async function runJava(code, input, timeoutMs) {
  const subDir = path.join(
    os.tmpdir(),
    `algoarena_java_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(subDir, { recursive: true });
  const javaFile = path.join(subDir, "Main.java");
  fs.writeFileSync(javaFile, code, "utf8");

  try {
    // Compile (10 s hard limit)
    const compile = await runProcess("javac", [javaFile], "", 10_000);
    if (compile.exitCode !== 0 || compile.timedOut) {
      return {
        stdout: "",
        stderr: compile.timedOut ? "Compilation timed out" : compile.stderr,
        exitCode: compile.exitCode,
        timedOut: compile.timedOut,
        elapsedMs: compile.elapsedMs,
      };
    }
    // Run
    return await runProcess("java", ["-cp", subDir, "Main"], input, timeoutMs);
  } finally {
    try { fs.rmSync(subDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Execute user code against a single test case.
 *
 * @param {string} language           "javascript" | "python" | "java"
 * @param {string} code               user's source code
 * @param {string} input              test-case input piped to stdin
 * @param {number} [timeLimitSeconds=2]
 *
 * @returns {Promise<{
 *   output: string|null,
 *   error:  string|null,
 *   executionTime: number,    // seconds
 *   memoryUsed: number,       // 0 (tracking is non-trivial cross-platform)
 *   verdict: string|null,     // "Time Limit Exceeded" | "Runtime Error" | null
 * }>}
 */
const executeCode = async (language, code, input, timeLimitSeconds = 2) => {
  const timeoutMs = timeLimitSeconds * 1000;
  const lang      = language.toLowerCase();
  let raw;

  try {
    if      (lang === "javascript" || lang === "js")      raw = await runJavaScript(code, input, timeoutMs);
    else if (lang === "python"     || lang === "python3") raw = await runPython(code, input, timeoutMs);
    else if (lang === "java")                             raw = await runJava(code, input, timeoutMs);
    else {
      return {
        output: null,
        error: `Unsupported language: "${language}". Supported: javascript, python, java.`,
        executionTime: 0, memoryUsed: 0, verdict: "Runtime Error",
      };
    }
  } catch (err) {
    console.error("[Judge] Execution error:", err.message);
    return { output: null, error: err.message, executionTime: 0, memoryUsed: 0, verdict: "Runtime Error" };
  }

  if (raw.timedOut) {
    return { output: null, error: "Time Limit Exceeded", executionTime: timeLimitSeconds, memoryUsed: 0, verdict: "Time Limit Exceeded" };
  }
  if (raw.exitCode !== 0 && raw.stderr) {
    return { output: null, error: raw.stderr.trim(), executionTime: raw.elapsedMs / 1000, memoryUsed: 0, verdict: null };
  }
  return { output: raw.stdout, error: raw.stderr || null, executionTime: raw.elapsedMs / 1000, memoryUsed: 0, verdict: null };
};

module.exports = executeCode;