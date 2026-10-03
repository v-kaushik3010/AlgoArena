/**
 * AlgoArena — Free, self-hosted code judge
 *
 * Strategy (zero cost, no external APIs):
 *   - JavaScript  → spawned in a new Node.js child process
 *   - Python      → spawned with `python` (system Python 3)
 *   - Java        → compiled with `javac`, then run with `java`
 *
 * Each execution:
 *   1. Writes source code to a temp file
 *   2. Spawns a subprocess, piping `stdin` (the test-case input)
 *   3. Enforces a hard wall-clock timeout (kills the process if exceeded)
 *   4. Returns { output, error, executionTime, memoryUsed }
 *
 * Security note: This runs user code directly on the server.
 * For a production deployment add OS-level sandboxing (Docker / firejail).
 * For a personal / classroom project this is perfectly fine.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Write `content` to a temporary file and return its absolute path.
 */
function writeTempFile(content, extension) {
  const name = `algoarena_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}${extension}`;
  const filePath = path.join(os.tmpdir(), name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Delete a file if it exists (best-effort cleanup).
 */
function safeDelete(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_) {}
}

/**
 * Run a command as a child process with a hard timeout.
 *
 * @param {string}   cmd       - executable (e.g. "python", "node")
 * @param {string[]} args      - argument list
 * @param {string}   stdin     - string to pipe into stdin
 * @param {number}   timeoutMs - kill timeout in milliseconds
 * @returns {Promise<{stdout, stderr, exitCode, timedOut, elapsedMs}>}
 */
function runProcess(cmd, args, stdin, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(cmd, args, {
      env: process.env,
      shell: false,
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
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

// ─── Language Runners ────────────────────────────────────────────────────────

async function runJavaScript(code, input, timeoutMs) {
  const filePath = writeTempFile(code, ".js");
  try {
    return await runProcess("node", [filePath], input, timeoutMs);
  } finally {
    safeDelete(filePath);
  }
}

async function runPython(code, input, timeoutMs) {
  const filePath = writeTempFile(code, ".py");
  try {
    // -u = unbuffered so partial output is never lost
    return await runProcess("python", ["-u", filePath], input, timeoutMs);
  } finally {
    safeDelete(filePath);
  }
}

/**
 * Compile and execute Java.
 * The submitted class MUST be named `Main` (standard competitive programming convention).
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
    // Step 1 — Compile (10 s hard limit)
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

    // Step 2 — Run
    return await runProcess("java", ["-cp", subDir, "Main"], input, timeoutMs);
  } finally {
    try { fs.rmSync(subDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Execute user code and return a normalised result object.
 *
 * @param {string} language          - "javascript" | "python" | "java"
 * @param {string} code              - source code from the submission
 * @param {string} input             - test-case input piped to stdin
 * @param {number} [timeLimitSeconds=2]
 *
 * @returns {Promise<{
 *   output: string|null,
 *   error:  string|null,
 *   executionTime: number,   // wall-clock seconds
 *   memoryUsed: number,      // 0 — cross-platform tracking is non-trivial
 *   verdict: string|null,    // "Time Limit Exceeded" | null
 * }>}
 */
const executeCode = async (language, code, input, timeLimitSeconds = 2) => {
  const timeoutMs = timeLimitSeconds * 1000;
  let raw;

  try {
    switch (language.toLowerCase()) {
      case "javascript":
      case "js":
        raw = await runJavaScript(code, input, timeoutMs);
        break;
      case "python":
      case "python3":
        raw = await runPython(code, input, timeoutMs);
        break;
      case "java":
        raw = await runJava(code, input, timeoutMs);
        break;
      default:
        return {
          output: null,
          error: `Unsupported language: "${language}". Supported: javascript, python, java.`,
          executionTime: 0,
          memoryUsed: 0,
          verdict: "Runtime Error",
        };
    }
  } catch (err) {
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