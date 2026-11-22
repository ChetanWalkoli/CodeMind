// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  type AskWhyAnswer,
  type DecisionConflict,
  type DecisionSearchResult,
  type DecisionSuggestion,
  type DecisionTimelineEntry,
  type EngineeringDecision,
  type IpcResponse
} from "@codemind/shared";
import { DecisionStore } from "../decisions/decisionStore.js";
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

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

describe("Phase 7 E2E — Decision Memory (Milestones 7.1–7.9)", () => {
  let wsA: string;
  let wsB: string;
  let dataDir: string;
  let ipcMain: MockIpcMain;
  let authority: WorkspaceAuthority;
  let decisionStore: DecisionStore;

  beforeEach(() => {
    wsA = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p7-wsA-"));
    wsB = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p7-wsB-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p7-data-"));

    writeFile(wsA, ".env", "GEMINI_API_KEY=AIzaSySecretDecision1234567890\n");
    writeFile(
      wsA,
      "package.json",
      JSON.stringify({ name: "demo", dependencies: { jsonwebtoken: "^9.0.0", zod: "^3.23.0" } })
    );
    writeFile(
      wsA,
      "src/auth/authMiddleware.ts",
      "export function verifyJwtToken(token: string): boolean {\n  return token.startsWith('eyJ');\n}\n"
    );
    writeFile(
      wsA,
      "src/auth/__tests__/authMiddleware.test.ts",
      "import { verifyJwtToken } from '../authMiddleware';\nexpect(verifyJwtToken('eyJ.a.b')).toBe(true);\n"
    );

    ipcMain = new MockIpcMain();
    authority = new WorkspaceAuthority();
    authority.authorizeRoot(wsA);
    authority.authorizeRoot(wsB);
    decisionStore = new DecisionStore(dataDir);

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
      decisionStore
    });
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(wsA, { recursive: true, force: true });
    fs.rmSync(wsB, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("completes full Decision Memory lifecycle: create, link evidence, persist, search, Ask Why, detect stale, revalidate, supersede, and isolate workspaces", async () => {
    // 1. Create decision with linked source file & test file + alternatives & tradeoffs
    const createRes = await ipcMain.invoke<EngineeringDecision>(IPC_CHANNELS.DECISION_CREATE, {
      workspaceRoot: wsA,
      title: "Use JWT authentication for API routes",
      summary: "Stateless signed JWT bearer tokens.",
      problem: "Avoid sticky session storage across desktop/API boundary.",
      decision: "Verify JWT tokens inside authMiddleware.ts.",
      rationale: "Stateless verification keeps API horizontally scalable.",
      status: "accepted",
      category: "authentication",
      tags: ["jwt", "auth"],
      alternatives: [
        {
          id: "alt-1",
          name: "Server-side sessions",
          description: "Redis session store",
          advantages: ["Immediate revocation"],
          disadvantages: ["Requires session store"],
          rejectionReason: "Unnecessary stateful dependency",
          evaluationStatus: "rejected"
        }
      ],
      tradeoffs: [
        {
          id: "tr-1",
          benefit: "Stateless verification",
          cost: "Short token TTL",
          risk: "Token theft window",
          acceptedCompromise: "15m access token expiry",
          longTermImplications: "Refresh token rotation",
          reconsiderConditions: "If instant global logout is required"
        }
      ],
      evidence: [
        {
          type: "source_file",
          filePath: "src/auth/authMiddleware.ts",
          startLine: 1,
          endLine: 3,
          description: "JWT verification middleware"
        },
        {
          type: "test",
          filePath: "src/auth/__tests__/authMiddleware.test.ts",
          description: "Unit test for JWT verification"
        }
      ]
    });

    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const decId = createRes.data.id;
    expect(createRes.data.verificationStatus).toBe("current");
    expect(createRes.data.confidence).toBe("verified");
    expect(createRes.data.evidence).toHaveLength(2);

    // 2. Workspace isolation: wsB must see 0 decisions
    const listB = await ipcMain.invoke<EngineeringDecision[]>(IPC_CHANNELS.DECISION_LIST, {
      workspaceRoot: wsB
    });
    expect(listB.ok && listB.data.length === 0).toBe(true);

    // 3. Reject secret file & path traversal evidence linking
    const secretLink = await ipcMain.invoke<EngineeringDecision>(
      IPC_CHANNELS.DECISION_LINK_EVIDENCE,
      {
        workspaceRoot: wsA,
        decisionId: decId,
        evidence: { type: "source_file", filePath: ".env", description: "bad secret" }
      }
    );
    expect(secretLink.ok).toBe(false);

    const traversalLink = await ipcMain.invoke<EngineeringDecision>(
      IPC_CHANNELS.DECISION_LINK_EVIDENCE,
      {
        workspaceRoot: wsA,
        decisionId: decId,
        evidence: { type: "source_file", filePath: "../outside.ts", description: "escape" }
      }
    );
    expect(traversalLink.ok).toBe(false);

    // 4. Read-only Git commit linking works safely even without .git initialized
    const commitRes = await ipcMain.invoke<EngineeringDecision>(IPC_CHANNELS.DECISION_LINK_COMMIT, {
      workspaceRoot: wsA,
      decisionId: decId,
      commitSha: "1234567abcdef"
    });
    expect(commitRes.ok).toBe(true);
    if (commitRes.ok) {
      expect(commitRes.data.gitReferences[0]?.shortSha).toBe("1234567");
      expect(commitRes.data.gitReferences[0]?.verified).toBe(false);
    }

    // 5. Search & Ask Why (deterministic, zero Gemini)
    const searchRes = await ipcMain.invoke<DecisionSearchResult[]>(IPC_CHANNELS.DECISION_SEARCH, {
      workspaceRoot: wsA,
      query: "Why does this project use JWT authentication?"
    });
    expect(searchRes.ok && searchRes.data[0]?.decision.id === decId).toBe(true);

    const askRes = await ipcMain.invoke<AskWhyAnswer>(IPC_CHANNELS.DECISION_ASK_WHY, {
      workspaceRoot: wsA,
      question: "Why is JWT verification implemented here?",
      filePath: "src/auth/authMiddleware.ts"
    });
    expect(askRes.ok && askRes.data.answered).toBe(true);
    if (askRes.ok) {
      expect(askRes.data.confidence).toBe("verified");
      expect(askRes.data.alternatives).toHaveLength(1);
    }

    // 6. Modify linked source file on disk -> detect stale evidence!
    writeFile(
      wsA,
      "src/auth/authMiddleware.ts",
      "export function verifyJwtToken(token: string): boolean {\n  return token.length > 20;\n}\n"
    );

    const verifyRes = await ipcMain.invoke<EngineeringDecision[]>(
      IPC_CHANNELS.DECISION_VERIFY_ALL,
      { workspaceRoot: wsA }
    );
    expect(verifyRes.ok).toBe(true);
    if (verifyRes.ok) {
      const updated = verifyRes.data.find((d) => d.id === decId);
      expect(updated?.verificationStatus).toBe("partially_stale");
      expect(updated?.evidence.some((e) => e.verificationStatus === "stale")).toBe(true);
    }

    // Timeline records evidence_stale event
    const timelineRes = await ipcMain.invoke<DecisionTimelineEntry[]>(
      IPC_CHANNELS.DECISION_TIMELINE,
      { workspaceRoot: wsA, order: "newest" }
    );
    expect(timelineRes.ok && timelineRes.data.some((e) => e.eventType === "evidence_stale")).toBe(
      true
    );

    // 7. Revalidate explicitly -> preserves historical stale evidence & creates fresh current evidence
    const revalRes = await ipcMain.invoke<EngineeringDecision>(IPC_CHANNELS.DECISION_REVALIDATE, {
      workspaceRoot: wsA,
      decisionId: decId,
      confirmedByDeveloper: true
    });
    expect(revalRes.ok).toBe(true);
    if (revalRes.ok) {
      expect(revalRes.data.verificationStatus).toBe("current");
      expect(revalRes.data.evidence.some((e) => e.isHistorical)).toBe(true);
    }

    // 8. Supersede & confirm invalid transition from superseded -> accepted is rejected
    const supRes = await ipcMain.invoke<EngineeringDecision>(
      IPC_CHANNELS.DECISION_TRANSITION_STATUS,
      { workspaceRoot: wsA, decisionId: decId, nextStatus: "superseded" }
    );
    expect(supRes.ok && supRes.data.status === "superseded").toBe(true);

    const badTransition = await ipcMain.invoke<EngineeringDecision>(
      IPC_CHANNELS.DECISION_TRANSITION_STATUS,
      { workspaceRoot: wsA, decisionId: decId, nextStatus: "accepted" }
    );
    expect(badTransition.ok).toBe(false);

    // 9. Deterministic suggestions & conflict detection
    const sugRes = await ipcMain.invoke<DecisionSuggestion[]>(IPC_CHANNELS.DECISION_SUGGEST, {
      workspaceRoot: wsA
    });
    expect(sugRes.ok && sugRes.data.some((s) => s.signalType === "dependency_change")).toBe(true);

    const confRes = await ipcMain.invoke<DecisionConflict[]>(
      IPC_CHANNELS.DECISION_DETECT_CONFLICTS,
      { workspaceRoot: wsA }
    );
    expect(confRes.ok).toBe(true);
  });

  it("handles corrupted decisions.json safely without crashing", async () => {
    const store = new DecisionStore(dataDir);
    const listBefore = store.loadDecisions(wsA);
    expect(listBefore).toEqual([]);

    // Save one valid record, then corrupt the file on disk
    const res = await ipcMain.invoke<EngineeringDecision>(IPC_CHANNELS.DECISION_CREATE, {
      workspaceRoot: wsA,
      title: "Valid record before corruption"
    });
    expect(res.ok).toBe(true);

    const dmDir = path.join(dataDir, "decision-memory");
    const subdirs = fs.readdirSync(dmDir);
    for (const sub of subdirs) {
      const decFile = path.join(dmDir, sub, "decisions.json");
      if (fs.existsSync(decFile)) {
        fs.writeFileSync(decFile, "{corrupt json!!!", "utf8");
      }
    }

    // Reloading corrupted store degrades safely to empty array instead of throwing
    const listAfter = await ipcMain.invoke<EngineeringDecision[]>(IPC_CHANNELS.DECISION_LIST, {
      workspaceRoot: wsA
    });
    expect(listAfter.ok).toBe(true);
    if (listAfter.ok) expect(listAfter.data).toEqual([]);
  });
});
