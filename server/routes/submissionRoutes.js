const express = require("express");

const {
  createSubmission,
  getMySubmissions,
  getProblemSubmissions,
  runCode,
} = require("../controllers/submissionController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// ▶️ Run Code (no auth — not graded)
router.post("/run", runCode);

// 🚀 Create Submission
router.post("/", protect, createSubmission);

// 📜 Get Logged-in User Submissions
router.get("/my", protect, getMySubmissions);

// 📌 Get Submissions For a Problem
router.get("/problem/:problemId", protect, getProblemSubmissions);

module.exports = router;