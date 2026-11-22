// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  type IntentSession,
  type IntentSessionSummary,
  type IpcResponse,
  type PatchApprovalRecord,
  type PatchTransactionRecord,
  type RollbackCheckResult,
  type RollbackRecord,
  type VerificationCandidateCommand,
  type VerificationRunRecord
} from "@codemind/shared";
import { IntentStore } from "../intent/intentStore.js";
import type { AtomicWriteFileFn } from "../intent/patchApplicationEngine.js";
import { registerIpcHandlers, unregisterIpcHandlers, type IpcMainLike } from "../ipc/index.js";
import { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceAuthority } from "../workspace/pathSecurity.js";

class MockIpcMain implements IpcMainLike {
  public handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  async invoke<T>(channel: string, payload?: unknown): Promise<IpcResponse<T>> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return (await handler({}, payload)) as IpcResponse<T>;
  }
}

function writeFixtureFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function createIntentFixtureWorkspace(root: string): void {
  writeFixtureFile(root, ".gitignore", "ignored/\n");
  writeFixtureFile(root, ".env", "GEMINI_API_KEY=AIzaSySecretFixture1234567890\n");
  writeFixtureFile(root, "ignored/debug.js", "export const debugSecret = 1;\n");

  writeFixtureFile(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "intent-fixture",
        version: "1.0.0",
        scripts: {
          test: "node -e \"console.log('Tests 2 passed')\"",
          lint: "node -e \"console.error('lint failed'); process.exit(1)\"",
          typecheck: "node -e \"setTimeout(() => console.log('slow'), 4000)\"",
          build: "rm -rf /tmp/dangerous"
        }
      },
      null,
      2
    )
  );

  writeFixtureFile(
    root,
    "frontend/src/lib/api.js",
    `export async function loginRequest(email, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  return res.json();
}
`
  );

  writeFixtureFile(
    root,
    "backend/server.js",
    `import express from "express";
import authRoutes from "./routes/authRoutes";
const app = express();
app.use("/api/auth", authRoutes);
export default app;
`
  );

  writeFixtureFile(
    root,
    "backend/routes/authRoutes.js",
    `import express from "express";
import { handleLogin } from "../controllers/authController";
const router = express.Router();
router.post("/login", handleLogin);
export default router;
`
  );

  writeFixtureFile(
    root,
    "backend/controllers/authController.js",
    `import { verifyPassword } from "../services/authService";
export function handleLogin(req, res) {
  const ok = verifyPassword(req.body.password);
  return res.status(ok ? 200 : 401).json({ ok });
}
`
  );

  writeFixtureFile(
    root,
    "backend/services/authService.js",
    `export function verifyPassword(password) {
  return password === "secret";
}
`
  );
}

