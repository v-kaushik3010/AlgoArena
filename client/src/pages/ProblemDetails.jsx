import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import API from "../services/api";

/* ── Default starter templates per language ── */
const TEMPLATES = {
  java: `import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        // write your solution here

    }
}`,
  python: `import sys
input = sys.stdin.readline

# write your solution here
`,
  javascript: `const lines = require("fs").readFileSync(0, "utf8").trim().split("\\n");
// write your solution here
`,
};

function ProblemDetails() {
  const { id } = useParams();

  const [problem,  setProblem]  = useState(null);
  const [code,     setCode]     = useState(TEMPLATES.java);
  const [language, setLanguage] = useState("java");
  const [verdict,  setVerdict]  = useState("");
  const [errDetail, setErrDetail] = useState("");
  const [loading,  setLoading]  = useState(false);

  // Run panel state
  const [customInput,  setCustomInput]  = useState("");
  const [runOutput,    setRunOutput]    = useState(null);   // { output, error, executionTime }
  const [runLoading,   setRunLoading]   = useState(false);

  useEffect(() => {
    API.get(`/problems/${id}`)
      .then((res) => {
        setProblem(res.data);
        setCustomInput(res.data.sampleInput || "");
      })
      .catch(console.error);
  }, [id]);

  /* swap template when language changes */
  const handleLanguageChange = (e) => {
    setLanguage(e.target.value);
    setCode(TEMPLATES[e.target.value] || "");
    setVerdict("");
    setRunOutput(null);
  };

  /* ── Run against custom input ── */
  const handleRun = async () => {
    setRunLoading(true);
    setRunOutput(null);
    try {
      const res = await API.post("/submissions/run", { code, language, input: customInput });
      setRunOutput(res.data);
    } catch (err) {
      setRunOutput({ output: "", error: err.response?.data?.message || err.message, executionTime: 0 });
    } finally {
      setRunLoading(false);
    }
  };

  /* ── Submit against all test cases ── */
  const handleSubmit = async () => {
    setLoading(true);
    setVerdict("");
    setErrDetail("");
    try {
      const user = JSON.parse(localStorage.getItem("user"));
      const res = await API.post(
        "/submissions",
        { problemId: problem._id, code, language },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      setVerdict(res.data.verdict);
      setErrDetail(res.data.errorDetail || "");
    } catch (err) {
      setVerdict(err.response?.data?.verdict || "Submission Failed");
      setErrDetail("");
    } finally {
      setLoading(false);
    }
  };

  if (!problem) {
    return (
      <div style={{ color: "#4ade80", textAlign: "center", marginTop: 80, fontSize: 28 }}>
        Loading problem...
      </div>
    );
  }

  const diffColor =
    problem.difficulty === "Easy"   ? "#22c55e" :
    problem.difficulty === "Medium" ? "#eab308" : "#ef4444";

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#fff", padding: "32px 24px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* ── Title + Difficulty ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: "#4ade80", margin: 0 }}>
            {problem.title}
          </h1>
          <span style={{
            background: diffColor + "33", color: diffColor,
            padding: "6px 18px", borderRadius: 999, fontWeight: 700, fontSize: 14,
          }}>
            {problem.difficulty}
          </span>
        </div>

        {/* ── Description ── */}
        <Card title="Description">
          <p style={{ color: "#d4d4d8", lineHeight: 1.8, margin: 0 }}>{problem.description}</p>
        </Card>

        {/* ── Examples ── */}
        <Card title="Examples">
          {problem.examples && problem.examples.length > 0 ? (
            problem.examples.map((ex, i) => (
              <div key={i} style={{
                background: "#18181b", borderRadius: 12, padding: "16px 20px",
                marginBottom: i < problem.examples.length - 1 ? 16 : 0,
              }}>
                <p style={{ fontWeight: 700, color: "#4ade80", marginBottom: 10 }}>
                  Example {i + 1}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ margin: 0 }}>
                    <span style={{ color: "#4ade80", fontWeight: 600 }}>Input: </span>
                    <code style={{ background: "#27272a", padding: "2px 8px", borderRadius: 6 }}>
                      {ex.input}
                    </code>
                  </p>
                  <p style={{ margin: 0 }}>
                    <span style={{ color: "#4ade80", fontWeight: 600 }}>Output: </span>
                    <code style={{ background: "#27272a", padding: "2px 8px", borderRadius: 6 }}>
                      {ex.output}
                    </code>
                  </p>
                  {ex.explanation && (
                    <p style={{ margin: 0, color: "#a1a1aa" }}>
                      <span style={{ color: "#4ade80", fontWeight: 600 }}>Explanation: </span>
                      {ex.explanation}
                    </p>
                  )}
                </div>
              </div>
            ))
          ) : problem.sampleInput ? (
            /* fallback — show sampleInput/sampleOutput */
            <div style={{ background: "#18181b", borderRadius: 12, padding: "16px 20px" }}>
              <p style={{ margin: 0 }}>
                <span style={{ color: "#4ade80", fontWeight: 600 }}>Input: </span>
                <code style={{ background: "#27272a", padding: "2px 8px", borderRadius: 6 }}>
                  {problem.sampleInput}
                </code>
              </p>
              <p style={{ margin: "8px 0 0" }}>
                <span style={{ color: "#4ade80", fontWeight: 600 }}>Output: </span>
                <code style={{ background: "#27272a", padding: "2px 8px", borderRadius: 6 }}>
                  {problem.sampleOutput}
                </code>
              </p>
            </div>
          ) : (
            <p style={{ color: "#71717a" }}>No examples available.</p>
          )}
        </Card>

        {/* ── Constraints ── */}
        {problem.constraints && (
          <Card title="Constraints">
            <pre style={{ margin: 0, color: "#d4d4d8", fontFamily: "inherit", whiteSpace: "pre-wrap" }}>
              {problem.constraints}
            </pre>
          </Card>
        )}

        {/* ── Tags ── */}
        {problem.tags?.length > 0 && (
          <Card title="Tags">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {problem.tags.map((tag, i) => (
                <span key={i} style={{
                  background: "#4ade8033", color: "#4ade80",
                  padding: "4px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600,
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </Card>
        )}

        {/* ── Code Editor ── */}
        <Card title={null} style={{ padding: 0 }}>
          <div style={{ padding: "20px 24px 0" }}>
            {/* header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Code Editor</h2>
              <select
                id="language-select"
                value={language}
                onChange={handleLanguageChange}
                style={{
                  background: "#27272a", color: "#fff",
                  border: "1px solid #3f3f46", borderRadius: 8,
                  padding: "6px 14px", fontSize: 14, cursor: "pointer", outline: "none",
                }}
              >
                <option value="java">Java</option>
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
              </select>
            </div>
          </div>

          {/* Monaco editor */}
          <Editor
            height="420px"
            theme="vs-dark"
            language={language}
            value={code}
            onChange={(v) => setCode(v)}
            options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false }}
          />

          {/* ── Run Panel ── */}
          <div style={{ padding: "20px 24px", borderTop: "1px solid #27272a" }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 8, color: "#a1a1aa", fontSize: 13 }}>
              Custom Input (stdin)
            </label>
            <textarea
              id="custom-input"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              rows={3}
              placeholder="Enter input for your code..."
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#18181b", color: "#fff", border: "1px solid #3f3f46",
                borderRadius: 8, padding: "10px 14px", fontSize: 13,
                fontFamily: "monospace", resize: "vertical", outline: "none",
              }}
            />

            {/* Run output */}
            {runOutput && (
              <div style={{
                marginTop: 12, background: "#18181b", borderRadius: 10,
                border: `1px solid ${runOutput.error ? "#ef4444" : "#27272a"}`,
                padding: "12px 16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: runOutput.error ? "#f87171" : "#4ade80" }}>
                    {runOutput.error ? "Runtime Error / Compilation Error" : "Output"}
                  </span>
                  {runOutput.executionTime > 0 && (
                    <span style={{ fontSize: 12, color: "#71717a" }}>
                      {(runOutput.executionTime * 1000).toFixed(0)} ms
                    </span>
                  )}
                </div>
                {runOutput.output && (
                  <pre style={{ margin: 0, color: "#d4d4d8", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {runOutput.output}
                  </pre>
                )}
                {runOutput.error && (
                  <pre style={{ margin: 0, color: "#f87171", fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {runOutput.error}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* ── Action buttons ── */}
          <div style={{ padding: "0 24px 24px", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              id="run-btn"
              onClick={handleRun}
              disabled={runLoading}
              style={{
                background: runLoading ? "#27272a" : "#27272a",
                color: runLoading ? "#71717a" : "#4ade80",
                border: "1px solid #4ade80",
                padding: "10px 28px", borderRadius: 10,
                fontWeight: 700, fontSize: 15, cursor: runLoading ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {runLoading ? "Running..." : "▶  Run"}
            </button>

            <button
              id="submit-btn"
              onClick={handleSubmit}
              disabled={loading}
              style={{
                background: loading ? "#16a34a88" : "#22c55e",
                color: "#000",
                border: "none",
                padding: "10px 28px", borderRadius: 10,
                fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {loading ? "Submitting..." : "Submit Solution"}
            </button>
          </div>

          {/* ── Verdict banner ── */}
          {verdict && (
            <div style={{
              margin: "0 24px 24px",
              padding: "14px 20px",
              borderRadius: 10,
              fontWeight: 700, fontSize: 16,
              background: verdict === "Accepted" ? "#22c55e22" : "#ef444422",
              color:      verdict === "Accepted" ? "#4ade80"   : "#f87171",
              border:     `1px solid ${verdict === "Accepted" ? "#22c55e" : "#ef4444"}`,
            }}>
              {verdict === "Accepted" ? "✅" : "❌"} Verdict: {verdict}
              {errDetail && (
                <pre style={{
                  marginTop: 8, fontSize: 12, fontWeight: 400,
                  color: "#fca5a5", fontFamily: "monospace",
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {errDetail}
                </pre>
              )}
            </div>
          )}

        </Card>
      </div>
    </div>
  );
}

/* ── Reusable card wrapper ── */
function Card({ title, children, style }) {
  return (
    <div style={{
      background: "#18181b", borderRadius: 16,
      border: "1px solid #27272a", marginBottom: 20, overflow: "hidden",
      ...style,
    }}>
      {title && (
        <div style={{ padding: "18px 24px 0" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, marginBottom: 14 }}>{title}</h2>
        </div>
      )}
      <div style={{ padding: title ? "0 24px 20px" : 0 }}>
        {children}
      </div>
    </div>
  );
}

export default ProblemDetails;