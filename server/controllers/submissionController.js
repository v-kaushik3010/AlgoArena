const Submission = require("../models/Submission");
const Problem = require("../models/Problem");
const User = require("../models/User");
const executeCode = require("../utils/codeExecutor");

// ▶️ Run Code (sample run — not graded, no submission saved)
exports.runCode = async (req, res) => {
  try {
    const { code, language, input } = req.body;
    if (!code || !language) {
      return res.status(400).json({ message: "code and language are required" });
    }
    const result = await executeCode(language, code, input || "", 5);
    return res.status(200).json({
      output: result.output || "",
      error:  result.error  || null,
      executionTime: result.executionTime,
      verdict: result.verdict || null,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};


// 🚀 Create Submission
exports.createSubmission = async (req, res) => {
  try {

    const { problemId, code, language } = req.body;

    // ✅ Validate request body
    if (!problemId || !code || !language) {
      return res.status(400).json({
        message: "problemId, code, and language are required",
      });
    }

    // ✅ Check if problem exists
    const problem = await Problem.findById(problemId);

    if (!problem) {
      return res.status(404).json({
        message: "Problem not found",
      });
    }

    // ✅ Ensure testcases exist
    if (!problem.testCases || problem.testCases.length === 0) {
      return res.status(400).json({
        message: "Problem has no testcases",
      });
    }

    let verdict = "Accepted";
    let executionTime = 0;
    let memoryUsed = 0;
    const timeLimit = problem.timeLimit || 2;

    // 🚀 Run ALL test cases in PARALLEL (instead of sequentially)
    const results = await Promise.all(
      problem.testCases.map((tc) => executeCode(language, code, tc.input, timeLimit))
    );

    for (let i = 0; i < results.length; i++) {
      const result   = results[i];
      const testCase = problem.testCases[i];

      executionTime = Math.max(executionTime, result.executionTime || 0);
      memoryUsed    = Math.max(memoryUsed,    result.memoryUsed    || 0);

      if (result.verdict === "Time Limit Exceeded") {
        verdict = "Time Limit Exceeded";
        break;
      }
      if (result.error && !result.output) {
        verdict = "Runtime Error";
        break;
      }
      const actual   = result.output?.toString().trim();
      const expected = testCase.output?.toString().trim();
      if (actual !== expected) {
        verdict = "Wrong Answer";
        break;
      }
    }


    // ✅ Create submission
    const submission = await Submission.create({
      user: req.user._id,
      problem: problemId,
      code,
      language,
      verdict,
      executionTime,
      memoryUsed,
    });

    // 🏆 Update user score if accepted
    if (verdict === "Accepted") {

      const user = await User.findById(
        req.user._id
      );

      // Prevent duplicate score increase
      const alreadySolved =
        user.solvedProblems.some(
          (id) => id.toString() === problemId
        );

      if (!alreadySolved) {

        let points = 0;

        if (problem.difficulty === "Easy") {
          points = 10;
        }

        else if (
          problem.difficulty === "Medium"
        ) {
          points = 20;
        }

        else if (
          problem.difficulty === "Hard"
        ) {
          points = 30;
        }

        user.score += points;

        user.solvedProblems.push(problemId);

        await user.save();
      }
    }

    res.status(201).json(submission);

  } catch (error) {

    console.error(
      "Submission Error:",
      error
    );

    res.status(500).json({
      message: error.message,
    });
  }
};


// 📜 Get Logged-in User Submissions
exports.getMySubmissions = async (req, res) => {
  try {

    const submissions =
      await Submission.find({
        user: req.user._id,
      })
        .populate(
          "problem",
          "title difficulty"
        )
        .sort({
          createdAt: -1,
        });

    res.status(200).json(submissions);

  } catch (error) {

    res.status(500).json({
      message: error.message,
    });
  }
};


// 📌 Get Submissions For a Problem
exports.getProblemSubmissions = async (
  req,
  res
) => {
  try {

    const submissions =
      await Submission.find({
        problem: req.params.problemId,
      })
        .populate("user", "name")
        .sort({
          createdAt: -1,
        });

    res.status(200).json(submissions);

  } catch (error) {

    res.status(500).json({
      message: error.message,
    });
  }
};