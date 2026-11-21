import { DirectedGraph } from "graphology";
import type {
  DependencyEdge,
  DependencyGraphSnapshot,
  DependencyRelation,
  FileNode,
  RelationshipConfidence
} from "@codemind/shared";

interface EdgeAttributes {
  relation: DependencyRelation;
  confidence: RelationshipConfidence;
}

/**
 * Directed project dependency graph backed by Graphology.
 * Nodes are workspace-relative file paths; edges represent precise static/inferred relationships.
 */
export class DependencyGraph {
  private readonly graph = new DirectedGraph<FileNode, EdgeAttributes>({
    allowSelfLoops: false,
    multi: false
  });

  public upsertFile(fileNode: FileNode): void {
    if (this.graph.hasNode(fileNode.id)) {
      this.graph.replaceNodeAttributes(fileNode.id, fileNode);
    } else {
      this.graph.addNode(fileNode.id, fileNode);
    }
  }

  public removeFile(fileId: string): void {
    if (this.graph.hasNode(fileId)) {
      this.graph.dropNode(fileId);
    }
  }

  public clearOutgoingEdges(sourceId: string): void {
    if (!this.graph.hasNode(sourceId)) return;
    const outEdges = this.graph.outEdges(sourceId);
    for (const edgeKey of outEdges) {
      this.graph.dropEdge(edgeKey);
    }
  }

  public addEdge(edge: DependencyEdge): void {
    if (edge.sourceId === edge.targetId) return;
    if (!this.graph.hasNode(edge.sourceId) || !this.graph.hasNode(edge.targetId)) {
      return;
    }

    if (this.graph.hasEdge(edge.sourceId, edge.targetId)) {
      this.graph.replaceEdgeAttributes(edge.sourceId, edge.targetId, {
        relation: edge.relation,
        confidence: edge.confidence
      });
    } else {
      this.graph.addEdge(edge.sourceId, edge.targetId, {
        relation: edge.relation,
        confidence: edge.confidence
      });
    }
  }

  public getFileNode(fileId: string): FileNode | null {
    if (!this.graph.hasNode(fileId)) return null;
    return this.graph.getNodeAttributes(fileId);
  }

  public getDirectDependencies(fileId: string): DependencyEdge[] {
    if (!this.graph.hasNode(fileId)) return [];
    return this.graph.outEdges(fileId).map((edgeKey) => {
      const attrs = this.graph.getEdgeAttributes(edgeKey);
      return {
        sourceId: this.graph.source(edgeKey),
        targetId: this.graph.target(edgeKey),
        relation: attrs.relation,
        confidence: attrs.confidence
      };
    });
  }

  public getDirectDependents(fileId: string): DependencyEdge[] {
    if (!this.graph.hasNode(fileId)) return [];
    return this.graph.inEdges(fileId).map((edgeKey) => {
      const attrs = this.graph.getEdgeAttributes(edgeKey);
      return {
        sourceId: this.graph.source(edgeKey),
        targetId: this.graph.target(edgeKey),
        relation: attrs.relation,
        confidence: attrs.confidence
      };
    });
  }

  /**
   * Cycle-safe BFS of all files that directly or transitively depend on `fileId`.
   */
  public getTransitiveDependents(fileId: string, maxDepth = 10): string[] {
    if (!this.graph.hasNode(fileId)) return [];

    const visited = new Set<string>([fileId]);
    const result: string[] = [];
    const queue: { id: string; depth: number }[] = [{ id: fileId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      for (const neighbor of this.graph.inNeighbors(current.id)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          result.push(neighbor);
          queue.push({ id: neighbor, depth: current.depth + 1 });
        }
      }
    }

    return result.sort();
  }

  public get nodeCount(): number {
    return this.graph.order;
  }

  public get edgeCount(): number {
    return this.graph.size;
  }

  public clear(): void {
    this.graph.clear();
  }

  public toSnapshot(): DependencyGraphSnapshot {
    const nodes: FileNode[] = this.graph.nodes().map((id) => this.graph.getNodeAttributes(id));
    const edges: DependencyEdge[] = this.graph.edges().map((edgeKey) => {
      const attrs = this.graph.getEdgeAttributes(edgeKey);
      return {
        sourceId: this.graph.source(edgeKey),
        targetId: this.graph.target(edgeKey),
        relation: attrs.relation,
        confidence: attrs.confidence
      };
    });

    nodes.sort((a, b) => a.path.localeCompare(b.path));
    edges.sort((a, b) =>
      `${a.sourceId}->${a.targetId}`.localeCompare(`${b.sourceId}->${b.targetId}`)
    );

    return { nodes, edges };
  }
}
