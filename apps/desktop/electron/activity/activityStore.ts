import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "@codemind/ai-core";
import {
  ACTIVITY_SCHEMA_VERSION,
  ActivityEventSchema,
  type ActivityEvent,
  type ActivityEventType,
  type ActivityFeature,
  type ActivityStatus
} from "@codemind/shared";

const MAX_ACTIVITY_EVENTS = 200;

function workspaceHash(workspaceRoot: string): string {
  return crypto.createHash("sha256").update(workspaceRoot.toLowerCase()).digest("hex").slice(0, 16);
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export interface RecordActivityInput {
  workspaceRoot: string;
  eventType: ActivityEventType;
  feature: ActivityFeature;
  summary: string;
  relatedRecordId?: string;
  relatedFiles?: string[];
  status?: ActivityStatus;
}

/**
 * Local-first, workspace-isolated Activity & Engineering History store (Milestone 9.4).
 * Storage layout: `<baseDir>/activity-history/<workspaceHash>/events.json`.
 * Never stores secrets, credentials, or source file contents.
 * Authoritative records remain in their respective feature stores.
 */
export class ActivityStore {
  private readonly rootDir: string;

  constructor(baseDir: string) {
    this.rootDir = path.join(baseDir, "activity-history");
  }

  private getEventsPath(workspaceRoot: string): string {
    return path.join(this.rootDir, workspaceHash(workspaceRoot), "events.json");
  }

  public loadAll(workspaceRoot: string): ActivityEvent[] {
    const filePath = this.getEventsPath(workspaceRoot);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      const valid: ActivityEvent[] = [];
      for (const entry of raw) {
        const parsed = ActivityEventSchema.safeParse(entry);
        if (parsed.success) {
          valid.push(parsed.data);
        }
      }
      return valid.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch {
      return [];
    }
  }

  public record(input: RecordActivityInput): ActivityEvent {
    const wsId = workspaceHash(input.workspaceRoot);
    const safeSummary = redactSecrets(input.summary).slice(0, 300);
    const safeFiles = (input.relatedFiles ?? [])
      .map((f) => f.replace(/\\/g, "/").replace(/^\.\/+/, ""))
      .filter((f) => f.length > 0 && !f.toLowerCase().includes(".env"))
      .slice(0, 20);

    const event: ActivityEvent = ActivityEventSchema.parse({
      id: `act-${crypto.randomBytes(6).toString("hex")}`,
      workspaceId: wsId,
      eventType: input.eventType,
      timestamp: new Date().toISOString(),
      feature: input.feature,
      relatedRecordId: input.relatedRecordId,
      relatedFiles: safeFiles,
      summary: safeSummary,
      status: input.status ?? "success",
      schemaVersion: ACTIVITY_SCHEMA_VERSION
    });

    const existing = this.loadAll(input.workspaceRoot);
    const next = [event, ...existing].slice(0, MAX_ACTIVITY_EVENTS);
    atomicWriteJson(this.getEventsPath(input.workspaceRoot), next);
    return event;
  }

  public list(
    workspaceRoot: string,
    opts?: { feature?: ActivityFeature; query?: string; limit?: number }
  ): ActivityEvent[] {
    let events = this.loadAll(workspaceRoot);
    if (opts?.feature) {
      events = events.filter((e) => e.feature === opts.feature);
    }
    if (opts?.query && opts.query.trim()) {
      const q = opts.query.trim().toLowerCase();
      events = events.filter(
        (e) =>
          e.summary.toLowerCase().includes(q) ||
          e.eventType.toLowerCase().includes(q) ||
          e.relatedFiles.some((f) => f.toLowerCase().includes(q))
      );
    }
    const limit = Math.max(1, Math.min(MAX_ACTIVITY_EVENTS, opts?.limit ?? 100));
    return events.slice(0, limit);
  }

  public clear(workspaceRoot: string): boolean {
    const filePath = this.getEventsPath(workspaceRoot);
    if (!fs.existsSync(filePath)) return false;
    atomicWriteJson(filePath, []);
    return true;
  }

  public count(workspaceRoot: string): number {
    return this.loadAll(workspaceRoot).length;
  }
}
