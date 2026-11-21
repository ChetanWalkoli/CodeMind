import { describe, expect, it } from "vitest";
import {
  buildApiRelationships,
  damerauLevenshteinDistance,
  extractApiArtifactsFromFile,
  normalizeMorphology,
  SearchIndex,
  splitIdentifierTokens
} from "../index.js";

describe("Code Engine — Search Normalization, Typo Tolerance & Cross-Layer API Discovery", () => {
  it("splits camelCase/snake_case/kebab-case and normalizes common morphology safely", () => {
    expect(splitIdentifierTokens("generateQuiz")).toEqual(["generate", "quiz"]);
    expect(splitIdentifierTokens("quiz_generation-service")).toEqual([
      "quiz",
      "generation",
      "service"
    ]);
    expect(normalizeMorphology("quizzes")).toBe("quiz");
    expect(normalizeMorphology("generating")).toBe("generat");
    expect(normalizeMorphology("generation")).toBe("generat");
    expect(normalizeMorphology("api")).toBe("api");
  });

  it("recovers typos via Damerau-Levenshtein while preventing short-word false positives", () => {
    expect(damerauLevenshteinDistance("quzi", "quiz", 1)).toBe(1);
    expect(damerauLevenshteinDistance("genrates", "generate", 2)).toBe(2);
    expect(damerauLevenshteinDistance("authentcation", "authentication", 2)).toBe(1);

    const index = new SearchIndex();
    index.setFile(
      {
        id: "frontend/src/app/quiz/generate/page.js",
        path: "frontend/src/app/quiz/generate/page.js",
        language: "javascript",
        contentHash: "h1",
        lastIndexedAt: "2026-11-22T00:00:00.000Z"
      },
      [
        {
          id: "sym1",
          filePath: "frontend/src/app/quiz/generate/page.js",
          name: "generateQuiz",
          kind: "function",
          startLine: 1,
          endLine: 10,
          exported: true
        }
      ]
    );
    index.setFile(
      {
        id: "backend/services/quizService.js",
        path: "backend/services/quizService.js",
        language: "javascript",
        contentHash: "h2",
        lastIndexedAt: "2026-11-22T00:00:00.000Z"
      },
      [
        {
          id: "sym2",
          filePath: "backend/services/quizService.js",
          name: "createGeneratedQuiz",
          kind: "function",
          startLine: 1,
          endLine: 20,
          exported: true
        }
      ]
    );

    // Misspelled query "genrates quzi" still finds both files and symbols
    const fileHits = index.searchFilesDetailed("genrates quzi", 10);
    expect(fileHits.map((f) => f.file.path)).toEqual(
      expect.arrayContaining([
        "frontend/src/app/quiz/generate/page.js",
        "backend/services/quizService.js"
      ])
    );

    const symHits = index.searchSymbols("genrates", { limit: 10 });
    expect(symHits.map((s) => s.symbol.name)).toContain("generateQuiz");

    // Exact match ranks above fuzzy match
    const exactHits = index.searchSymbols("generateQuiz", { limit: 10 });
    expect(exactHits[0]?.symbol.name).toBe("generateQuiz");

    // Short unrelated word must not fuzzy-match "quiz"
    expect(index.searchFilesDetailed("cat", 10)).toEqual([]);
  });

  it("extracts and matches fetch, axios, Express, Next.js App/Pages Router, and parameterized API relationships", () => {
    const frontendApi = extractApiArtifactsFromFile(
      "frontend/src/lib/api.js",
      [
        'export const generateQuiz = (payload) => axios.post("/api/quiz/generate", payload);',
        "export const getQuiz = (id) => fetch(`/api/quiz/${id}`);",
        'export const checkout = () => fetch("/api/payments/checkout", { method: "POST" });'
      ].join("\n")
    );

    const expressServer = extractApiArtifactsFromFile(
      "backend/server.js",
      'app.use("/api/quiz", quizRoutes);\n'
    );

    const expressQuizRoute = extractApiArtifactsFromFile(
      "backend/routes/quizRoutes.js",
      [
        'router.post("/generate", quizController.generateQuiz);',
        'router.get("/:id", quizController.getQuizById);'
      ].join("\n")
    );

    const nextAppRoute = extractApiArtifactsFromFile(
      "frontend/src/app/api/payments/checkout/route.ts",
      "export async function POST(req: Request) { return new Response('ok'); }\n"
    );

    const rels = buildApiRelationships(
      [...frontendApi.calls],
      [...expressQuizRoute.handlers, ...nextAppRoute.handlers],
      [...expressServer.mounts]
    );

    expect(rels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          endpoint: "/api/quiz/generate",
          callerFile: "frontend/src/lib/api.js",
          handlerFile: "backend/routes/quizRoutes.js",
          confidence: "confirmed"
        }),
        expect.objectContaining({
          method: "GET",
          endpoint: "/api/quiz/:param",
          callerFile: "frontend/src/lib/api.js",
          handlerFile: "backend/routes/quizRoutes.js",
          confidence: "confirmed"
        }),
        expect.objectContaining({
          method: "POST",
          endpoint: "/api/payments/checkout",
          callerFile: "frontend/src/lib/api.js",
          handlerFile: "frontend/src/app/api/payments/checkout/route.ts",
          confidence: "confirmed"
        })
      ])
    );
  });
});
