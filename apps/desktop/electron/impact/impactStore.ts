import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  IMPACT_SCHEMA_VERSION,
  ImpactAnalysisResultSchema,
  type ImpactAnalysisResult,
  type ImpactAnalysisSummary
} from "@codemind/shared";

const MAX_STORED_ANALYSES = 40;

function workspaceHash(workspaceRoot: string): string {
  return crypto.createHash("sha256").update(workspaceRoot.toLowerCase()).digest("hex").slice(0, 16);
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function toImpactSummary(result: ImpactAnalysisResult): ImpactAnalysisSummary {
  return {
    analysisId: result.analysisId,
    targetFiles: result.analyzedTargets.map((t) => t.filePath),
    changeType: result.changeType,
    status: result.status,
    riskLevel: result.risk.level,
    riskScore: result.risk.score,
    impactedFileCount: result.impactedFiles.length,
    impactedTestCount: result.impactedTests.length,
    relatedDecisionCount: result.relatedDecisions.length,
    createdAt: result.createdAt
  };
}

/**
 * Local-first, workspace-isolated persistence for Phase 8 Change Impact Analyses.
 * Storage layout: `<baseDir>/impact-analyses/<workspaceHash>/{analyses.json, metadata.json}`.
 */
export class ImpactStore {
  private readonly rootDir: string;

  constructor(baseDir: string) {
    this.rootDir = path.join(baseDir, "impact-analyses");
  }

  private getWorkspaceDir(workspaceRoot: string): string {
    return path.join(this.rootDir, workspaceHash(workspaceRoot));
  }

  private getAnalysesPath(workspaceRoot: string): string {
    return path.join(this.getWorkspaceDir(workspaceRoot), "analyses.json");
  }

  private getMetadataPath(workspaceRoot: string): string {
    return path.join(this.getWorkspaceDir(workspaceRoot), "metadata.json");
  }

  private writeMetadata(workspaceRoot: string, count: number): void {
    atomicWriteJson(this.getMetadataPath(workspaceRoot), {
      schemaVersion: IMPACT_SCHEMA_VERSION,
      workspaceHash: workspaceHash(workspaceRoot),
      analysisCount: count,
      updatedAt: new Date().toISOString()
    });
  }

  public loadAll(workspaceRoot: string): ImpactAnalysisResult[] {
    const filePath = this.getAnalysesPath(workspaceRoot);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      const valid: ImpactAnalysisResult[] = [];
      for (const entry of raw) {
        const parsed = ImpactAnalysisResultSchema.safeParse(entry);
        if (parsed.success) {
          valid.push(parsed.data);
        }
      }
      return valid.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  private saveAll(workspaceRoot: string, items: ImpactAnalysisResult[]): void {
    const trimmed = [...items]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_STORED_ANALYSES);
    atomicWriteJson(this.getAnalysesPath(workspaceRoot), trimmed);
    this.writeMetadata(workspaceRoot, trimmed.length);
  }

  public save(workspaceRoot: string, analysis: ImpactAnalysisResult): ImpactAnalysisResult {
    const existing = this.loadAll(workspaceRoot).filter(
      (a) => a.analysisId !== analysis.analysisId
    );
    this.saveAll(workspaceRoot, [analysis, ...existing]);
    return analysis;
  }

  public get(workspaceRoot: string, analysisId: string): ImpactAnalysisResult | null {
    return this.loadAll(workspaceRoot).find((a) => a.analysisId === analysisId) ?? null;
  }

  public listSummaries(workspaceRoot: string, limit = 25): ImpactAnalysisSummary[] {
    return this.loadAll(workspaceRoot)
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map(toImpactSummary);
  }

  public delete(workspaceRoot: string, analysisId: string): boolean {
    const existing = this.loadAll(workspaceRoot);
    const next = existing.filter((a) => a.analysisId !== analysisId);
    if (next.length === existing.length) return false;
    this.saveAll(workspaceRoot, next);
    return true;
  }
}
