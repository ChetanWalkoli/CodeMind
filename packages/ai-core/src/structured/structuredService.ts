import {
  ImpactAnalysisResponseSchema,
  OptimizationFindingsResponseSchema,
  PatchProposalResponseSchema,
  StructuredExplanationResponseSchema,
  type AIContextSnapshot,
  type AITaskType,
  type ImpactAnalysisResponse,
  type OptimizationFindingsResponse,
  type PatchProposalResponse,
  type SourceReference,
  type StructuredExplanationResponse,
  type StructuredResponseKind
} from "@codemind/shared";
import type { z } from "zod";
import { AIProviderError } from "../errors/aiError.js";
import type { AIMessage, AIProvider, AIUsage } from "../types/ai.types.js";
import { validateSourceReferences, type VerifiedSourceReference } from "./referenceValidator.js";
import { parseSafeJsonResponse } from "./responseParser.js";

export type StructuredResponsePayload =
  | StructuredExplanationResponse
  | OptimizationFindingsResponse
  | PatchProposalResponse
  | ImpactAnalysisResponse;

interface AllowlistedSchemaEntry<T extends StructuredResponsePayload> {
  kind: StructuredResponseKind;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  jsonInstructions: string;
  extractReferences: (data: T) => SourceReference[];
}

const ALLOWLISTED_SCHEMAS: Record<
  StructuredResponseKind,
  AllowlistedSchemaEntry<StructuredResponsePayload>
> = {
  "codebase-answer": {
    kind: "codebase-answer",
    schema: StructuredExplanationResponseSchema,
    jsonInstructions:
      'Respond ONLY with a single JSON object matching: { "summary": string, "explanation": string[], "references": [{ "filePath": string, "startLine": number, "endLine": number, "symbol"?: string }], "confidence": "high"|"medium"|"low", "limitations": string[], "verifiedFacts": string[], "interpretations": string[], "recommendations": string[], "assumptions": string[] }. Only cite filePaths and line ranges present in the provided context.',
    extractReferences: (data) => (data as StructuredExplanationResponse).references
  },
  "file-explanation": {
    kind: "file-explanation",
    schema: StructuredExplanationResponseSchema,
    jsonInstructions:
      'Respond ONLY with a single JSON object matching: { "summary": string, "explanation": string[], "references": [{ "filePath": string, "startLine": number, "endLine": number, "symbol"?: string }], "confidence": "high"|"medium"|"low", "limitations": string[], "verifiedFacts": string[], "interpretations": string[], "recommendations": string[], "assumptions": string[] }. Separate verifiedFacts from interpretations and assumptions.',
    extractReferences: (data) => (data as StructuredExplanationResponse).references
  },
  "architecture-explanation": {
    kind: "architecture-explanation",
    schema: StructuredExplanationResponseSchema,
    jsonInstructions:
      'Respond ONLY with a single JSON object matching: { "summary": string, "explanation": string[], "references": [{ "filePath": string, "startLine": number, "endLine": number, "symbol"?: string }], "confidence": "high"|"medium"|"low", "limitations": string[], "verifiedFacts": string[], "interpretations": string[], "recommendations": string[], "assumptions": string[] }.',
    extractReferences: (data) => (data as StructuredExplanationResponse).references
  },
  "optimization-findings": {
    kind: "optimization-findings",
    schema: OptimizationFindingsResponseSchema,
    jsonInstructions:
      'Respond ONLY with a single JSON object matching: { "summary": string, "findings": [{ "id": string, "filePath": string, "title": string, "description": string, "category": "performance"|"maintainability"|"architecture"|"security"|"reliability"|"bundle-size"|"api-efficiency"|"code-duplication", "severity": "critical"|"high"|"medium"|"low"|"info", "confidence": "high"|"medium"|"low", "evidence": string[], "recommendation": string }], "references": [{ "filePath": string, "startLine"?: number, "endLine"?: number, "symbol"?: string }], "limitations": string[] }.',
    extractReferences: (data) => {
      const typed = data as OptimizationFindingsResponse;
      return [...typed.references, ...typed.findings.map((f) => ({ filePath: f.filePath }))];
    }
  },
  "patch-proposal": {
    kind: "patch-proposal",
    schema: PatchProposalResponseSchema,
    jsonInstructions:
      'Respond ONLY with a single JSON object matching: { "summary": string, "proposal": { "id": string, "filePath": string, "expectedContentHash": string, "originalCode": string, "proposedCode": string, "explanation": string, "risks": string[], "assumptions": string[] }, "references": [{ "filePath": string, "startLine"?: number, "endLine"?: number, "symbol"?: string }] }.',
    extractReferences: (data) => {
      const typed = data as PatchProposalResponse;
      return [...typed.references, { filePath: typed.proposal.filePath }];
    }
  },
  "impact-report": {
    kind: "impact-report",
    schema: ImpactAnalysisResponseSchema,
    jsonInstructions:
      'Respond ONLY with a single JSON object matching: { "summary": string, "targetPath": string, "targetSymbol"?: string, "affectedFiles": [{ "filePath": string, "symbol"?: string, "reason": string, "confidence": "high"|"medium"|"low" }], "risks": string[], "references": [{ "filePath": string, "startLine"?: number, "endLine"?: number, "symbol"?: string }], "limitations": string[] }.',
    extractReferences: (data) => {
      const typed = data as ImpactAnalysisResponse;
      return [
        ...typed.references,
        { filePath: typed.targetPath },
        ...typed.affectedFiles.map((af) => ({ filePath: af.filePath, symbol: af.symbol }))
      ];
    }
  }
};

