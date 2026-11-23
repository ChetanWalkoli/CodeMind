import crypto from "node:crypto";
import type {
  ContractChangeKind,
  DatabaseFieldSummary,
  ImpactApiContract,
  ImpactDatabaseContract,
  ImpactEvidence,
  ImpactRelationship
} from "@codemind/shared";

export interface ApiRelationshipInput {
  method: string;
  endpoint: string;
  callerFile: string;
  callerLine: number;
  handlerFile: string;
  handlerLine: number;
  confidence: "confirmed" | "inferred";
  explanation: string;
}

export interface ApiContractAnalysisOutput {
  apiContracts: ImpactApiContract[];
  relationships: ImpactRelationship[];
  evidence: ImpactEvidence[];
  frontendConsumerFiles: string[];
}

/**
 * Milestone 8.4A — API Contract Impact Analyzer.
 * Reuses CodeMind's existing cross-layer ApiRelationshipExtractor outputs to connect
 * affected backend routes/controllers to frontend consumers across HTTP boundaries.
 */
export function analyzeApiContractImpact(params: {
  affectedBackendAndTargetFiles: ReadonlySet<string>;
  apiRelationships: readonly ApiRelationshipInput[];
}): ApiContractAnalysisOutput {
  const { affectedBackendAndTargetFiles, apiRelationships } = params;
  const byEndpoint = new Map<string, ApiRelationshipInput[]>();

  for (const rel of apiRelationships) {
    if (
      affectedBackendAndTargetFiles.has(rel.handlerFile) ||
      affectedBackendAndTargetFiles.has(rel.callerFile)
    ) {
      const key = `${rel.method}:${rel.endpoint}:${rel.handlerFile}`;
      const list = byEndpoint.get(key) ?? [];
      list.push(rel);
      byEndpoint.set(key, list);
    }
  }

  const apiContracts: ImpactApiContract[] = [];
  const relationships: ImpactRelationship[] = [];
  const evidence: ImpactEvidence[] = [];
  const frontendConsumerFiles = new Set<string>();

  for (const [key, rels] of byEndpoint.entries()) {
    const first = rels[0]!;
    const consumers = rels.map((r) => ({
      filePath: r.callerFile,
      line: r.callerLine,
      confidence: r.confidence
    }));

    for (const c of consumers) {
      frontendConsumerFiles.add(c.filePath);
    }

    const contractId = `api-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
    const allConfirmed = rels.every((r) => r.confidence === "confirmed");

    apiContracts.push({
      id: contractId,
      method: first.method,
      endpoint: first.endpoint,
      routeFile: first.handlerFile,
      routeLine: first.handlerLine,
      controllerFiles: [],
      frontendConsumers: consumers,
      changeKind: "unknown_contract_change",
      contractVerified: false,
      completeness: allConfirmed ? "complete" : "partial",
      explanation: `${first.method} ${first.endpoint} in ${first.handlerFile}:${first.handlerLine} is consumed by ${consumers.length} frontend caller(s). Request/response shape change is unverified unless explicitly diffed.`
    });

    for (const rel of rels) {
      const evId = `ev-api-${crypto
        .createHash("sha1")
        .update(`${rel.handlerFile}->${rel.callerFile}:${rel.endpoint}`)
        .digest("hex")
        .slice(0, 10)}`;

      evidence.push({
        evidenceId: evId,
        filePath: rel.callerFile,
        startLine: rel.callerLine,
        endLine: rel.callerLine,
        evidenceType: "api_relationship",
        provenance: rel.confidence === "confirmed" ? "confirmed_static" : "inferred_contract",
        verificationStatus: "current",
        explanation: rel.explanation
      });

      relationships.push({
        id: `rel-api-${crypto
          .createHash("sha1")
          .update(`${rel.handlerFile}->${rel.callerFile}:${rel.endpoint}`)
          .digest("hex")
          .slice(0, 10)}`,
        sourceNode: rel.handlerFile,
        destinationNode: rel.callerFile,
        relationshipType: "consumes_api",
        depth: 2,
        evidenceId: evId,
        provenance: rel.confidence === "confirmed" ? "confirmed_static" : "inferred_contract",
        confidence: rel.confidence,
        explanation: `${rel.callerFile}:${rel.callerLine} calls ${rel.method} ${rel.endpoint} handled by ${rel.handlerFile}.`
      });
    }
  }

  return {
    apiContracts,
    relationships,
    evidence,
    frontendConsumerFiles: Array.from(frontendConsumerFiles)
  };
}

// ============================================================================
// Milestone 8.4B — Database / Schema Contract Impact Analyzer
// ============================================================================

export function extractDatabaseFieldsFromSource(
  filePath: string,
  content: string
): {
  technology: ImpactDatabaseContract["technology"];
  modelName: string;
  fields: DatabaseFieldSummary[];
} | null {
  const lower = filePath.toLowerCase();

  // 1. Mongoose schema detection (`new mongoose.Schema({ ... })` or `new Schema({ ... })`)
  const mongooseStart = content.match(/new\s+(?:mongoose\.)?Schema\s*\(\s*\{/m);
  if (mongooseStart && mongooseStart.index !== undefined) {
    const modelMatch = content.match(/mongoose\.model\s*\(\s*["'`]([A-Za-z0-9_]+)["'`]/);
    const modelName =
      modelMatch?.[1] ??
      filePath
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ??
      "Model";
    const openBraceIdx = mongooseStart.index + mongooseStart[0].length - 1;
    let depth = 0;
    let closeBraceIdx = -1;
    for (let i = openBraceIdx; i < content.length; i++) {
      const ch = content[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          closeBraceIdx = i;
          break;
        }
      }
    }
    const body = closeBraceIdx > openBraceIdx ? content.slice(openBraceIdx + 1, closeBraceIdx) : "";
    const fields: DatabaseFieldSummary[] = [];
    if (body) {
      const fieldRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\{[^}]*\}|[A-Za-z0-9_[\].]+)/gm;
      let m: RegExpExecArray | null;
      while ((m = fieldRe.exec(body)) !== null) {
        const name = m[1]!;
        const def = m[2]!;
        const typeMatch = def.match(/type\s*:\s*([A-Za-z0-9_.]+)/);
        const required = /required\s*:\s*true/.test(def);
        fields.push({
          name,
          fieldType: typeMatch?.[1] ?? def.trim().slice(0, 40),
          required
        });
      }
    }
    return { technology: "mongoose", modelName, fields };
  }

  // 2. Prisma schema (`model User { ... }`)
  if (lower.endsWith(".prisma") || /^\s*model\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/m.test(content)) {
    const modelMatch = content.match(/^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\s*\}/m);
    if (modelMatch) {
      const fields: DatabaseFieldSummary[] = [];
      const lines = (modelMatch[2] ?? "").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const name = parts[0]!;
          const rawType = parts[1]!;
          fields.push({
            name,
            fieldType: rawType.replace(/\?$/, ""),
            required: !rawType.endsWith("?")
          });
        }
      }
      return { technology: "prisma", modelName: modelMatch[1]!, fields };
    }
  }

  // 3. SQL CREATE TABLE
  if (/CREATE\s+TABLE\s+/i.test(content)) {
    const tableMatch = content.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?\s*\(([\s\S]*?)\);/i
    );
    if (tableMatch) {
      const fields: DatabaseFieldSummary[] = [];
      for (const line of (tableMatch[2] ?? "").split(",")) {
        const trimmed = line.trim();
        if (!trimmed || /^(?:PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|INDEX)\b/i.test(trimmed)) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          fields.push({
            name: parts[0]!.replace(/[`"']/g, ""),
            fieldType: parts[1]!,
            required: /NOT\s+NULL/i.test(trimmed)
          });
        }
      }
      return { technology: "sql", modelName: tableMatch[1]!, fields };
    }
  }

  // 4. TypeScript Entity / Model interface (`models/` or `entities/` or `schema`)
  if (/(?:models?|entities|schema)/i.test(lower)) {
    const ifaceMatch = content.match(
      /export\s+interface\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/m
    );
    if (ifaceMatch) {
      const fields: DatabaseFieldSummary[] = [];
      const propRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*([^;\n]+)/gm;
      let m: RegExpExecArray | null;
      while ((m = propRe.exec(ifaceMatch[2] ?? "")) !== null) {
        fields.push({
          name: m[1]!,
          fieldType: m[3]!.trim().slice(0, 60),
          required: !m[2]
        });
      }
      return { technology: "typescript_entity", modelName: ifaceMatch[1]!, fields };
    }
  }

  return null;
}

export function diffDatabaseFields(
  beforeFields: readonly DatabaseFieldSummary[],
  afterFields: readonly DatabaseFieldSummary[]
): { detectedChanges: ContractChangeKind[]; changeDetails: string[] } {
  const beforeMap = new Map(beforeFields.map((f) => [f.name, f]));
  const afterMap = new Map(afterFields.map((f) => [f.name, f]));
  const changes = new Set<ContractChangeKind>();
  const details: string[] = [];

  const removedFields: DatabaseFieldSummary[] = [];
  const addedFields: DatabaseFieldSummary[] = [];

  for (const [name, prev] of beforeMap.entries()) {
    const next = afterMap.get(name);
    if (!next) {
      removedFields.push(prev);
      changes.add("field_removed");
      details.push(`Field "${name}" (${prev.fieldType}) was removed.`);
    } else {
      if (prev.fieldType !== next.fieldType) {
        changes.add("field_type_changed");
        details.push(`Field "${name}" type changed from ${prev.fieldType} to ${next.fieldType}.`);
      }
      if (prev.required !== next.required) {
        changes.add("requiredness_changed");
        details.push(
          `Field "${name}" requiredness changed from ${prev.required ? "required" : "optional"} to ${next.required ? "required" : "optional"}.`
        );
      }
    }
  }

  for (const [name, next] of afterMap.entries()) {
    if (!beforeMap.has(name)) {
      addedFields.push(next);
      changes.add("field_added");
      details.push(`Field "${name}" (${next.fieldType}) was added.`);
    }
  }

  // Conservative possible-rename heuristic: removed + added fields sharing identical type & requiredness
  if (removedFields.length > 0 && addedFields.length > 0) {
    const usedAdded = new Set<string>();
    for (const rem of removedFields) {
      const match = addedFields.find(
        (add) =>
          !usedAdded.has(add.name) &&
          add.fieldType === rem.fieldType &&
          add.required === rem.required
      );
      if (match) {
        usedAdded.add(match.name);
        changes.add("field_renamed");
        details.push(
          `Possible field rename detected: "${rem.name}" -> "${match.name}" (identical type ${rem.fieldType}, ${rem.required ? "required" : "optional"}).`
        );
      }
    }
  }

  return { detectedChanges: Array.from(changes), changeDetails: details };
}

export function analyzeDatabaseContractImpact(params: {
  targets: Array<{
    filePath: string;
    currentContent?: string;
    beforeContent?: string;
    afterContent?: string;
  }>;
  consumerFilesByTarget: Map<string, string[]>;
}): ImpactDatabaseContract[] {
  const contracts: ImpactDatabaseContract[] = [];

  for (const target of params.targets) {
    const afterText = target.afterContent ?? target.currentContent;
    const consumers = params.consumerFilesByTarget.get(target.filePath) ?? [];

    // Handle deleted model file when beforeContent is supplied
    if (!afterText) {
      if (!target.beforeContent) continue;
      const beforeOnly = extractDatabaseFieldsFromSource(target.filePath, target.beforeContent);
      if (!beforeOnly) continue;
      const diff = diffDatabaseFields(beforeOnly.fields, []);
      contracts.push({
        id: `db-${crypto.createHash("sha1").update(target.filePath).digest("hex").slice(0, 10)}`,
        modelName: beforeOnly.modelName,
        technology: beforeOnly.technology,
        schemaFile: target.filePath,
        fields: beforeOnly.fields.slice(0, 100),
        consumerFiles: consumers.slice(0, 50),
        detectedChanges: diff.detectedChanges.length > 0 ? diff.detectedChanges : ["field_removed"],
        changeDetails: [
          `Schema file "${target.filePath}" was removed on disk.`,
          ...diff.changeDetails
        ],
        verified: true,
        explanation: `${beforeOnly.technology} model "${beforeOnly.modelName}" in ${target.filePath} was deleted with ${consumers.length} direct consumer file(s).`
      });
      continue;
    }

    const extracted = extractDatabaseFieldsFromSource(target.filePath, afterText);
    if (!extracted) continue;

    let detectedChanges: ContractChangeKind[] = [];
    let changeDetails: string[] = [];
    let verified = false;

    if (target.beforeContent) {
      const beforeExtracted = extractDatabaseFieldsFromSource(
        target.filePath,
        target.beforeContent
      );
      if (beforeExtracted) {
        const diff = diffDatabaseFields(beforeExtracted.fields, extracted.fields);
        detectedChanges = diff.detectedChanges;
        changeDetails = diff.changeDetails;
        verified = true;
      }
    }

    if (!verified) {
      detectedChanges = ["unknown_contract_change"];
      changeDetails = [
        "Before/after schema diff was not supplied; field-level contract change is unverified."
      ];
    }

    contracts.push({
      id: `db-${crypto.createHash("sha1").update(`${target.filePath}:${extracted.modelName}`).digest("hex").slice(0, 10)}`,
      modelName: extracted.modelName,
      technology: extracted.technology,
      schemaFile: target.filePath,
      fields: extracted.fields,
      consumerFiles: consumers,
      detectedChanges,
      changeDetails,
      verified,
      explanation: `Detected ${extracted.technology} model "${extracted.modelName}" (${extracted.fields.length} field(s)) in ${target.filePath} with ${consumers.length} consumer file(s).`
    });
  }

  return contracts;
}
