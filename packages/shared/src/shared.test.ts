import { describe, expect, it } from "vitest";
import {
  CodebaseAnswerSchema,
  DecisionRecordSchema,
  DependencyEdgeSchema,
  FileReadRequestSchema,
  ImpactReportSchema,
  OptimizationFindingSchema,
  PatchProposalSchema
} from "./index.js";

describe("@codemind/shared schemas", () => {
  it("validates a well-formed CodebaseAnswer", () => {
    const parsed = CodebaseAnswerSchema.parse({
      summary: "Authentication uses JWT bearer tokens verified in Express middleware.",
      explanation: ["LoginPage submits credentials", "authController verifies password hash"],
      references: [{ filePath: "src/auth/authController.ts", startLine: 12, endLine: 40 }],
      confidence: "high",
      limitations: []
    });

    expect(parsed.confidence).toBe("high");
    expect(parsed.references).toHaveLength(1);
  });

  it("rejects OptimizationFinding without evidence", () => {
    const result = OptimizationFindingSchema.safeParse({
      id: "finding-1",
      filePath: "src/Dashboard.tsx",
      title: "Repeated expensive calculation",
      description: "Runs on every render",
      category: "performance",
      severity: "medium",
      confidence: "medium",
      evidence: [],
      recommendation: "Cache outside render"
    });

    expect(result.success).toBe(false);
  });

  it("validates DependencyEdge with precise relation and confidence", () => {
    const edge = DependencyEdgeSchema.parse({
      sourceId: "src/routes/auth.ts",
      targetId: "src/services/authService.ts",
      relation: "imports",
      confidence: "confirmed"
    });

    expect(edge.confidence).toBe("confirmed");
  });

  it("validates PatchProposal, DecisionRecord, ImpactReport, and IPC contracts", () => {
    const now = new Date().toISOString();

    expect(
      PatchProposalSchema.safeParse({
        id: "patch-1",
        filePath: "src/utils/sort.ts",
        expectedContentHash: "abc123",
        originalCode: "a",
        proposedCode: "b",
        explanation: "Avoid mutating input array",
        risks: [],
        assumptions: ["Input is a plain array"]
      }).success
    ).toBe(true);

    expect(
      DecisionRecordSchema.safeParse({
        id: "dec-1",
        projectId: "proj-1",
        title: "Adopt Zustand for workspace UI state",
        context: "Needed lightweight state without Redux boilerplate",
        reason: "Minimal API and good TypeScript ergonomics",
        createdAt: now,
        updatedAt: now
      }).success
    ).toBe(true);

    expect(
      ImpactReportSchema.safeParse({
        targetPath: "src/services/authService.ts",
        items: [
          {
            filePath: "src/routes/authRoutes.ts",
            level: "direct-dependency",
            confidence: "confirmed",
            reason: "Directly imports login() from authService.ts"
          }
        ],
        generatedAt: now
      }).success
    ).toBe(true);

    expect(
      FileReadRequestSchema.safeParse({
        workspaceRoot: "/workspace/demo",
        relativePath: "src/index.ts"
      }).success
    ).toBe(true);
  });
});
