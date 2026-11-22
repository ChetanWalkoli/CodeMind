import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DECISION_SCHEMA_VERSION,
  DecisionSuggestionSchema,
  EngineeringDecisionSchema,
  type DecisionSuggestion,
  type EngineeringDecision
} from "@codemind/shared";

function workspaceHash(workspaceRoot: string): string {
  return crypto.createHash("sha256").update(workspaceRoot.toLowerCase()).digest("hex").slice(0, 16);
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Local-first, workspace-isolated persistence for Decision Memory (Milestones 7.1 & 14).
 * Storage layout: `<baseDir>/decision-memory/<workspaceHash>/{decisions.json, suggestions.json, metadata.json}`.
 * Validates every loaded record with Zod and recovers safely from malformed/corrupt entries.
 */
export class DecisionStore {
  private readonly rootDir: string;

  constructor(baseDir: string) {
    this.rootDir = path.join(baseDir, "decision-memory");
  }

  private getWorkspaceDir(workspaceRoot: string): string {
    return path.join(this.rootDir, workspaceHash(workspaceRoot));
  }

  private getDecisionsPath(workspaceRoot: string): string {
    return path.join(this.getWorkspaceDir(workspaceRoot), "decisions.json");
  }

  private getSuggestionsPath(workspaceRoot: string): string {
    return path.join(this.getWorkspaceDir(workspaceRoot), "suggestions.json");
  }

  private getMetadataPath(workspaceRoot: string): string {
    return path.join(this.getWorkspaceDir(workspaceRoot), "metadata.json");
  }

  private writeMetadata(workspaceRoot: string, decisionCount: number): void {
    atomicWriteJson(this.getMetadataPath(workspaceRoot), {
      schemaVersion: DECISION_SCHEMA_VERSION,
      workspaceHash: workspaceHash(workspaceRoot),
      decisionCount,
      updatedAt: new Date().toISOString()
    });
  }

  public loadDecisions(workspaceRoot: string): EngineeringDecision[] {
    const filePath = this.getDecisionsPath(workspaceRoot);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      const valid: EngineeringDecision[] = [];
      for (const entry of raw) {
        const parsed = EngineeringDecisionSchema.safeParse(entry);
        if (parsed.success) {
          valid.push(parsed.data);
        }
      }
      return valid.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  public saveDecisions(workspaceRoot: string, decisions: EngineeringDecision[]): void {
    const validated = decisions.map((d) => EngineeringDecisionSchema.parse(d));
    atomicWriteJson(this.getDecisionsPath(workspaceRoot), validated);
    this.writeMetadata(workspaceRoot, validated.length);
  }

  public upsertDecision(workspaceRoot: string, decision: EngineeringDecision): EngineeringDecision {
    const validated = EngineeringDecisionSchema.parse(decision);
    const existing = this.loadDecisions(workspaceRoot);
    const idx = existing.findIndex((d) => d.id === validated.id);
    if (idx >= 0) {
      existing[idx] = validated;
    } else {
      existing.unshift(validated);
    }
    this.saveDecisions(workspaceRoot, existing);
    return validated;
  }

  public getDecision(workspaceRoot: string, decisionId: string): EngineeringDecision | null {
    return this.loadDecisions(workspaceRoot).find((d) => d.id === decisionId) ?? null;
  }

  public deleteDecision(workspaceRoot: string, decisionId: string): boolean {
    const existing = this.loadDecisions(workspaceRoot);
    const filtered = existing.filter((d) => d.id !== decisionId);
    if (filtered.length === existing.length) return false;
    this.saveDecisions(workspaceRoot, filtered);
    return true;
  }

  public loadSuggestions(workspaceRoot: string): DecisionSuggestion[] {
    const filePath = this.getSuggestionsPath(workspaceRoot);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      const valid: DecisionSuggestion[] = [];
      for (const entry of raw) {
        const parsed = DecisionSuggestionSchema.safeParse(entry);
        if (parsed.success) valid.push(parsed.data);
      }
      return valid;
    } catch {
      return [];
    }
  }

  public saveSuggestions(workspaceRoot: string, suggestions: DecisionSuggestion[]): void {
    const validated = suggestions.map((s) => DecisionSuggestionSchema.parse(s));
    atomicWriteJson(this.getSuggestionsPath(workspaceRoot), validated);
  }
}
