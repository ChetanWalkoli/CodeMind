import { describe, expect, it } from "vitest";
import type { DependencyGraphSnapshot } from "@codemind/shared";
import { transformDependencyGraph } from "../utils/graphTransform";

const SAMPLE_SNAPSHOT: DependencyGraphSnapshot = {
  nodes: [
    {
      id: "src/app/App.tsx",
      path: "src/app/App.tsx",
      language: "tsx",
      contentHash: "h1",
      lastIndexedAt: "2026-11-21T00:00:00.000Z"
    },
    {
      id: "src/services/authService.ts",
      path: "src/services/authService.ts",
      language: "typescript",
      contentHash: "h2",
      lastIndexedAt: "2026-11-21T00:00:00.000Z"
    },
    {
      id: "src/utils/format.ts",
      path: "src/utils/format.ts",
      language: "typescript",
      contentHash: "h3",
      lastIndexedAt: "2026-11-21T00:00:00.000Z"
    },
    {
      id: "scripts/build.js",
      path: "scripts/build.js",
      language: "javascript",
      contentHash: "h4",
      lastIndexedAt: "2026-11-21T00:00:00.000Z"
    }
  ],
  edges: [
    {
      sourceId: "src/app/App.tsx",
      targetId: "src/services/authService.ts",
      relation: "imports",
      confidence: "confirmed"
    },
    {
      sourceId: "src/services/authService.ts",
      targetId: "src/utils/format.ts",
      relation: "imports",
      confidence: "confirmed"
    }
  ]
};

describe("transformDependencyGraph", () => {
  it("transforms snapshot into deterministic nodes/edges with incoming and outgoing counts", () => {
    const result = transformDependencyGraph(SAMPLE_SNAPSHOT);

    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(2);
    expect(result.availableModules).toEqual(["scripts", "src"]);
    expect(result.availableLanguages).toEqual(["javascript", "tsx", "typescript"]);

    const authNode = result.nodes.find((n) => n.id === "src/services/authService.ts");
    expect(authNode?.data.incomingCount).toBe(1);
    expect(authNode?.data.outgoingCount).toBe(1);
  });

  it("filters by search query, language, and module", () => {
    const byQuery = transformDependencyGraph(SAMPLE_SNAPSHOT, { searchQuery: "auth" });
    expect(byQuery.nodes.map((n) => n.id)).toEqual(["src/services/authService.ts"]);

    const byLang = transformDependencyGraph(SAMPLE_SNAPSHOT, { languageFilter: "javascript" });
    expect(byLang.nodes.map((n) => n.id)).toEqual(["scripts/build.js"]);

    const byModule = transformDependencyGraph(SAMPLE_SNAPSHOT, { moduleFilter: "src" });
    expect(byModule.nodes).toHaveLength(3);
  });

  it("highlights selected node and direct neighbors while dimming unconnected nodes", () => {
    const result = transformDependencyGraph(SAMPLE_SNAPSHOT, {
      selectedNodeId: "src/app/App.tsx"
    });

    const appNode = result.nodes.find((n) => n.id === "src/app/App.tsx");
    const authNode = result.nodes.find((n) => n.id === "src/services/authService.ts");
    const buildNode = result.nodes.find((n) => n.id === "scripts/build.js");

    expect(appNode?.data.isSelected).toBe(true);
    expect(authNode?.data.isConnected).toBe(true);
    expect(buildNode?.data.isDimmed).toBe(true);

    const focusOnly = transformDependencyGraph(SAMPLE_SNAPSHOT, {
      selectedNodeId: "src/app/App.tsx",
      focusNeighborhood: true
    });
    expect(focusOnly.nodes.map((n) => n.id).sort()).toEqual([
      "src/app/App.tsx",
      "src/services/authService.ts"
    ]);
  });

  it("caps visible nodes for large graphs and reports truncatedCount", () => {
    const result = transformDependencyGraph(SAMPLE_SNAPSHOT, {
      maxVisibleNodes: 2,
      selectedNodeId: "scripts/build.js"
    });

    expect(result.nodes).toHaveLength(2);
    expect(result.truncatedCount).toBe(2);
    // Selected node is always prioritized into the visible slice
    expect(result.nodes.some((n) => n.id === "scripts/build.js")).toBe(true);
  });
});
