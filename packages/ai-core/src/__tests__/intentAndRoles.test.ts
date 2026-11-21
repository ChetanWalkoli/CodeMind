import { describe, expect, it } from "vitest";
import { classifyFileRole, classifyQueryIntent, computeRoleRelevanceAdjustment } from "../index.js";

describe("Query Intent & File Role Classification", () => {
  it("classifies developer query intents deterministically without AI calls", () => {
    expect(classifyQueryIntent("How does quiz generation work?")).toBe("implementation");
    expect(classifyQueryIntent("Where are payments processed?")).toBe("implementation");
    expect(classifyQueryIntent("Explain the quiz generation UI")).toBe("ui");
    expect(classifyQueryIntent("How does the API endpoint handle auth?")).toBe("api");
    expect(classifyQueryIntent("Why is quiz generation failing?")).toBe("debugging");
    expect(classifyQueryIntent("What is the architecture of this codebase?")).toBe("architecture");
    expect(classifyQueryIntent("quiz")).toBe("neutral");
  });

  it("classifies file roles using multiple signals and adjusts relevance by intent", () => {
    expect(classifyFileRole("backend/services/quizService.js")).toBe("backend-implementation");
    expect(classifyFileRole("backend/controllers/quizController.js")).toBe(
      "backend-implementation"
    );
    expect(classifyFileRole("frontend/src/lib/api.js")).toBe("frontend-integration");
    expect(classifyFileRole("frontend/src/app/page.js")).toBe("presentation");
    expect(classifyFileRole("frontend/src/app/quiz/generate/page.js")).toBe("presentation");
    expect(classifyFileRole("shared/schemas/quiz.schema.ts")).toBe("schema-types");
    expect(classifyFileRole("backend/__tests__/quiz.test.ts")).toBe("test");

    // For implementation queries, backend service outranks root landing page
    const serviceBoost = computeRoleRelevanceAdjustment(
      "implementation",
      "backend-implementation",
      "backend/services/quizService.js"
    );
    const landingBoost = computeRoleRelevanceAdjustment(
      "implementation",
      "presentation",
      "frontend/src/app/page.js"
    );
    expect(serviceBoost).toBeGreaterThan(landingBoost);

    // For UI queries, presentation is boosted
    const uiBoost = computeRoleRelevanceAdjustment(
      "ui",
      "presentation",
      "frontend/src/app/quiz/generate/page.js"
    );
    expect(uiBoost).toBeGreaterThan(0);
  });
});