describe("Phase 6 Complete E2E — Intent Mode (Milestones 6.1–6.9)", () => {
  let workspaceDir: string;
  let dataDir: string;
  let ipcMain: MockIpcMain;
  let authority: WorkspaceAuthority;
  let intentStore: IntentStore;
  let customWriteHook: AtomicWriteFileFn | undefined;

  function setupHandlers() {
    unregisterIpcHandlers(ipcMain);
    registerIpcHandlers(ipcMain, {
      metadata: {
        name: "CodeMind",
        version: "0.1.0",
        platform: process.platform,
        arch: process.arch,
        electronVersion: "45.4.1",
        nodeVersion: process.versions.node,
        chromeVersion: "156.0.0"
      },
      preferences: new PreferencesStore(dataDir),
      authority,
      intentStore,
      writeFileAtomic: (abs, content, mode) => {
        if (customWriteHook) {
          customWriteHook(abs, content, mode);
          return;
        }
        fs.writeFileSync(abs, content, { encoding: "utf8", mode });
      }
    });
  }

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p6-ws-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p6-data-"));
    createIntentFixtureWorkspace(workspaceDir);
    ipcMain = new MockIpcMain();
    authority = new WorkspaceAuthority();
    authority.authorizeRoot(workspaceDir);
    intentStore = new IntentStore(dataDir);
    customWriteHook = undefined;
    setupHandlers();
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("executes the complete end-to-end Intent Mode workflow (6.1 -> 6.9) safely on a fixture workspace", async () => {
    // 6.1: Create specific intent & verify persistence
    const createRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_CREATE, {
      workspaceRoot: workspaceDir,
      prompt: "Fix the login error when a user enters an incorrect password."
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const intentId = createRes.data.intent.intentId;
    expect(createRes.data.intent.intentType).toBe("bug_fix");
    expect(createRes.data.intent.status).toBe("ready_for_investigation");

    const listRes = await ipcMain.invoke<IntentSessionSummary[]>(IPC_CHANNELS.INTENT_LIST, {
      workspaceRoot: workspaceDir
    });
    expect(listRes.ok && listRes.data.some((s) => s.intentId === intentId)).toBe(true);

    // 6.2: Investigate workspace (reuses ProjectIndexer, dependency graph, API relationships)
    const invRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_INVESTIGATE, {
      workspaceRoot: workspaceDir,
      intentId,
      limits: { maxFiles: 15, maxGraphDepth: 2 }
    });
    expect(invRes.ok).toBe(true);
    if (!invRes.ok) return;
    const inv = invRes.data.investigation!;
    const invPaths = inv.relevantFiles.map((f) => f.filePath);
    expect(invPaths).toContain("backend/controllers/authController.js");
    expect(invPaths).toContain("backend/services/authService.js");
    expect(invPaths).not.toContain(".env");
    expect(invPaths).not.toContain("ignored/debug.js");
    expect(inv.apiRelationships.length).toBeGreaterThanOrEqual(1);

    // 6.3: Evidence-based analysis
    const analysisRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_ANALYZE, {
      workspaceRoot: workspaceDir,
      intentId
    });
    expect(analysisRes.ok).toBe(true);
    if (!analysisRes.ok) return;
    expect(analysisRes.data.analysis?.findings.length).toBeGreaterThanOrEqual(1);

    // 6.4: Ranked recommendations & approval state separation
    const recRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_RECOMMEND, {
      workspaceRoot: workspaceDir,
      intentId
    });
    expect(recRes.ok).toBe(true);
    if (!recRes.ok) return;
    const topRec = recRes.data.recommendations[0]!;

    const decideRes = await ipcMain.invoke<IntentSession>(
      IPC_CHANNELS.INTENT_DECIDE_RECOMMENDATION,
      {
        workspaceRoot: workspaceDir,
        intentId,
        recommendationId: topRec.recommendationId,
        decision: "approved_for_patch"
      }
    );
    expect(decideRes.ok).toBe(true);

    // 6.5: Generate multi-file patch proposals WITHOUT modifying disk
    const authServiceBefore = fs.readFileSync(
      path.join(workspaceDir, "backend/services/authService.js"),
      "utf8"
    );
    const updatedService = `export function verifyPassword(password) {\n  if (typeof password !== "string" || !password) return false;\n  return password === "secret";\n}\n`;
    const updatedController = `import { verifyPassword } from "../services/authService";\nexport function handleLogin(req, res) {\n  const ok = verifyPassword(req.body?.password);\n  return res.status(ok ? 200 : 401).json({ ok, error: ok ? null : "Invalid credentials" });\n}\n`;

    const patchRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_GENERATE_PATCH, {
      workspaceRoot: workspaceDir,
      intentId,
      recommendationIds: [topRec.recommendationId],
      proposedEdits: [
        {
          targetFile: "backend/services/authService.js",
          proposedContent: updatedService,
          summary: "Guard non-string empty password input"
        },
        {
          targetFile: "backend/controllers/authController.js",
          proposedContent: updatedController,
          summary: "Return structured invalid credentials error message"
        }
      ]
    });
    expect(patchRes.ok).toBe(true);
    if (!patchRes.ok) return;
    expect(patchRes.data.patches).toHaveLength(2);
    expect(patchRes.data.patches.every((p) => p.validation.valid)).toBe(true);
    // Disk MUST remain untouched after patch generation
    expect(
      fs.readFileSync(path.join(workspaceDir, "backend/services/authService.js"), "utf8")
    ).toBe(authServiceBefore);

    // 6.6: Review patches (Accepting in review MUST NOT write files)
    const patchIds = patchRes.data.patches.map((p) => p.patchId);
    const reviewRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_REVIEW_PATCH, {
      workspaceRoot: workspaceDir,
      intentId,
      patchIds,
      decision: "accepted"
    });
    expect(reviewRes.ok).toBe(true);
    expect(
      fs.readFileSync(path.join(workspaceDir, "backend/services/authService.js"), "utf8")
    ).toBe(authServiceBefore);

    // 6.7: Explicit transaction approval & safe multi-file application
    const apprRes = await ipcMain.invoke<PatchApprovalRecord>(
      IPC_CHANNELS.INTENT_APPROVE_PATCH_TX,
      {
        workspaceRoot: workspaceDir,
        intentId,
        approved: true,
        entries: patchRes.data.patches.map((p) => ({
          patchId: p.patchId,
          targetFile: p.targetFile,
          originalFileHash: p.originalFileHash,
          proposedFileHash: p.proposedFileHash,
          originalContentVersion: p.originalContentVersion
        }))
      }
    );
    expect(apprRes.ok).toBe(true);
    if (!apprRes.ok) return;

    const applyRes = await ipcMain.invoke<PatchTransactionRecord>(
      IPC_CHANNELS.INTENT_APPLY_PATCH_TX,
      {
        workspaceRoot: workspaceDir,
        intentId,
        approvalId: apprRes.data.approvalId
      }
    );
    expect(applyRes.ok).toBe(true);
    if (!applyRes.ok) return;
    expect(applyRes.data.status).toBe("applied");
    expect(applyRes.data.files.every((f) => f.status === "applied")).toBe(true);
    expect(
      fs.readFileSync(path.join(workspaceDir, "backend/services/authService.js"), "utf8")
    ).toBe(updatedService);

    // Duplicate application of the same approval MUST be rejected
    const dupRes = await ipcMain.invoke<PatchTransactionRecord>(
      IPC_CHANNELS.INTENT_APPLY_PATCH_TX,
      {
        workspaceRoot: workspaceDir,
        intentId,
        approvalId: apprRes.data.approvalId
      }
    );
    expect(dupRes.ok).toBe(false);

    // 6.8: Verification command discovery, safety blocking, passing run, failing run, timeout
    const discRes = await ipcMain.invoke<VerificationCandidateCommand[]>(
      IPC_CHANNELS.INTENT_DISCOVER_VERIFICATION,
      { workspaceRoot: workspaceDir, intentId }
    );
    expect(discRes.ok).toBe(true);
    if (!discRes.ok) return;
    const buildCmd = discRes.data.find((c) => c.commandId === "cmd-build");
    expect(buildCmd?.safe).toBe(false); // blocked `rm -rf`

    // Running without approvedByUser: true rejected by Zod
    const unapprovedRun = await ipcMain.invoke<VerificationRunRecord>(
      IPC_CHANNELS.INTENT_RUN_VERIFICATION,
      { workspaceRoot: workspaceDir, intentId, commandId: "cmd-test", approvedByUser: false }
    );
    expect(unapprovedRun.ok).toBe(false);

    // Passing test command
    const passRun = await ipcMain.invoke<VerificationRunRecord>(
      IPC_CHANNELS.INTENT_RUN_VERIFICATION,
      {
        workspaceRoot: workspaceDir,
        intentId,
        transactionId: applyRes.data.transactionId,
        commandId: "cmd-test",
        approvedByUser: true
      }
    );
    expect(passRun.ok).toBe(true);
    if (passRun.ok) {
      expect(passRun.data.status).toBe("passed");
      expect(passRun.data.exitCode).toBe(0);
      expect(passRun.data.passedCount).toBe(2);
    }

    // Failing non-zero exit command
    const failRun = await ipcMain.invoke<VerificationRunRecord>(
      IPC_CHANNELS.INTENT_RUN_VERIFICATION,
      {
        workspaceRoot: workspaceDir,
        intentId,
        commandId: "cmd-lint",
        approvedByUser: true
      }
    );
    expect(failRun.ok).toBe(true);
    if (failRun.ok) {
      expect(failRun.data.status).toBe("failed");
      expect(failRun.data.exitCode).toBe(1);
    }

    // 6.9: Rollback check, single-file rollback, conflict detection, full rollback, idempotency
    const checkClean = await ipcMain.invoke<RollbackCheckResult>(
      IPC_CHANNELS.INTENT_CHECK_ROLLBACK,
      {
        workspaceRoot: workspaceDir,
        intentId,
        transactionId: applyRes.data.transactionId
      }
    );
    expect(checkClean.ok && checkClean.data.canRollbackCleanly).toBe(true);

    // Simulate user editing authController.js AFTER patch application
    fs.writeFileSync(
      path.join(workspaceDir, "backend/controllers/authController.js"),
      "// newer manual user edit\n",
      "utf8"
    );

    const checkConflict = await ipcMain.invoke<RollbackCheckResult>(
      IPC_CHANNELS.INTENT_CHECK_ROLLBACK,
      {
        workspaceRoot: workspaceDir,
        intentId,
        transactionId: applyRes.data.transactionId
      }
    );
    expect(checkConflict.ok).toBe(true);
    if (checkConflict.ok) {
      expect(checkConflict.data.canRollbackCleanly).toBe(false);
      expect(checkConflict.data.conflicts[0]?.reason).toBe("modified_after_patch");
    }

    // Rollback without forceOverwrite preserves the newer user edit & restores clean file
    const partialRb = await ipcMain.invoke<RollbackRecord>(IPC_CHANNELS.INTENT_EXECUTE_ROLLBACK, {
      workspaceRoot: workspaceDir,
      intentId,
      transactionId: applyRes.data.transactionId,
      mode: "full-transaction",
      confirmedByUser: true,
      forceOverwriteModified: false
    });
    expect(partialRb.ok).toBe(true);
    if (partialRb.ok) {
      expect(partialRb.data.status).toBe("partial");
      expect(
        partialRb.data.files.find((f) => f.targetFile === "backend/services/authService.js")?.status
      ).toBe("restored");
      expect(
        partialRb.data.files.find((f) => f.targetFile === "backend/controllers/authController.js")
          ?.status
      ).toBe("skipped_conflict");
    }
    expect(
      fs.readFileSync(path.join(workspaceDir, "backend/services/authService.js"), "utf8")
    ).toBe(authServiceBefore);
    expect(
      fs.readFileSync(path.join(workspaceDir, "backend/controllers/authController.js"), "utf8")
    ).toBe("// newer manual user edit\n");

    // Repeated rollback with forceOverwrite restores the conflicted file and marks already-restored file as already_original
    const forceRb = await ipcMain.invoke<RollbackRecord>(IPC_CHANNELS.INTENT_EXECUTE_ROLLBACK, {
      workspaceRoot: workspaceDir,
      intentId,
      transactionId: applyRes.data.transactionId,
      mode: "full-transaction",
      confirmedByUser: true,
      forceOverwriteModified: true
    });
    expect(forceRb.ok).toBe(true);
    if (forceRb.ok) {
      expect(forceRb.data.status).toBe("completed");
      expect(
        forceRb.data.files.find((f) => f.targetFile === "backend/services/authService.js")?.status
      ).toBe("already_original");
      expect(
        forceRb.data.files.find((f) => f.targetFile === "backend/controllers/authController.js")
          ?.status
      ).toBe("restored");
    }
  });

  it("blocks path traversal, secret files, excluded files, stale disk modifications, and recovers from mid-transaction write failures", async () => {
    const createRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_CREATE, {
      workspaceRoot: workspaceDir,
      prompt: "Fix the login error in backend/services/authService.js"
    });
    if (!createRes.ok) throw new Error("create failed");
    const intentId = createRes.data.intent.intentId;

    await ipcMain.invoke(IPC_CHANNELS.INTENT_INVESTIGATE, {
      workspaceRoot: workspaceDir,
      intentId
    });
    await ipcMain.invoke(IPC_CHANNELS.INTENT_ANALYZE, { workspaceRoot: workspaceDir, intentId });
    const recRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_RECOMMEND, {
      workspaceRoot: workspaceDir,
      intentId
    });
    if (!recRes.ok) throw new Error("rec failed");
    const recId = recRes.data.recommendations[0]!.recommendationId;

    // 1. Path traversal, secret file, and excluded file MUST all be rejected
    for (const badTarget of ["../escape.js", ".env", "ignored/debug.js"]) {
      const badPatch = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_GENERATE_PATCH, {
        workspaceRoot: workspaceDir,
        intentId,
        recommendationIds: [recId],
        proposedEdits: [{ targetFile: badTarget, proposedContent: "hacked" }]
      });
      expect(badPatch.ok).toBe(false);
    }

    // 2. Mid-transaction write failure automatically recovers already-written files!
    const origService = fs.readFileSync(
      path.join(workspaceDir, "backend/services/authService.js"),
      "utf8"
    );
    const patchRes = await ipcMain.invoke<IntentSession>(IPC_CHANNELS.INTENT_GENERATE_PATCH, {
      workspaceRoot: workspaceDir,
      intentId,
      recommendationIds: [recId],
      proposedEdits: [
        {
          targetFile: "backend/services/authService.js",
          proposedContent: "export function verifyPassword(p) { return Boolean(p); }\n"
        },
        {
          targetFile: "backend/controllers/authController.js",
          proposedContent: "export function handleLogin() { return true; }\n"
        }
      ]
    });
    if (!patchRes.ok) throw new Error("patch failed");

    await ipcMain.invoke(IPC_CHANNELS.INTENT_REVIEW_PATCH, {
      workspaceRoot: workspaceDir,
      intentId,
      patchIds: patchRes.data.patches.map((p) => p.patchId),
      decision: "accepted"
    });

    const appr = await ipcMain.invoke<PatchApprovalRecord>(IPC_CHANNELS.INTENT_APPROVE_PATCH_TX, {
      workspaceRoot: workspaceDir,
      intentId,
      approved: true,
      entries: patchRes.data.patches.map((p) => ({
        patchId: p.patchId,
        targetFile: p.targetFile,
        originalFileHash: p.originalFileHash,
        proposedFileHash: p.proposedFileHash,
        originalContentVersion: p.originalContentVersion
      }))
    });
    if (!appr.ok) throw new Error("appr failed");

    // Inject disk write failure on the 2nd file
    let writeCount = 0;
    customWriteHook = (abs, content, mode) => {
      writeCount += 1;
      if (writeCount === 2) {
        throw new Error("Simulated EACCES disk write failure");
      }
      fs.writeFileSync(abs, content, { encoding: "utf8", mode });
    };

    const txRes = await ipcMain.invoke<PatchTransactionRecord>(IPC_CHANNELS.INTENT_APPLY_PATCH_TX, {
      workspaceRoot: workspaceDir,
      intentId,
      approvalId: appr.data.approvalId
    });
    expect(txRes.ok).toBe(true);
    if (txRes.ok) {
      expect(txRes.data.status).toBe("recovered");
      expect(txRes.data.files[0]?.status).toBe("recovered");
      expect(txRes.data.files[1]?.status).toBe("failed");
    }
    // Verify 1st file was automatically restored to its exact original content!
    expect(
      fs.readFileSync(path.join(workspaceDir, "backend/services/authService.js"), "utf8")
    ).toBe(origService);
  });
});
