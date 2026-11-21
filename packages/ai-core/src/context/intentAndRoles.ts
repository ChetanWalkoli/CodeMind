export type QueryIntent =
  "implementation" | "ui" | "api" | "debugging" | "architecture" | "neutral";

export type FileRole =
  | "backend-implementation"
  | "frontend-integration"
  | "presentation"
  | "schema-types"
  | "config"
  | "test"
  | "general";

/**
 * Deterministic query intent classifier (no AI calls).
 */
export function classifyQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase().trim();

  if (/\b(why|fail|failing|failed|error|bug|broken|crash|fix|issue|exception)\b/.test(lower)) {
    return "debugging";
  }

  if (
    /\b(ui|display|displayed|render|rendered|layout|style|styling|css|scss|button|form|modal|landing|screen|component)\b/.test(
      lower
    )
  ) {
    return "ui";
  }

  if (
    /\b(api|endpoint|route|routes|http|request|response|rest|controller|backend|server)\b/.test(
      lower
    )
  ) {
    return "api";
  }

  if (/\b(architecture|overview|structure|modules|layers|system design|codebase)\b/.test(lower)) {
    return "architecture";
  }

  if (
    /\b(how\s+(?:does|do|is|are)|where\s+(?:is|are)|implement|implemented|work|works|generat\w*|process\w*|handl\w*|flow|logic|pipeline)\b/.test(
      lower
    )
  ) {
    return "implementation";
  }

  return "neutral";
}

/**
 * Multi-signal file role classifier using path conventions, filenames, and extracted symbols.
 */
export function classifyFileRole(filePath: string, symbolNames: readonly string[] = []): FileRole {
  const lower = filePath.replace(/\\/g, "/").toLowerCase();
  const baseName = lower.split("/").pop() ?? lower;

  // 1. Tests
  if (
    /(?:^|\/)(?:__tests__|tests?|spec)\//.test(lower) ||
    /\.(?:test|spec)\.[a-z0-9]+$/.test(baseName)
  ) {
    return "test";
  }

  // 2. Configuration
  if (
    /(?:^|\/)config\//.test(lower) ||
    /^(?:package\.json|tsconfig.*\.json|vite\.config|next\.config|eslint\.config|\.env\.example)/.test(
      baseName
    )
  ) {
    return "config";
  }

  // 3. Schemas / Types / Models
  if (
    /(?:^|\/)(?:schemas?|types?|models?|dto)\//.test(lower) ||
    /\.(?:schema|types?|model|dto)\.[a-z0-9]+$/.test(baseName)
  ) {
    return "schema-types";
  }

  // 4. Backend implementation (services, controllers, routes, handlers, api routes, server)
  if (
    /(?:^|\/)(?:backend|server|api|routes?|controllers?|services?|handlers?|repositories?|use-?cases?|actions?)\//.test(
      lower
    ) ||
    /(?:^|\/)app\/api\/.*\/route\.[a-z]+$/.test(lower) ||
    /(?:^|\/)pages\/api\//.test(lower) ||
    /(?:controller|service|router|routes?|handler|repository)\.[a-z0-9]+$/.test(baseName)
  ) {
    // Distinguish frontend API client helpers (e.g. frontend/src/lib/api.js or src/services/api.ts)
    if (/(?:^|\/)frontend\//.test(lower) && /(?:^|\/)(?:lib|services?)\/.*api/.test(lower)) {
      return "frontend-integration";
    }
    return "backend-implementation";
  }

  // 5. Frontend API integration / hooks / stores
  if (
    /(?:^|\/)(?:lib\/api|services\/api|api-?client|hooks?|stores?)\b/.test(lower) ||
    /api\.[a-z0-9]+$/.test(baseName) ||
    symbolNames.some((s) => /api|client|fetch/i.test(s))
  ) {
    return "frontend-integration";
  }

  // 6. Presentation / UI / Landing pages
  if (
    /(?:^|\/)(?:components?|layouts?|pages?|app|views?|styles?|ui|marketing|landing)\//.test(
      lower
    ) ||
    /^(?:page|layout|loading|error)\.[a-z0-9]+$/.test(baseName) ||
    /\.(?:css|scss|less|html)$/.test(baseName)
  ) {
    return "presentation";
  }

  return "general";
}

/**
 * Bounded relevance score adjustment based on query intent and file role.
 * Designed so strong exact symbol/explicit matches always win over role boosts.
 */
export function computeRoleRelevanceAdjustment(
  intent: QueryIntent,
  role: FileRole,
  filePath: string
): number {
  const lower = filePath.replace(/\\/g, "/").toLowerCase();
  const isRootLandingPage =
    /(?:^|\/)app\/page\.[a-z]+$/.test(lower) || /(?:^|\/)pages\/index\.[a-z]+$/.test(lower);

  switch (intent) {
    case "implementation":
    case "debugging": {
      if (role === "backend-implementation") return 35;
      if (role === "frontend-integration") return 26;
      if (role === "schema-types") return 14;
      if (role === "presentation") return isRootLandingPage ? -22 : 4;
      if (role === "test") return -12;
      if (role === "config") return -15;
      return 0;
    }
    case "api": {
      if (role === "backend-implementation") return 40;
      if (role === "frontend-integration") return 30;
      if (role === "schema-types") return 16;
      if (role === "presentation") return isRootLandingPage ? -25 : -6;
      if (role === "test") return -12;
      return 0;
    }
    case "ui": {
      if (role === "presentation") return 30;
      if (role === "frontend-integration") return 15;
      if (role === "backend-implementation") return -5;
      if (role === "test") return -12;
      return 0;
    }
    case "architecture": {
      if (role === "backend-implementation") return 16;
      if (role === "frontend-integration") return 14;
      if (role === "schema-types") return 12;
      if (role === "presentation") return isRootLandingPage ? -5 : 8;
      if (role === "test") return -15;
      return 0;
    }
    case "neutral":
    default:
      if (role === "test") return -8;
      return 0;
  }
}
