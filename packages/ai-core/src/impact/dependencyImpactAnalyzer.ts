import crypto from "node:crypto";
import type {
  CodeSymbol,
  DependencyGraphSnapshot,
  ImpactedFile,
  ImpactedSymbol,
  ImpactCategory,
  ImpactEvidence,
  ImpactRelationship,
  ImportRecord
} from "@codemind/shared";
import { classifyFileRole } from "../context/intentAndRoles.js";

export interface FileMetadataForImpact {
  filePath: string;
  language: string;
  sourceHash?: string;
  symbols: CodeSymbol[];
  imports: ImportRecord[];
}

export interface DependencyImpactOutput {
  impactedFiles: ImpactedFile[];
  impactedSymbols: ImpactedSymbol[];
  relationships: ImpactRelationship[];
  evidence: ImpactEvidence[];
  missingTargetNodes: string[];
  unresolvedImportCount: number;
  cyclesDetected: number;
  traversedNodes: number;
  maxDepthReached: number;
  truncated: boolean;
}

/**
 * Direct (Milestone 8.2) & Transitive (Milestone 8.3) Dependency Impact Analyzer.
 * Operates deterministically on ProjectIndexer's DependencyGraphSnapshot.
 * - Cycle-safe bounded BFS traversal up to maxDepth & maxAffectedFiles.
 * - Preserves full dependency paths and multiple paths to the same downstream file.
 * - Uses symbol-level import evidence when available; reports file-level limitation otherwise.
 * - Never invents dependencies or promotes inferred edges to confirmed.
 */
