import { redactSecrets } from "@codemind/ai-core";
import {
  ImpactAnalysisRequestSchema,
  ImpactAnalyzeGitDiffRequestSchema,
  ImpactGetRequestSchema,
  ImpactListRequestSchema,
  ImpactUpdateValidationRequestSchema,
  type ImpactAnalysisResult,
  type ImpactAnalysisSummary,
  type IpcResponse
} from "@codemind/shared";
import { ImpactSecurityError, type ImpactManager } from "../../impact/impactManager.js";
import { WorkspaceSecurityError } from "../../workspace/pathSecurity.js";

function toSafeImpactError<T>(err: unknown, fallbackCode: string): IpcResponse<T> {
  if (err instanceof WorkspaceSecurityError || err instanceof ImpactSecurityError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: redactSecrets(err.message)
      }
    };
  }
  const msg = err instanceof Error ? err.message : "Change Impact operation failed.";
  return {
    ok: false,
    error: {
      code: fallbackCode,
      message: redactSecrets(msg)
    }
  };
}

function invalidPayload<T>(issues: Array<{ message: string }>): IpcResponse<T> {
  return {
    ok: false,
    error: {
      code: "INVALID_PAYLOAD",
      message: issues.map((i) => i.message).join("; ") || "Invalid request payload."
    }
  };
}

export function createImpactHandlers(manager: ImpactManager) {
  return {
    analyze: async (payload: unknown): Promise<IpcResponse<ImpactAnalysisResult>> => {
      const parsed = ImpactAnalysisRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const data = await manager.analyzeChangeImpact(parsed.data);
        return { ok: true, data };
      } catch (err) {
        return toSafeImpactError(err, "IMPACT_ANALYZE_ERROR");
      }
    },

    analyzeGitDiff: async (payload: unknown): Promise<IpcResponse<ImpactAnalysisResult>> => {
      const parsed = ImpactAnalyzeGitDiffRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const out = await manager.analyzeGitDiff(parsed.data);
        if (!out.result) {
          return {
            ok: false,
            error: {
              code: out.available ? "NO_GIT_CHANGES" : "GIT_UNAVAILABLE",
              message: out.reason ?? "No analyzable Git changes found."
            }
          };
        }
        return { ok: true, data: out.result };
      } catch (err) {
        return toSafeImpactError(err, "IMPACT_GIT_DIFF_ERROR");
      }
    },

    get: async (payload: unknown): Promise<IpcResponse<ImpactAnalysisResult>> => {
      const parsed = ImpactGetRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const data = manager.getAnalysis(parsed.data.workspaceRoot, parsed.data.analysisId);
        if (!data) {
          return {
            ok: false,
            error: { code: "NOT_FOUND", message: "Impact analysis record not found." }
          };
        }
        return { ok: true, data };
      } catch (err) {
        return toSafeImpactError(err, "IMPACT_GET_ERROR");
      }
    },

    list: async (payload: unknown): Promise<IpcResponse<ImpactAnalysisSummary[]>> => {
      const parsed = ImpactListRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const data = manager.listAnalyses(parsed.data.workspaceRoot);
        return { ok: true, data };
      } catch (err) {
        return toSafeImpactError(err, "IMPACT_LIST_ERROR");
      }
    },

    checkFreshness: async (payload: unknown): Promise<IpcResponse<ImpactAnalysisResult>> => {
      const parsed = ImpactGetRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const data = manager.checkFreshness(parsed.data.workspaceRoot, parsed.data.analysisId);
        if (!data) {
          return {
            ok: false,
            error: { code: "NOT_FOUND", message: "Impact analysis record not found." }
          };
        }
        return { ok: true, data };
      } catch (err) {
        return toSafeImpactError(err, "IMPACT_FRESHNESS_ERROR");
      }
    },

    updateValidation: async (payload: unknown): Promise<IpcResponse<ImpactAnalysisResult>> => {
      const parsed = ImpactUpdateValidationRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const data = manager.updateValidationStep(
          parsed.data.workspaceRoot,
          parsed.data.analysisId,
          parsed.data.stepId,
          parsed.data.status
        );
        if (!data) {
          return {
            ok: false,
            error: { code: "NOT_FOUND", message: "Impact analysis record not found." }
          };
        }
        return { ok: true, data };
      } catch (err) {
        return toSafeImpactError(err, "IMPACT_UPDATE_VALIDATION_ERROR");
      }
    },

    delete: async (payload: unknown): Promise<IpcResponse<{ deleted: boolean }>> => {
      const parsed = ImpactGetRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const deleted = manager.deleteAnalysis(parsed.data.workspaceRoot, parsed.data.analysisId);
        return { ok: true, data: { deleted } };
      } catch (err) {
        return toSafeImpactError(err, "IMPACT_DELETE_ERROR");
      }
    }
  };
}
