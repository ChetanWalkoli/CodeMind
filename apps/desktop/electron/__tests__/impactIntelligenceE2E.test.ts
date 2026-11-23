import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectIndexer } from "@codemind/code-engine";
import { DecisionManager } from "../decisions/decisionManager.js";
import { DecisionStore } from "../decisions/decisionStore.js";
import {
  getBaselineFileContent,
  getUncommittedChangedFiles
} from "../impact/impactGitDiffService.js";
import { ImpactManager, ImpactSecurityError } from "../impact/impactManager.js";
import { ImpactStore } from "../impact/impactStore.js";
import { VerificationEngine } from "../intent/verificationEngine.js";
import { CodeEngineManager } from "../ipc/handlers/engine.handler.js";
import { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceAuthority } from "../workspace/pathSecurity.js";

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

describe("Phase 8 — Change Impact Intelligence E2E", () => {
  let tmpRoot: string;
  let storageDir: string;
  let authority: WorkspaceAuthority;
  let impactManager: ImpactManager;
  let decisionManager: DecisionManager;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-impact-e2e-"));
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-impact-store-"));

    // Build full-stack fixture
    writeFixtureFile(
      tmpRoot,
      "package.json",
      JSON.stringify(
        {
          name: "impact-fixture",
          scripts: {
            test: "vitest run",
            typecheck: "tsc --noEmit"
          }
        },
        null,
        2
      )
    );

    writeFixtureFile(
      tmpRoot,
      "backend/models/User.js",
      `const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  email: { type: String, required: true },
  role: { type: Number, required: true },
  passwordHash: { type: String, required: true }
});
module.exports = mongoose.model('User', userSchema);
`
    );

    writeFixtureFile(
      tmpRoot,
      "backend/controllers/authController.js",
      `const User = require('../models/User');
async function login(req, res) {
  const user = await User.findOne({ email: req.body.email });
  return res.json({ email: user.email, role: user.role });
}
module.exports = { login };
`
    );

    writeFixtureFile(
      tmpRoot,
      "backend/middleware/authMiddleware.js",
      `const User = require('../models/User');
async function requireAdmin(req, res, next) {
  const user = await User.findById(req.userId);
  if (user.role !== 'admin') return res.status(403).end();
  next();
}
module.exports = { requireAdmin };
`
    );

    writeFixtureFile(
      tmpRoot,
      "backend/routes/authRoutes.js",
      `const express = require('express');
const { login } = require('../controllers/authController');
const { requireAdmin } = require('../middleware/authMiddleware');
const router = express.Router();
router.post('/api/auth/login', requireAdmin, login);
module.exports = router;
`
    );

    writeFixtureFile(
      tmpRoot,
      "frontend/src/lib/api.js",
      `export async function loginUser(payload) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res.json();
}
`
    );

    writeFixtureFile(
      tmpRoot,
      "frontend/src/pages/profile.tsx",
      `import { loginUser } from '../lib/api';
export function ProfilePage() {
  return loginUser({ email: 'a@b.com' });
}
`
    );

    writeFixtureFile(
      tmpRoot,
      "backend/tests/userModel.test.js",
      `const User = require('../models/User');
test('user model exists', () => { expect(User).toBeDefined(); });
`
    );

    writeFixtureFile(
      tmpRoot,
      "backend/tests/authController.test.js",
      `const { login } = require('../controllers/authController');
test('login exists', () => { expect(login).toBeDefined(); });
`
    );

    writeFixtureFile(tmpRoot, ".env", "JWT_SECRET=super-secret-value\n");

    authority = new WorkspaceAuthority();
    authority.authorizeRoot(tmpRoot);

    const preferences = new PreferencesStore(storageDir);
    const engineManager = new CodeEngineManager();
    const indexer = new ProjectIndexer(tmpRoot);
    await indexer.indexWorkspace();

    const decisionStore = new DecisionStore(storageDir);
    decisionManager = new DecisionManager({
      authority,
      store: decisionStore,
      engineManager,
      preferences
    });

    // Record an existing Phase 7 Decision Memory entry referencing User.js
    await decisionManager.createDecision({
      workspaceRoot: tmpRoot,
      title: "Keep User.role as string enum",
      summary: "Auth middleware compares role string directly",
      context: "RBAC checks in authMiddleware rely on string role values",
      problem: "Numeric roles break middleware readability",
      decision: "Store User.role as string enum",
      rationale: "Avoid breaking auth middleware checks",
      category: "database",
      status: "accepted",
      tags: ["auth", "user"],
      evidence: [
        {
          type: "source_file",
          filePath: "backend/models/User.js",
          description: "User schema definition",
          provenance: "verified_evidence"
        }
      ]
    });

    const impactStore = new ImpactStore(storageDir);
    const verificationEngine = new VerificationEngine(authority);

    impactManager = new ImpactManager({
      workspaceAuthority: authority,
      impactStore,
      decisionManager,
      verificationEngine,
      getIndexer: () => indexer
    });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it("runs full-stack impact analysis across dependencies, API, DB, tests, decisions, risk, and validation plan", async () => {
    const beforeUser = `const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  email: { type: String, required: true },
  role: { type: String, required: false },
  passwordHash: { type: String, required: true }
});
module.exports = mongoose.model('User', userSchema);
`;

    const result = await impactManager.analyzeChangeImpact({
      workspaceRoot: tmpRoot,
      targets: [
        {
          filePath: "backend/models/User.js",
          beforeContent: beforeUser
        }
      ],
      changeType: "database_contract_changed",
      maxDepth: 3,
      maxAffectedFiles: 50
    });

    // Direct & transitive dependents
    const directFiles = result.impactedFiles
      .filter((f) => f.category === "direct")
      .map((f) => f.filePath);
    const transitiveFiles = result.impactedFiles
      .filter((f) => f.category === "transitive")
      .map((f) => f.filePath);

    expect(directFiles).toContain("backend/controllers/authController.js");
    expect(directFiles).toContain("backend/middleware/authMiddleware.js");
    expect(transitiveFiles).toContain("backend/routes/authRoutes.js");

    // API Contract
    expect(result.apiContracts.length).toBeGreaterThanOrEqual(1);
    const loginApi = result.apiContracts.find((c) => c.endpoint.includes("/api/auth/login"));
    expect(loginApi).toBeDefined();
    expect(
      loginApi?.frontendConsumers.some((fc) => fc.filePath === "frontend/src/lib/api.js")
    ).toBe(true);

    // Database Contract
    expect(result.databaseContracts).toHaveLength(1);
    expect(result.databaseContracts[0]?.modelName).toBe("User");
    expect(result.databaseContracts[0]?.detectedChanges).toContain("field_type_changed");
    expect(result.databaseContracts[0]?.detectedChanges).toContain("requiredness_changed");

    // Test Impact
    const userTest = result.impactedTests.find(
      (t) => t.testFile === "backend/tests/userModel.test.js"
    );
    const ctrlTest = result.impactedTests.find(
      (t) => t.testFile === "backend/tests/authController.test.js"
    );
    expect(userTest?.classification).toBe("definitely_affected");
    expect(ctrlTest?.classification).toBe("likely_affected");

    // Decision Memory (read-only)
    expect(result.relatedDecisions).toHaveLength(1);
    expect(result.relatedDecisions[0]?.relation).toBe("possible_conflict");
    const persistedDecisions = decisionManager.listDecisions(tmpRoot);
    expect(persistedDecisions[0]?.status).toBe("accepted");

    // Explainable Risk Scoring
    expect(result.risk.calculationVersion).toBe("impact-risk-v1.0.0");
    expect(result.risk.score).toBeGreaterThanOrEqual(50);
    expect(["high", "critical"]).toContain(result.risk.level);
    expect(result.risk.factors).toHaveLength(7);

    // Validation Plan uses only real discovered scripts (test & typecheck, no build/lint)
    expect(result.validationPlan.length).toBeGreaterThanOrEqual(3);
    expect(result.validationPlan.every((s) => s.requiresUserApproval === true)).toBe(true);
    expect(result.validationPlan.some((s) => s.category === "unit_test")).toBe(true);
    expect(result.validationPlan.some((s) => s.category === "typecheck")).toBe(true);
    expect(result.validationPlan.some((s) => s.category === "build")).toBe(false);

    // Persistence + validation step status update
    const summaries = impactManager.listAnalyses(tmpRoot);
    expect(summaries).toHaveLength(1);
    const firstStep = result.validationPlan[0]!;
    const updatedStepResult = impactManager.updateValidationStep(
      tmpRoot,
      result.analysisId,
      firstStep.stepId,
      "completed"
    );
    expect(
      updatedStepResult?.validationPlan.find((s) => s.stepId === firstStep.stepId)?.executionStatus
    ).toBe("completed");

    // Freshness check -> still fresh before modifying disk
    const freshCheck = impactManager.checkFreshness(tmpRoot, result.analysisId);
    expect(freshCheck?.status).not.toBe("stale");

    // Modify User.js on disk -> checkFreshness detects staleness
    writeFixtureFile(
      tmpRoot,
      "backend/models/User.js",
      `// modified on disk\nmodule.exports = {};\n`
    );
    const staleCheck = impactManager.checkFreshness(tmpRoot, result.analysisId);
    expect(staleCheck?.status).toBe("stale");
    expect(staleCheck?.staleFiles).toContain("backend/models/User.js");

    // Delete analysis
    expect(impactManager.deleteAnalysis(tmpRoot, result.analysisId)).toBe(true);
    expect(impactManager.getAnalysis(tmpRoot, result.analysisId)).toBeNull();
  });

  it("blocks sensitive secret files (.env) and workspace-escape paths (../)", async () => {
    await expect(
      impactManager.analyzeChangeImpact({
        workspaceRoot: tmpRoot,
        targets: [{ filePath: ".env" }],
        changeType: "file_modified",
        maxDepth: 2,
        maxAffectedFiles: 20
      })
    ).rejects.toThrowError(ImpactSecurityError);

    await expect(
      impactManager.analyzeChangeImpact({
        workspaceRoot: tmpRoot,
        targets: [{ filePath: "../outside-escape.js" }],
        changeType: "file_modified",
        maxDepth: 2,
        maxAffectedFiles: 20
      })
    ).rejects.toThrowError(ImpactSecurityError);

    // Review 6: Ignored directories (node_modules) & unauthorized workspace roots are blocked
    writeFixtureFile(tmpRoot, "node_modules/pkg/index.js", "module.exports = 1;\n");
    await expect(
      impactManager.analyzeChangeImpact({
        workspaceRoot: tmpRoot,
        targets: [{ filePath: "node_modules/pkg/index.js" }],
        changeType: "file_modified",
        maxDepth: 2,
        maxAffectedFiles: 20
      })
    ).rejects.toThrowError(ImpactSecurityError);

    await expect(
      impactManager.analyzeChangeImpact({
        workspaceRoot: path.join(os.tmpdir(), "unregistered-codemind-ws"),
        targets: [{ filePath: "index.js" }],
        changeType: "file_modified",
        maxDepth: 2,
        maxAffectedFiles: 20
      })
    ).rejects.toThrow();
  });

  it("Review 7: marks reports stale on direct dependent, transitive dependent, API consumer, decision update, and deletion without rewriting history", async () => {
    const result = await impactManager.analyzeChangeImpact({
      workspaceRoot: tmpRoot,
      targets: [{ filePath: "backend/models/User.js" }],
      changeType: "file_modified",
      maxDepth: 3,
      maxAffectedFiles: 50
    });
    const originalScore = result.risk.score;
    const originalImpactedCount = result.impactedFiles.length;

    // 1. Direct dependent modified
    writeFixtureFile(
      tmpRoot,
      "backend/controllers/authController.js",
      `const User = require('../models/User');\n// changed direct dependent\nmodule.exports = {};\n`
    );
    let check = impactManager.checkFreshness(tmpRoot, result.analysisId);
    expect(check?.status).toBe("stale");
    expect(check?.staleFiles).toContain("backend/controllers/authController.js");
    // Historical data must not be silently rewritten
    expect(check?.risk.score).toBe(originalScore);
    expect(check?.impactedFiles).toHaveLength(originalImpactedCount);

    // 2. Transitive dependent modified
    writeFixtureFile(tmpRoot, "backend/routes/authRoutes.js", `// changed route\n`);
    check = impactManager.checkFreshness(tmpRoot, result.analysisId);
    expect(check?.staleFiles).toContain("backend/routes/authRoutes.js");

    // 3. API frontend consumer deleted
    fs.unlinkSync(path.join(tmpRoot, "frontend/src/lib/api.js"));
    check = impactManager.checkFreshness(tmpRoot, result.analysisId);
    expect(check?.staleFiles).toContain("frontend/src/lib/api.js");

    // 4. Related Decision Memory record updated
    const decisions = decisionManager.listDecisions(tmpRoot);
    const dec = decisions[0]!;
    await new Promise((r) => setTimeout(r, 15));
    await decisionManager.updateDecision({
      workspaceRoot: tmpRoot,
      decisionId: dec.id,
      rationale: "Updated rationale after review"
    });
    check = impactManager.checkFreshness(tmpRoot, result.analysisId);
    expect(check?.staleFiles).toContain(`decision:${dec.id}`);
  });

  it("Review 1: Git diff service handles missing repo, staged, unstaged, mixed, untracked dir, rename baseline, delete, binary, and excludes .env", async () => {
    // 1. Non-Git workspace degrades gracefully
    const noGit = await impactManager.analyzeGitDiff({ workspaceRoot: tmpRoot });
    expect(noGit.available).toBe(false);
    expect(noGit.result).toBeNull();

    // 2. Initialize a real isolated Git repo inside tmpRoot
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: tmpRoot, stdio: "pipe", windowsHide: true });

    git(["init"]);
    git(["config", "user.email", "test@codemind.local"]);
    git(["config", "user.name", "CodeMind Test"]);
    // Exclude .env from initial commit, commit source files
    writeFixtureFile(tmpRoot, ".gitignore", ".env\n");
    writeFixtureFile(tmpRoot, "backend/models/Account.js", "module.exports = { v: 1 };\n");
    writeFixtureFile(tmpRoot, "backend/models/OldModel.js", "module.exports = { old: true };\n");
    writeFixtureFile(tmpRoot, "backend/models/ToDelete.js", "module.exports = { del: true };\n");
    git(["add", "."]);
    git(["commit", "-m", "initial"]);

    // Staged modification
    writeFixtureFile(tmpRoot, "backend/models/Account.js", "module.exports = { v: 2 };\n");
    git(["add", "backend/models/Account.js"]);

    // Mixed staged + unstaged modification on User.js
    writeFixtureFile(
      tmpRoot,
      "backend/models/User.js",
      `const mongoose = require('mongoose');\nconst s = new mongoose.Schema({ email: { type: String, required: true } });\nmodule.exports = mongoose.model('User', s);\n`
    );
    git(["add", "backend/models/User.js"]);
    writeFixtureFile(
      tmpRoot,
      "backend/models/User.js",
      `const mongoose = require('mongoose');\nconst s = new mongoose.Schema({ email: { type: String, required: true }, tier: { type: String, required: true } });\nmodule.exports = mongoose.model('User', s);\n`
    );

    // Rename via git mv (staged)
    git(["mv", "backend/models/OldModel.js", "backend/models/RenamedModel.js"]);

    // Delete tracked file
    fs.unlinkSync(path.join(tmpRoot, "backend/models/ToDelete.js"));

    // Untracked file inside a brand-new untracked subdirectory
    writeFixtureFile(tmpRoot, "backend/newdir/helper.js", "module.exports = () => 42;\n");

    // Binary file with NUL bytes
    fs.writeFileSync(
      path.join(tmpRoot, "backend/assets.bin"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01, 0x02])
    );

    // Sensitive file (even if untracked/modified, must never enter analysis)
    writeFixtureFile(tmpRoot, "secrets.json", '{"apiKey":"top-secret"}\n');

    const diffSummary = await getUncommittedChangedFiles(tmpRoot);
    expect(diffSummary.available).toBe(true);

    const byPath = new Map(diffSummary.changedFiles.map((f) => [f.filePath, f]));
    expect(byPath.get("backend/models/Account.js")?.changeScope).toBe("staged");
    expect(byPath.get("backend/models/User.js")?.changeScope).toBe("mixed");
    expect(byPath.get("backend/models/RenamedModel.js")?.status).toBe("renamed");
    expect(byPath.get("backend/models/RenamedModel.js")?.previousPath).toBe(
      "backend/models/OldModel.js"
    );
    expect(byPath.get("backend/models/ToDelete.js")?.status).toBe("deleted");
    expect(byPath.get("backend/newdir/helper.js")?.status).toBe("untracked");

    // Baseline for renamed file reads from HEAD:<previousPath>
    const renamedBaseline = await getBaselineFileContent(
      tmpRoot,
      byPath.get("backend/models/RenamedModel.js")!
    );
    expect(renamedBaseline.content).toContain("old: true");

    // Full analyzeGitDiff excludes secrets.json, handles binary cleanly, and succeeds
    const gitImpact = await impactManager.analyzeGitDiff({ workspaceRoot: tmpRoot });
    expect(gitImpact.available).toBe(true);
    expect(gitImpact.result).not.toBeNull();
    const analyzedPaths = gitImpact.result!.analyzedTargets.map((t) => t.filePath);
    expect(analyzedPaths).not.toContain("secrets.json");
    expect(analyzedPaths).not.toContain(".env");
    expect(gitImpact.result!.limitations.some((l) => l.includes("sensitive or ignored"))).toBe(
      true
    );
    expect(gitImpact.result!.limitations.some((l) => l.includes("Binary file"))).toBe(true);
  });
});
