import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectIndexer } from "@codemind/code-engine";
import { ActivityStore } from "../activity/activityStore.js";
import { CredentialStore, type SafeStorageAdapter } from "../ai/credentialStore.js";
import { DecisionManager } from "../decisions/decisionManager.js";
import { DecisionStore } from "../decisions/decisionStore.js";
import { ImpactManager } from "../impact/impactManager.js";
import { ImpactStore } from "../impact/impactStore.js";
import { IntentStore } from "../intent/intentStore.js";
import { VerificationEngine } from "../intent/verificationEngine.js";
import { createActivityAndDiagnosticsHandlers } from "../ipc/handlers/activity.handler.js";
import { CodeEngineManager } from "../ipc/handlers/engine.handler.js";
import { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceAuthority } from "../workspace/pathSecurity.js";

const MOCK_SAFE_STORAGE: SafeStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => Buffer.from(`enc:${plain}`, "utf8"),
  decryptString: (buf: Buffer) => buf.toString("utf8").replace(/^enc:/, "")
};

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

describe("Phase 9 — Cross-Feature Product Integration & Infrastructure E2E", () => {
  let wsA: string;
  let wsB: string;
  let storageDir: string;

  beforeEach(() => {
    wsA = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p9-wsA-"));
    wsB = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p9-wsB-"));
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p9-store-"));

    writeFile(
      wsA,
      "src/auth.ts",
      `export function verifyToken(token: string) { return token.length > 0; }\n`
    );
    writeFile(
      wsA,
      "src/routes.ts",
      `import { verifyToken } from "./auth";\nexport function handleReq(t: string) { return verifyToken(t); }\n`
    );
    writeFile(wsB, "src/other.ts", `export const other = true;\n`);
  });

  afterEach(() => {
    fs.rmSync(wsA, { recursive: true, force: true });
    fs.rmSync(wsB, { recursive: true, force: true });
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it("connects Understand -> Improve -> Remember -> Predict -> Activity -> Diagnostics with strict workspace isolation", async () => {
    const authority = new WorkspaceAuthority();
    const realWsA = authority.authorizeRoot(wsA);
    const realWsB = authority.authorizeRoot(wsB);

    const preferences = new PreferencesStore(storageDir);
    const credentials = new CredentialStore(storageDir, MOCK_SAFE_STORAGE);
    credentials.setApiKey("gemini", "AIzaSyFAKE_SECRET_KEY_NEVER_LEAK_123456");

    const engineManager = new CodeEngineManager();
    const indexerA = new ProjectIndexer(realWsA);
    await indexerA.indexWorkspace();

    const intentStore = new IntentStore(storageDir);
    const decisionStore = new DecisionStore(storageDir);
    const impactStore = new ImpactStore(storageDir);
    const activityStore = new ActivityStore(storageDir);

    const decisionManager = new DecisionManager({
      authority,
      store: decisionStore,
      engineManager,
      preferences,
      intentStore
    });

    const impactManager = new ImpactManager({
      workspaceAuthority: authority,
      impactStore,
      decisionManager,
      verificationEngine: new VerificationEngine(authority),
      getIndexer: (root) => (root === realWsA ? indexerA : null)
    });

    // 1. Record workspace & index activity
    activityStore.record({
      workspaceRoot: realWsA,
      eventType: "workspace_opened",
      feature: "workspace",
      summary: "Opened workspace A"
    });
    activityStore.record({
      workspaceRoot: realWsA,
      eventType: "codebase_indexed",
      feature: "understand",
      summary: `Indexed ${indexerA.getAllFilePaths().length} files`
    });

    // 2. Capture decision as draft (proposed) -> developer explicitly accepts
    const draft = await decisionManager.createDecision({
      workspaceRoot: realWsA,
      title: "Centralize token validation in src/auth.ts",
      summary: "All route handlers must call verifyToken",
      context: "Prevent inconsistent auth checks",
      problem: "Duplicated token checks",
      decision: "Use src/auth.ts verifyToken",
      rationale: "Single audited security boundary",
      category: "security",
      status: "proposed",
      tags: ["auth"],
      evidence: [
        {
          type: "source_file",
          filePath: "src/auth.ts",
          description: "verifyToken implementation",
          provenance: "verified_evidence"
        }
      ]
    });
    expect(draft.status).toBe("proposed");

    const accepted = await decisionManager.transitionStatus({
      workspaceRoot: realWsA,
      decisionId: draft.id,
      nextStatus: "accepted"
    });
    expect(accepted.status).toBe("accepted");

    // 3. Run Change Impact Analysis on src/auth.ts -> links direct dependent + accepted decision
    const impact = await impactManager.analyzeChangeImpact({
      workspaceRoot: realWsA,
      targets: [{ filePath: "src/auth.ts" }],
      changeType: "symbol_modified",
      maxDepth: 3,
      maxAffectedFiles: 50
    });
    expect(impact.impactedFiles.some((f) => f.filePath === "src/routes.ts")).toBe(true);
    expect(impact.relatedDecisions.some((d) => d.decisionId === accepted.id)).toBe(true);

    // 4. Modify src/auth.ts -> verify impact report becomes stale
    writeFile(
      wsA,
      "src/auth.ts",
      `export function verifyToken(token: string) { return token.startsWith("v2_"); }\n`
    );
    const staleReport = impactManager.checkFreshness(realWsA, impact.analysisId);
    expect(staleReport?.status).toBe("stale");
    expect(staleReport?.staleFiles).toContain("src/auth.ts");

    // 5. Verify workspace isolation: Workspace B sees zero activity, decisions, or impacts from A
    expect(activityStore.list(realWsB)).toHaveLength(0);
    expect(decisionManager.listDecisions(realWsB)).toHaveLength(0);
    expect(impactManager.listAnalyses(realWsB)).toHaveLength(0);

    // 6. Verify App Preferences persistence & immutable safety flags
    const handlers = createActivityAndDiagnosticsHandlers({
      authority,
      activityStore,
      preferences,
      metadata: {
        name: "CodeMind",
        version: "0.1.0",
        platform: process.platform,
        arch: process.arch,
        electronVersion: "45.4.1",
        nodeVersion: process.version,
        chromeVersion: "130.0.0"
      },
      engineManager,
      credentials,
      decisionStore,
      impactStore
    });

    const prefUpdate = await handlers.updateAppPreferences({
      editorFontSize: 15,
      onboardingCompleted: true,
      reopenLastWorkspace: false
    });
    expect(prefUpdate.ok).toBe(true);
    if (prefUpdate.ok) {
      expect(prefUpdate.data.editorFontSize).toBe(15);
      expect(prefUpdate.data.onboardingCompleted).toBe(true);
      expect(prefUpdate.data.confirmBeforePatchApply).toBe(true);
      expect(prefUpdate.data.confirmBeforeCommandRun).toBe(true);
    }

    // 7. Verify Redacted Diagnostics never leaks API keys, source contents, or full workspace paths
    const diagRes = await handlers.getDiagnostics({ workspaceRoot: realWsA });
    expect(diagRes.ok).toBe(true);
    if (diagRes.ok) {
      const serialized = JSON.stringify(diagRes.data);
      expect(serialized).not.toContain("AIzaSyFAKE_SECRET_KEY");
      expect(serialized).not.toContain("verifyToken");
      expect(serialized).not.toContain(realWsA);
      expect(diagRes.data.persistence.localFirst).toBe(true);
      expect(diagRes.data.persistence.cloudSyncEnabled).toBe(false);
      expect(diagRes.data.ai.configured).toBe(true);
      expect(diagRes.data.persistence.decisionsCount).toBe(1);
      expect(diagRes.data.persistence.impactAnalysesCount).toBe(1);
      expect(diagRes.data.persistence.activityEventsCount).toBe(2);
    }
  });
});