export function resolveStructuredKindForTask(taskType: AITaskType): StructuredResponseKind {
  switch (taskType) {
    case "explain-file":
      return "file-explanation";
    case "explain-codebase":
    case "architecture-overview":
      return "architecture-explanation";
    case "impact-analysis":
      return "impact-report";
    case "code-qa":
    default:
      return "codebase-answer";
  }
}

export function getStructuredInstructions(kind: StructuredResponseKind): string {
  return ALLOWLISTED_SCHEMAS[kind].jsonInstructions;
}

export interface StructuredValidationResult<
  T extends StructuredResponsePayload = StructuredResponsePayload
> {
  kind: StructuredResponseKind;
  data: T;
  verifiedReferences: VerifiedSourceReference[];
}

/**
 * Validates raw provider output against an allowlisted schema and verifies every
 * cited source reference against the exact approved AIContextSnapshot.
 */
export function parseAndValidateStructuredResponse(params: {
  rawContent: string;
  kind: StructuredResponseKind;
  snapshot: AIContextSnapshot;
  provider?: string;
}): StructuredValidationResult {
  const entry = ALLOWLISTED_SCHEMAS[params.kind];
  const parsedObj = parseSafeJsonResponse(params.rawContent, params.provider);

  const schemaResult = entry.schema.safeParse(parsedObj);
  if (!schemaResult.success) {
    const details = schemaResult.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new AIProviderError(
      "INVALID_RESPONSE",
      `Structured response failed schema validation (${params.kind}): ${details}`,
      { provider: params.provider, retryable: false }
    );
  }

  const refs = entry.extractReferences(schemaResult.data);
  const refCheck = validateSourceReferences(refs, params.snapshot);
  if (!refCheck.valid) {
    const details = refCheck.invalidReferences.map((r) => r.reason).join("; ");
    throw new AIProviderError(
      "INVALID_RESPONSE",
      `Structured response contained invalid or fabricated source references: ${details}`,
      { provider: params.provider, retryable: false }
    );
  }

  return {
    kind: params.kind,
    data: schemaResult.data,
    verifiedReferences: refCheck.verifiedReferences
  };
}

export interface ExecuteStructuredOptions {
  provider: AIProvider;
  model: string;
  messages: AIMessage[];
  snapshot: AIContextSnapshot;
  kind?: StructuredResponseKind;
  maxTokens?: number;
  allowCorrectionRetry?: boolean;
  signal?: AbortSignal;
}

export interface ExecuteStructuredResult {
  kind: StructuredResponseKind;
  data: StructuredResponsePayload;
  verifiedReferences: VerifiedSourceReference[];
  model: string;
  provider: string;
  usage?: AIUsage;
  retried: boolean;
}

/**
 * Executes a structured AI request through the existing AIProvider abstraction with:
 * - Allowlisted schema selection (never arbitrary renderer schemas)
 * - Native JSON mode when supported (`responseFormat: "json"`)
 * - Strict JSON parsing, Zod validation, and source-reference verification
 * - At most ONE bounded correction retry on parse/schema/reference failure
 */
export async function executeStructuredRequest(
  options: ExecuteStructuredOptions
): Promise<ExecuteStructuredResult> {
  const kind = options.kind ?? resolveStructuredKindForTask(options.snapshot.taskType);
  const instructions = getStructuredInstructions(kind);

  const structuredMessages: AIMessage[] = options.messages.map((msg, idx) =>
    idx === 0 && msg.role === "system"
      ? { ...msg, content: `${msg.content}\n\nSTRUCTURED OUTPUT REQUIREMENT:\n${instructions}` }
      : msg
  );

  const attemptOnce = async (messages: AIMessage[]) => {
    const response = await options.provider.generate({
      model: options.model,
      messages,
      maxTokens: options.maxTokens,
      responseFormat: "json",
      signal: options.signal
    });

    const validated = parseAndValidateStructuredResponse({
      rawContent: response.content,
      kind,
      snapshot: options.snapshot,
      provider: response.provider
    });

    return { response, validated };
  };

  try {
    const { response, validated } = await attemptOnce(structuredMessages);
    return {
      kind: validated.kind,
      data: validated.data,
      verifiedReferences: validated.verifiedReferences,
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      retried: false
    };
  } catch (firstErr) {
    const canRetry =
      options.allowCorrectionRetry !== false &&
      firstErr instanceof AIProviderError &&
      firstErr.code === "INVALID_RESPONSE";

    if (!canRetry) {
      throw firstErr;
    }

    // Bounded single correction retry (never an unlimited loop)
    const correctionMessages: AIMessage[] = [
      ...structuredMessages,
      {
        role: "user",
        content: `Your previous response failed validation: ${firstErr.message}\nReturn ONLY a corrected JSON object that strictly satisfies the schema and cites ONLY file paths and line ranges present in the provided context.`
      }
    ];

    const { response, validated } = await attemptOnce(correctionMessages);
    return {
      kind: validated.kind,
      data: validated.data,
      verifiedReferences: validated.verifiedReferences,
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      retried: true
    };
  }
}