export function analyzeDependencyImpact(params: {
  targetFiles: Array<{ filePath: string; symbolName?: string }>;
  graph: DependencyGraphSnapshot;
  fileMetaByPath: Map<string, FileMetadataForImpact>;
  maxDepth: number;
  maxAffectedFiles: number;
}): DependencyImpactOutput {
  const { targetFiles, graph, fileMetaByPath, maxDepth, maxAffectedFiles } = params;

  // Build reverse adjacency list: targetFile -> incoming edges (dependents that import targetFile)
  const incomingByTarget = new Map<
    string,
    Array<{ sourceId: string; confidence: "confirmed" | "inferred" }>
  >();
  let unresolvedImportCount = 0;

  for (const edge of graph.edges) {
    const list = incomingByTarget.get(edge.targetId) ?? [];
    list.push({ sourceId: edge.sourceId, confidence: edge.confidence });
    incomingByTarget.set(edge.targetId, list);
  }

  for (const meta of fileMetaByPath.values()) {
    for (const imp of meta.imports) {
      if (!imp.isExternal && !imp.resolvedPath) {
        unresolvedImportCount += 1;
      }
    }
  }

  const graphNodeIds = new Set(graph.nodes.map((n) => n.id));
  const missingTargetNodes = targetFiles
    .map((t) => t.filePath)
    .filter((fp) => !graphNodeIds.has(fp));

  const targetSet = new Set(targetFiles.map((t) => t.filePath));
  const targetSymbolByFile = new Map<string, string>();
  for (const t of targetFiles) {
    if (t.symbolName) targetSymbolByFile.set(t.filePath, t.symbolName);
  }

  const impactedMap = new Map<
    string,
    {
      depth: number;
      category: ImpactCategory;
      paths: string[][];
      referencedSymbols: Set<string>;
      evidenceIds: Set<string>;
      confirmedPath: boolean;
    }
  >();

  const relationships: ImpactRelationship[] = [];
  const seenRelKeys = new Set<string>();
  const evidence: ImpactEvidence[] = [];
  const seenEvIds = new Set<string>();

  let cyclesDetected = 0;
  let traversedNodes = 0;
  let maxDepthReached = 0;
  let truncated = false;

  interface QueueItem {
    node: string;
    depth: number;
    path: string[];
    confirmedSoFar: boolean;
  }

  const queue: QueueItem[] = targetFiles.map((t) => ({
    node: t.filePath,
    depth: 0,
    path: [t.filePath],
    confirmedSoFar: true
  }));

  const visitedAtDepth = new Map<string, number>();
  for (const t of targetFiles) {
    visitedAtDepth.set(t.filePath, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    traversedNodes += 1;

    if (current.depth >= maxDepth) {
      continue;
    }

    const incoming = incomingByTarget.get(current.node) ?? [];
    for (const edge of incoming) {
      const dependent = edge.sourceId;

      // Cycle detection
      if (current.path.includes(dependent)) {
        cyclesDetected += 1;
        continue;
      }

      if (targetSet.has(dependent)) {
        continue;
      }

      const nextDepth = current.depth + 1;
      const nextPath = [...current.path, dependent];
      const isConfirmed = current.confirmedSoFar && edge.confidence === "confirmed";

      if (impactedMap.size >= maxAffectedFiles && !impactedMap.has(dependent)) {
        truncated = true;
        continue;
      }

      maxDepthReached = Math.max(maxDepthReached, nextDepth);

      // Extract symbol-level import evidence from dependent's ImportRecord if available
      const depMeta = fileMetaByPath.get(dependent);
      const matchingImport = depMeta?.imports.find((imp) => imp.resolvedPath === current.node);
      const importedSymbols = (matchingImport?.importedNames ?? []).filter(
        (s: string) => s !== "*" && s !== "default"
      );

      const evId = `ev-imp-${crypto
        .createHash("sha1")
        .update(`${dependent}->${current.node}`)
        .digest("hex")
        .slice(0, 10)}`;

      if (!seenEvIds.has(evId)) {
        seenEvIds.add(evId);
        const symDesc =
          importedSymbols.length > 0
            ? ` (imports symbols: ${importedSymbols.slice(0, 6).join(", ")})`
            : " (file-level import; exact symbol usage not individually verified)";
        evidence.push({
          evidenceId: evId,
          filePath: dependent,
          symbolName: importedSymbols[0],
          startLine: matchingImport?.line,
          endLine: matchingImport?.line,
          sourceHash: depMeta?.sourceHash,
          evidenceType: importedSymbols.length > 0 ? "symbol_reference" : "import_edge",
          provenance: isConfirmed ? "confirmed_static" : "inferred_contract",
          verificationStatus: "current",
          explanation: `${dependent} imports ${current.node}${symDesc}.`
        });
      }

      const relKey = `${current.node}->${dependent}`;
      if (!seenRelKeys.has(relKey)) {
        seenRelKeys.add(relKey);
        relationships.push({
          id: `rel-${crypto.createHash("sha1").update(relKey).digest("hex").slice(0, 10)}`,
          sourceNode: current.node,
          destinationNode: dependent,
          relationshipType: isConfirmed ? "imports" : "possible_dependency",
          depth: nextDepth,
          evidenceId: evId,
          provenance: isConfirmed ? "confirmed_static" : "inferred_contract",
          confidence: isConfirmed ? "confirmed" : "inferred",
          explanation: isConfirmed
            ? `${dependent} directly imports ${current.node} at depth ${nextDepth}.`
            : `${dependent} has an inferred dependency on ${current.node} at depth ${nextDepth}.`
        });
      }

      const category: ImpactCategory = !isConfirmed
        ? "potential"
        : nextDepth === 1
          ? "direct"
          : "transitive";

      const existing = impactedMap.get(dependent);
      if (existing) {
        if (nextDepth < existing.depth) {
          existing.depth = nextDepth;
          existing.category = category;
          existing.confirmedPath = isConfirmed;
        } else if (nextDepth === existing.depth && !existing.confirmedPath && isConfirmed) {
          existing.category = category;
          existing.confirmedPath = true;
        }
        if (existing.paths.length < 5) {
          existing.paths.push(nextPath);
        }
        for (const s of importedSymbols) existing.referencedSymbols.add(s);
        existing.evidenceIds.add(evId);
      } else {
        impactedMap.set(dependent, {
          depth: nextDepth,
          category,
          paths: [nextPath],
          referencedSymbols: new Set(importedSymbols),
          evidenceIds: new Set([evId]),
          confirmedPath: isConfirmed
        });
      }

      const prevVisitedDepth = visitedAtDepth.get(dependent);
      if (prevVisitedDepth === undefined || nextDepth < prevVisitedDepth) {
        visitedAtDepth.set(dependent, nextDepth);
        queue.push({
          node: dependent,
          depth: nextDepth,
          path: nextPath,
          confirmedSoFar: isConfirmed
        });
      }
    }
  }

  // Build sorted ImpactedFile[]
  const impactedFiles: ImpactedFile[] = Array.from(impactedMap.entries())
    .map(([filePath, info]) => {
      const meta = fileMetaByPath.get(filePath);
      const symNames = meta?.symbols.map((s) => s.name) ?? [];
      const role = classifyFileRole(filePath, symNames);
      const refSyms = Array.from(info.referencedSymbols).sort();
      const explanation =
        info.category === "direct"
          ? refSyms.length > 0
            ? `Direct dependent importing ${refSyms.slice(0, 4).join(", ")}.`
            : "Direct file-level dependent (symbol usage not individually narrowed)."
          : info.category === "transitive"
            ? `Transitive dependent at depth ${info.depth} via ${info.paths[0]?.join(" -> ") ?? filePath}.`
            : `Potential downstream impact at depth ${info.depth} via inferred relationship.`;

      return {
        filePath,
        language: meta?.language ?? "text",
        role,
        category: info.category,
        depth: info.depth,
        sourceHash: meta?.sourceHash,
        referencedSymbols: refSyms,
        pathsFromTarget: info.paths,
        evidenceIds: Array.from(info.evidenceIds),
        explanation
      };
    })
    .sort((a, b) => a.depth - b.depth || a.filePath.localeCompare(b.filePath));

  // Build ImpactedSymbol[] for exported symbols of target files that are referenced by dependents
  const impactedSymbols: ImpactedSymbol[] = [];
  for (const target of targetFiles) {
    const meta = fileMetaByPath.get(target.filePath);
    if (!meta) continue;
    const targetSymFilter = targetSymbolByFile.get(target.filePath);
    for (const sym of meta.symbols) {
      if (!sym.exported && sym.name !== targetSymFilter) continue;
      if (targetSymFilter && sym.name !== targetSymFilter) continue;
      const usedBy = impactedFiles
        .filter((f) => f.referencedSymbols.includes(sym.name))
        .map((f) => f.filePath);
      impactedSymbols.push({
        filePath: target.filePath,
        symbolName: sym.name,
        kind: sym.kind,
        startLine: sym.startLine,
        endLine: sym.endLine,
        category: usedBy.length > 0 ? "direct" : "potential",
        usedByFiles: usedBy
      });
    }
  }

  return {
    impactedFiles,
    impactedSymbols,
    relationships,
    evidence,
    missingTargetNodes,
    unresolvedImportCount,
    cyclesDetected,
    traversedNodes,
    maxDepthReached,
    truncated
  };
}
