import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  IntentSessionSchema,
  type IntentAuditEvent,
  type IntentSession,
  type IntentSessionSummary
} from "@codemind/shared";

function workspaceStorageKey(workspaceRoot: string): string {
  return crypto.createHash("sha256").update(workspaceRoot.toLowerCase()).digest("hex").slice(0, 16);
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function atomicWriteJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Local-first persistence for Intent Mode sessions and isolated pre-change recovery snapshots.
 * Stores session state under `<baseDir>/intent-sessions/<workspaceHash>/` and binary-safe
 * pre-change file backups under `<baseDir>/intent-snapshots/<transactionId>/`.
 */
export class IntentStore {
  private readonly sessionsDir: string;
  private readonly snapshotsDir: string;

  constructor(baseDir: string) {
    this.sessionsDir = path.join(baseDir, "intent-sessions");
    this.snapshotsDir = path.join(baseDir, "intent-snapshots");
  }

  private getWorkspaceDir(workspaceRoot: string): string {
    return path.join(this.sessionsDir, workspaceStorageKey(workspaceRoot));
  }

  private getSessionPath(workspaceRoot: string, intentId: string): string {
    const safeId = sanitizeId(intentId);
    if (!safeId) {
      throw new Error("Invalid intentId.");
    }
    return path.join(this.getWorkspaceDir(workspaceRoot), `${safeId}.json`);
  }

  public saveSession(workspaceRoot: string, session: IntentSession): IntentSession {
    const validated = IntentSessionSchema.parse(session);
    const filePath = this.getSessionPath(workspaceRoot, validated.intent.intentId);
    atomicWriteJson(filePath, validated);
    return validated;
  }

  public getSession(workspaceRoot: string, intentId: string): IntentSession | null {
    const filePath = this.getSessionPath(workspaceRoot, intentId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return IntentSessionSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  public listSessions(workspaceRoot: string): IntentSessionSummary[] {
    const dir = this.getWorkspaceDir(workspaceRoot);
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const summaries: IntentSessionSummary[] = [];

    for (const file of entries) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), "utf8");
        const parsed = IntentSessionSchema.parse(JSON.parse(raw));
        summaries.push({
          intentId: parsed.intent.intentId,
          workspaceId: parsed.intent.workspaceId,
          normalizedGoal: parsed.intent.normalizedGoal,
          intentType: parsed.intent.intentType,
          status: parsed.intent.status,
          confidence: parsed.intent.confidence,
          patchCount: parsed.patches.length,
          transactionCount: parsed.transactions.length,
          createdAt: parsed.intent.createdAt,
          updatedAt: parsed.intent.updatedAt
        });
      } catch {
        // Skip unreadable/corrupt session file without crashing
      }
    }

    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public deleteSession(workspaceRoot: string, intentId: string): boolean {
    const filePath = this.getSessionPath(workspaceRoot, intentId);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  public appendAuditEvent(
    workspaceRoot: string,
    session: IntentSession,
    stage: string,
    action: string,
    summary: string
  ): IntentSession {
    const event: IntentAuditEvent = {
      id: crypto.randomUUID(),
      stage,
      action,
      summary,
      timestamp: new Date().toISOString()
    };
    const updated: IntentSession = {
      ...session,
      auditEvents: [...session.auditEvents.slice(-199), event]
    };
    return this.saveSession(workspaceRoot, updated);
  }

  // ---- Isolated Pre-Change Recovery Snapshot Storage (Milestones 6.7 & 6.9) ----

  public writeRecoverySnapshot(
    transactionId: string,
    targetFile: string,
    contentBuffer: Buffer
  ): { snapshotFileName: string; snapshotHash: string } {
    const safeTx = sanitizeId(transactionId);
    const txDir = path.join(this.snapshotsDir, safeTx);
    fs.mkdirSync(txDir, { recursive: true });

    const fileKey = crypto.createHash("sha256").update(targetFile).digest("hex").slice(0, 16);
    const snapshotFileName = `${fileKey}.bak`;
    const snapshotPath = path.join(txDir, snapshotFileName);

    const tmpPath = `${snapshotPath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmpPath, contentBuffer);
    fs.renameSync(tmpPath, snapshotPath);

    const snapshotHash = crypto.createHash("sha256").update(contentBuffer).digest("hex");
    return { snapshotFileName, snapshotHash };
  }

  public readRecoverySnapshot(transactionId: string, snapshotFileName: string): Buffer | null {
    const safeTx = sanitizeId(transactionId);
    const safeName = path.basename(snapshotFileName);
    const snapshotPath = path.join(this.snapshotsDir, safeTx, safeName);
    if (!fs.existsSync(snapshotPath)) return null;
    try {
      return fs.readFileSync(snapshotPath);
    } catch {
      return null;
    }
  }
}
