// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  type AIContextSnapshot,
  type ContextSearchCandidate,
  type IpcResponse,
  type ResolvedMissingFile
} from "@codemind/shared";
import { ProjectIndexer } from "@codemind/code-engine";
import { ContextApprovalStore } from "../ai/contextApprovalStore.js";
import { WorkspaceContextBuilder } from "../ai/contextBuilder.js";
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

function writeFile(root: string, relPath: string, content: string): void {
  const full = path.join(root, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function buildLargeLandingPage(): string {
  const heroSections: string[] = [
    'import Link from "next/link";',
    "export default function HomePage() {",
    "  // Marketing landing page showcasing the AI Quiz Generator features",
    "  const features = ["
  ];
  for (let i = 0; i < 180; i += 1) {
    heroSections.push(
      `    { id: ${i}, title: "AI Quiz Feature ${i}", description: "Generate instant interactive quizzes on quantum physics, history, and coding with customizable difficulty." },`
    );
  }
  heroSections.push(
    "  ];",
    '  return (<main><h1>AI Quiz Generator</h1><Link href="/quiz/generate">START GENERATING</Link>{features.map(f => <section key={f.id}>{f.title}</section>)}</main>);',
    "}"
  );
  return heroSections.join("\n");
}

function createFullStackFixture(root: string): void {
  // Secrets & ignored files (must NEVER be retrieved or resolved)
  writeFile(root, ".gitignore", "ignored/\n");
  writeFile(root, ".env", "GEMINI_API_KEY=AIzaSyBenchSecret1234567890\n");
  writeFile(root, "secrets.json", '{"apiKey":"top-secret"}');
  writeFile(root, "ignored/scratch.js", "export function generateQuiz() { return 'ignored'; }\n");

  // Large 25 KB marketing landing page (the exact file that previously crowded out the budget)
  writeFile(root, "frontend/src/app/page.js", buildLargeLandingPage());

  // Quiz detail page
  writeFile(
    root,
    "frontend/src/app/quiz/[id]/page.js",
    `export default function QuizViewerPage({ params }) {\n  return <div>Viewing quiz {params.id}</div>;\n}\n`
  );

  // Quiz generation feature page -> imports api client
  writeFile(
    root,
    "frontend/src/app/quiz/generate/page.js",
    `import { requestQuizGeneration } from "../../../lib/api";

export default function GenerateQuizPage() {
  async function handleSubmit(topic, difficulty, count) {
    const result = await requestQuizGeneration({ topic, difficulty, count });
    return result.quiz;
  }
  return <form onSubmit={() => handleSubmit("quantum physics", "medium", 10)} />;
}
`
  );

  // Frontend API client -> calls backend HTTP endpoints across the layer boundary
  writeFile(
    root,
    "frontend/src/lib/api.js",
    `export async function requestQuizGeneration(payload) {
  const res = await fetch("/api/quizzes/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function loginUser(credentials) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials)
  });
  return res.json();
}

export async function registerUser(payload) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function processPaymentCheckout(payload) {
  const res = await fetch("/api/payments/checkout", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return res.json();
}
`
  );

  // Backend Express server mounting routers
  writeFile(
    root,
    "backend/server.js",
    `import express from "express";
import quizRoutes from "./routes/quizRoutes";
import authRoutes from "./routes/authRoutes";
import paymentRoutes from "./routes/paymentRoutes";

const app = express();
app.use("/api/quizzes", quizRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentRoutes);
export default app;
`
  );

  // Quiz backend pipeline: route -> controller -> service
  writeFile(
    root,
    "backend/routes/quizRoutes.js",
    `import express from "express";
import { createGeneratedQuiz } from "../controllers/quizController";

const router = express.Router();
router.post("/generate", createGeneratedQuiz);
export default router;
`
  );

  writeFile(
    root,
    "backend/controllers/quizController.js",
    `import { generateQuizQuestions } from "../services/quizService";

export async function createGeneratedQuiz(req, res) {
  const { topic, difficulty, count } = req.body;
  const quiz = await generateQuizQuestions({ topic, difficulty, count });
  return res.status(201).json({ quiz });
}
`
  );

  writeFile(
    root,
    "backend/services/quizService.js",
    `export async function generateQuizQuestions({ topic, difficulty, count }) {
  const prompt = \`Generate \${count} \${difficulty} multiple-choice questions on \${topic}\`;
  return {
    topic,
    difficulty,
    prompt,
    questions: []
  };
}
`
  );

  // Auth & registration backend pipeline
  writeFile(
    root,
    "backend/routes/authRoutes.js",
    `import express from "express";
import { loginController, registerController } from "../controllers/authController";

const router = express.Router();
router.post("/login", loginController);
router.post("/register", registerController);
export default router;
`
  );

  writeFile(
    root,
    "backend/controllers/authController.js",
    `import { authenticateUser, registerNewAccount } from "../services/authService";

export async function loginController(req, res) {
  const session = await authenticateUser(req.body.email, req.body.password);
  return res.json(session);
}

export async function registerController(req, res) {
  const account = await registerNewAccount(req.body);
  return res.status(201).json(account);
}
`
  );

  writeFile(
    root,
    "backend/services/authService.js",
    `export async function authenticateUser(email, password) {
  return { email, authenticated: Boolean(password) };
}

export async function registerNewAccount({ email, name }) {
  return { id: "u-1", email, name };
}
`
  );

  // Payments backend pipeline
  writeFile(
    root,
    "backend/routes/paymentRoutes.js",
    `import express from "express";
import { checkoutController } from "../controllers/paymentController";

const router = express.Router();
router.post("/checkout", checkoutController);
export default router;
`
  );

  writeFile(
    root,
    "backend/controllers/paymentController.js",
    `import { chargePayment } from "../services/paymentService";

export async function checkoutController(req, res) {
  const receipt = await chargePayment(req.body.amountCents, req.body.currency);
  return res.json(receipt);
}
`
  );

  writeFile(
    root,
    "backend/services/paymentService.js",
    `export async function chargePayment(amountCents, currency) {
  return { status: "paid", amountCents, currency };
}
`
  );

  // Shared schema & unit test
  writeFile(
    root,
    "shared/schemas/quiz.schema.ts",
    `export interface QuizGenerationRequest {
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  count: number;
}
`
  );

  writeFile(
    root,
    "backend/__tests__/quiz.test.js",
    `import { generateQuizQuestions } from "../services/quizService";
describe("quizService", () => {
  it("generates questions", async () => {
    await generateQuizQuestions({ topic: "math", difficulty: "easy", count: 5 });
  });
});
`
  );
}

describe("Context Retrieval Intelligence — Full-Stack Benchmark, Security & Performance", () => {
  let workspaceDir: string;
  let prefsDir: string;
  let ipcMain: MockIpcMain;
  let authority: WorkspaceAuthority;
  let approvalStore: ContextApprovalStore;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-bench-ws-"));
    prefsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-bench-prefs-"));
    createFullStackFixture(workspaceDir);

    ipcMain = new MockIpcMain();
    authority = new WorkspaceAuthority();
    approvalStore = new ContextApprovalStore();
    authority.authorizeRoot(workspaceDir);

    registerIpcHandlers(ipcMain, {
      metadata: {
        name: "CodeMind",
        version: "0.1.0",
        platform: "win32",
        arch: "x64",
        electronVersion: "45.4.1",
        nodeVersion: "24.0.0",
        chromeVersion: "156.0.0"
      },
      preferences: new PreferencesStore(prefsDir),
      authority,
      approvalStore
    });
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(prefsDir, { recursive: true, force: true });
  });

  it("retrieves the full-stack quiz generation pipeline for both clean and misspelled queries", async () => {
    const queries = ["How does quiz generation work?", "how quiz are genrates in that project ?"];

    for (const query of queries) {
      const res = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
        workspaceRoot: workspaceDir,
        taskType: "explain-codebase",
        query,
        includeDependencies: true
      });

      expect(res.ok).toBe(true);
      if (!res.ok) continue;

      const includedPaths = res.data.items.map((item) => item.filePath);

      // Must retrieve the full-stack implementation across frontend & backend!
      expect(includedPaths).toContain("frontend/src/app/quiz/generate/page.js");
      expect(includedPaths).toContain("frontend/src/lib/api.js");
      expect(includedPaths).toContain("backend/routes/quizRoutes.js");
      expect(includedPaths).toContain("backend/controllers/quizController.js");
      expect(includedPaths).toContain("backend/services/quizService.js");

      // Backend implementation must outrank the 25 KB marketing landing page
      const serviceIdx = includedPaths.indexOf("backend/services/quizService.js");
      const landingIdx = includedPaths.indexOf("frontend/src/app/page.js");
      if (landingIdx !== -1) {
        expect(serviceIdx).toBeLessThan(landingIdx);
      }

      // Secret & ignored files must NEVER appear
      expect(includedPaths).not.toContain(".env");
      expect(includedPaths).not.toContain("secrets.json");
      expect(includedPaths).not.toContain("ignored/scratch.js");

      // Coverage metrics must be populated
      expect(res.data.coverage).toBeDefined();
      expect(res.data.coverage?.includedFiles).toBe(res.data.items.length);
      expect(res.data.budgetBytes).toBe(128 * 1024);
    }
  });

  it("retrieves the correct implementation pipelines for auth, payments, registration, debugging, and UI queries", async () => {
    const cases: Array<{ query: string; expectedPaths: string[]; expectedIntent: string }> = [
      {
        query: "How does authentication work?",
        expectedPaths: [
          "backend/routes/authRoutes.js",
          "backend/controllers/authController.js",
          "backend/services/authService.js"
        ],
        expectedIntent: "implementation"
      },
      {
        query: "Where are payments processed?",
        expectedPaths: [
          "backend/routes/paymentRoutes.js",
          "backend/controllers/paymentController.js",
          "backend/services/paymentService.js"
        ],
        expectedIntent: "implementation"
      },
      {
        query: "How does user registration work?",
        expectedPaths: [
          "backend/routes/authRoutes.js",
          "backend/controllers/authController.js",
          "backend/services/authService.js"
        ],
        expectedIntent: "implementation"
      },
      {
        query: "Why is quiz generation failing?",
        expectedPaths: ["backend/controllers/quizController.js", "backend/services/quizService.js"],
        expectedIntent: "debugging"
      },
      {
        query: "Explain the quiz generation UI form and layout.",
        expectedPaths: ["frontend/src/app/quiz/generate/page.js"],
        expectedIntent: "ui"
      }
    ];

    for (const tc of cases) {
      const res = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
        workspaceRoot: workspaceDir,
        taskType: "explain-codebase",
        query: tc.query,
        includeDependencies: true
      });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;

      const paths = res.data.items.map((i) => i.filePath);
      for (const expected of tc.expectedPaths) {
        expect(paths).toContain(expected);
      }
      expect(res.data.coverage?.queryIntent).toBe(tc.expectedIntent);
    }
  });

  it("applies symbol-level slicing for oversized files while preserving full-file SHA-256 contentHash", async () => {
    const fillerLines: string[] = [];
    for (let i = 0; i < 320; i += 1) {
      fillerLines.push(`// Boilerplate documentation header line ${i} padding text for size`);
    }
    fillerLines.push(
      "export function computeQuantumQuizScore(answers) {",
      "  return answers.filter((a) => a.correct).length * 10;",
      "}"
    );
    const oversizedContent = fillerLines.join("\n");
    writeFile(workspaceDir, "backend/services/scoringEngine.js", oversizedContent);

    const indexer = new ProjectIndexer(workspaceDir);
    await indexer.indexWorkspace();
    const builder = new WorkspaceContextBuilder(authority);

    const snapshot = builder.buildSnapshot({
      authorizedRoot: workspaceDir,
      indexer,
      request: {
        workspaceRoot: workspaceDir,
        taskType: "code-qa",
        query: "How does computeQuantumQuizScore work?",
        perFileMaxBytes: 4096,
        includeDependencies: false
      }
    });

    const item = snapshot.items.find((i) => i.filePath === "backend/services/scoringEngine.js");
    expect(item).toBeDefined();
    expect(item?.truncated).toBe(true);
    expect(item?.startLine).toBeGreaterThan(200);
    expect(item?.content).toContain("computeQuantumQuizScore");
    expect(item?.byteLength).toBeLessThanOrEqual(4096);

    const expectedFullHash = crypto
      .createHash("sha256")
      .update(Buffer.from(oversizedContent, "utf8"))
      .digest("hex");
    expect(item?.contentHash).toBe(expectedFullHash);
  });

  it("enforces security in manual file search, missing-file resolution, and snapshot approval invalidation", async () => {
    // 1. Search indexed files for manual Add Files picker
    const searchRes = await ipcMain.invoke<ContextSearchCandidate[]>(
      IPC_CHANNELS.AI_SEARCH_CONTEXT_FILES,
      {
        workspaceRoot: workspaceDir,
        query: "quiz",
        limit: 15
      }
    );
    expect(searchRes.ok).toBe(true);
    if (searchRes.ok) {
      const paths = searchRes.data.map((c) => c.filePath);
      expect(paths).toContain("backend/services/quizService.js");
      expect(paths).not.toContain(".env");
    }

    // 2. Resolve missing file suggestions (exact, directory, basename, secret, traversal, not-found)
    const resolveRes = await ipcMain.invoke<ResolvedMissingFile[]>(
      IPC_CHANNELS.AI_RESOLVE_MISSING_FILES,
      {
        workspaceRoot: workspaceDir,
        includedFilePaths: ["frontend/src/app/page.js"],
        suggestedPaths: [
          "backend/routes/quizRoutes.js",
          "backend/controllers/",
          "quizService.js",
          "frontend/src/app/page.js",
          ".env",
          "../outside.txt",
          "/etc/passwd",
          "ignored/scratch.js",
          "backend/doesNotExist.js"
        ]
      }
    );
    expect(resolveRes.ok).toBe(true);
    if (resolveRes.ok) {
      const byReq = (req: string) => resolveRes.data.find((r) => r.requestedPath === req);
      expect(byReq("backend/routes/quizRoutes.js")?.status).toBe("exact-match");
      expect(byReq("backend/controllers/")?.status).toBe("similar-match");
      expect(byReq("quizService.js")?.status).toBe("similar-match");
      expect(byReq("quizService.js")?.resolvedPath).toBe("backend/services/quizService.js");
      expect(byReq("frontend/src/app/page.js")?.status).toBe("already-included");
      expect(byReq(".env")?.status).toBe("excluded-security");
      expect(byReq("../outside.txt")?.status).toBe("excluded-security");
      expect(byReq("/etc/passwd")?.status).toBe("excluded-security");
      expect(byReq("ignored/scratch.js")?.status).toBe("excluded-security");
      expect(byReq("backend/doesNotExist.js")?.status).toBe("not-found");
    }

    // 3. Build, approve, then manually add a file -> snapshotId changes and prior approval does not carry over
    const snap1 = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "How does quiz generation work?"
    });
    expect(snap1.ok).toBe(true);
    if (!snap1.ok) return;

    const approve1 = await ipcMain.invoke(IPC_CHANNELS.AI_APPROVE_CONTEXT, {
      workspaceRoot: workspaceDir,
      snapshotId: snap1.data.snapshotId,
      approved: true
    });
    expect(approve1.ok).toBe(true);

    const snap2 = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "How does quiz generation work?",
      explicitFilePaths: ["shared/schemas/quiz.schema.ts", ".env", "../escape.js"]
    });
    expect(snap2.ok).toBe(true);
    if (!snap2.ok) return;

    expect(snap2.data.snapshotId).not.toBe(snap1.data.snapshotId);
    expect(snap2.data.items.map((i) => i.filePath)).toContain("shared/schemas/quiz.schema.ts");
    expect(snap2.data.items.map((i) => i.filePath)).not.toContain(".env");
    expect(snap2.data.items.map((i) => i.filePath)).not.toContain("../escape.js");

    const approval2 = await ipcMain.invoke<{ approved: boolean }>(
      IPC_CHANNELS.AI_GET_CONTEXT_APPROVAL,
      {
        workspaceRoot: workspaceDir,
        snapshotId: snap2.data.snapshotId
      }
    );
    expect(approval2.ok).toBe(true);
    if (approval2.ok) {
      expect(approval2.data.approved).toBe(false);
    }
  });

  it("maintains fast indexing and retrieval latency on a 200-file repository", async () => {
    const perfDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-perf-ws-"));
    try {
      for (let i = 0; i < 200; i += 1) {
        writeFile(
          perfDir,
          `src/modules/module${i}/service${i}.ts`,
          `export function processModule${i}Item(input: string): string {\n  return \`\${input}-${i}\`;\n}\n`
        );
      }
      writeFile(
        perfDir,
        "src/services/quizGenerationEngine.ts",
        `export function generateQuizBatch(topic: string) {\n  return { topic, items: [] };\n}\n`
      );

      const perfAuth = new WorkspaceAuthority();
      perfAuth.authorizeRoot(perfDir);
      const indexer = new ProjectIndexer(perfDir);

      const t0 = performance.now();
      await indexer.indexWorkspace();
      const indexMs = performance.now() - t0;

      const builder = new WorkspaceContextBuilder(perfAuth);
      const t1 = performance.now();
      const snapshot = builder.buildSnapshot({
        authorizedRoot: perfDir,
        indexer,
        request: {
          workspaceRoot: perfDir,
          taskType: "explain-codebase",
          query: "how quiz are genrates in that project ?",
          includeDependencies: true
        }
      });
      const retrieveMs = performance.now() - t1;

      expect(snapshot.items.map((i) => i.filePath)).toContain(
        "src/services/quizGenerationEngine.ts"
      );
      expect(indexMs).toBeLessThan(10_000);
      expect(retrieveMs).toBeLessThan(1_000);
    } finally {
      fs.rmSync(perfDir, { recursive: true, force: true });
    }
  });
});
