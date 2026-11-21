/**
 * Deterministic, static cross-layer HTTP API relationship extractor.
 * Discovers frontend-to-backend API connections without executing source code
 * (no eval, no new Function).
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ANY";

export interface ExtractedApiCall {
  filePath: string;
  method: HttpMethod;
  rawEndpoint: string;
  normalizedEndpoint: string;
  line: number;
}

export interface ExtractedApiHandler {
  filePath: string;
  method: HttpMethod;
  rawEndpoint: string;
  normalizedEndpoint: string;
  line: number;
  framework: "express" | "nextjs-app" | "nextjs-pages";
}

export interface ExtractedRouteMount {
  filePath: string;
  mountPrefix: string;
  routerIdentifier: string;
  line: number;
}

export interface ApiRelationship {
  method: HttpMethod;
  endpoint: string;
  callerFile: string;
  callerLine: number;
  handlerFile: string;
  handlerLine: number;
  confidence: "confirmed" | "inferred";
  ambiguous: boolean;
  explanation: string;
}

export function normalizeApiEndpoint(raw: string): string {
  let cleaned = raw.trim();
  // Strip protocol/host if hardcoded localhost/origin
  cleaned = cleaned.replace(/^https?:\/\/[^/]+/i, "");
  // Strip query string and hash
  cleaned = cleaned.split(/[?#]/)[0] ?? cleaned;
  // Normalize template literals like ${id} or ${API_BASE}/quiz/generate
  cleaned = cleaned.replace(/^\$\{[^}]+\}/, "");
  cleaned = cleaned.replace(/\$\{[^}]+\}/g, ":param");
  // Normalize Next.js [id] or [...slug] and Express :id parameters
  cleaned = cleaned.replace(/\[\.\.\.[^\]]+\]/g, ":param");
  cleaned = cleaned.replace(/\[[^\]]+\]/g, ":param");
  cleaned = cleaned.replace(/:[a-zA-Z0-9_]+/g, ":param");
  // Ensure leading slash, collapse duplicate slashes, strip trailing slash
  if (!cleaned.startsWith("/")) {
    cleaned = `/${cleaned}`;
  }
  cleaned = cleaned.replace(/\/+/g, "/");
  if (cleaned.length > 1 && cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned.toLowerCase();
}

function lineNumberAtIndex(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function normalizeMethod(raw?: string): HttpMethod {
  const upper = (raw ?? "").toUpperCase();
  if (
    upper === "GET" ||
    upper === "POST" ||
    upper === "PUT" ||
    upper === "PATCH" ||
    upper === "DELETE"
  ) {
    return upper;
  }
  return "ANY";
}

/**
 * Statically extracts API calls, backend route handlers, and Express route mounts from one file.
 */
export function extractApiArtifactsFromFile(
  filePath: string,
  content: string
): {
  calls: ExtractedApiCall[];
  handlers: ExtractedApiHandler[];
  mounts: ExtractedRouteMount[];
} {
  const calls: ExtractedApiCall[] = [];
  const handlers: ExtractedApiHandler[] = [];
  const mounts: ExtractedRouteMount[] = [];
  const posix = filePath.replace(/\\/g, "/");

  // 1. Next.js App Router: .../app/api/.../route.{ts,tsx,js,mjs}
  const nextAppMatch = /(?:^|\/)app(\/api(?:\/[^/]+)*)\/route\.(?:ts|tsx|js|mjs|cjs)$/i.exec(posix);
  if (nextAppMatch && nextAppMatch[1]) {
    const endpoint = normalizeApiEndpoint(nextAppMatch[1]);
    const methodRegex = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
    let foundAny = false;
    for (const m of content.matchAll(methodRegex)) {
      foundAny = true;
      handlers.push({
        filePath: posix,
        method: normalizeMethod(m[1]),
        rawEndpoint: nextAppMatch[1],
        normalizedEndpoint: endpoint,
        line: lineNumberAtIndex(content, m.index ?? 0),
        framework: "nextjs-app"
      });
    }
    if (!foundAny) {
      handlers.push({
        filePath: posix,
        method: "ANY",
        rawEndpoint: nextAppMatch[1],
        normalizedEndpoint: endpoint,
        line: 1,
        framework: "nextjs-app"
      });
    }
  }

  // 2. Next.js Pages Router: .../pages/api/...
  const nextPagesMatch = /(?:^|\/)pages(\/api\/.+?)\.(?:ts|tsx|js|mjs|cjs)$/i.exec(posix);
  if (nextPagesMatch && nextPagesMatch[1]) {
    const rawEp = nextPagesMatch[1].replace(/\/index$/i, "");
    handlers.push({
      filePath: posix,
      method: "ANY",
      rawEndpoint: rawEp,
      normalizedEndpoint: normalizeApiEndpoint(rawEp),
      line: 1,
      framework: "nextjs-pages"
    });
  }

  // 3. Express route handlers: router.post("/generate", ...) or app.get("/api/quiz/:id", ...)
  const expressHandlerRegex =
    /\b(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`\r\n]+)["'`]/gi;
  for (const m of content.matchAll(expressHandlerRegex)) {
    const rawEndpoint = m[2]!;
    if (!rawEndpoint.startsWith("/")) continue;
    handlers.push({
      filePath: posix,
      method: normalizeMethod(m[1]),
      rawEndpoint,
      normalizedEndpoint: normalizeApiEndpoint(rawEndpoint),
      line: lineNumberAtIndex(content, m.index ?? 0),
      framework: "express"
    });
  }

  // 4. Express route mounts: app.use("/api/quiz", quizRoutes)
  const mountRegex = /\b(?:app|router)\.use\s*\(\s*["'`]([^"'`\r\n]+)["'`]\s*,\s*([a-zA-Z0-9_$]+)/g;
  for (const m of content.matchAll(mountRegex)) {
    const mountPrefix = m[1]!;
    if (!mountPrefix.startsWith("/")) continue;
    mounts.push({
      filePath: posix,
      mountPrefix: normalizeApiEndpoint(mountPrefix),
      routerIdentifier: m[2]!,
      line: lineNumberAtIndex(content, m.index ?? 0)
    });
  }

  // 5. Frontend fetch() calls: fetch("/api/quiz/generate", { method: "POST" })
  const fetchRegex =
    /\bfetch\s*\(\s*["'`]([^"'`\r\n]*\/[^"'`\r\n]+)["'`]\s*(?:,\s*\{([^}]{0,240})\})?/g;
  for (const m of content.matchAll(fetchRegex)) {
    const rawEndpoint = m[1]!;
    if (!/\/api\/|\/v\d+\//i.test(rawEndpoint) && !rawEndpoint.startsWith("/")) continue;
    const optsBlock = m[2] ?? "";
    const methodMatch = /method\s*:\s*["'](GET|POST|PUT|PATCH|DELETE)["']/i.exec(optsBlock);
    calls.push({
      filePath: posix,
      method: methodMatch ? normalizeMethod(methodMatch[1]) : "GET",
      rawEndpoint,
      normalizedEndpoint: normalizeApiEndpoint(rawEndpoint),
      line: lineNumberAtIndex(content, m.index ?? 0)
    });
  }

  // 6. Axios / API client calls: axios.post("/api/quiz/generate", ...) or api.post("/quiz/generate", ...)
  const clientRegex =
    /\b(?:axios|api|apiClient|http|client)\.(get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*["'`]([^"'`\r\n]+)["'`]/gi;
  for (const m of content.matchAll(clientRegex)) {
    const rawEndpoint = m[2]!;
    if (!rawEndpoint.startsWith("/") && !rawEndpoint.includes("/")) continue;
    calls.push({
      filePath: posix,
      method: normalizeMethod(m[1]),
      rawEndpoint,
      normalizedEndpoint: normalizeApiEndpoint(rawEndpoint),
      line: lineNumberAtIndex(content, m.index ?? 0)
    });
  }

  return { calls, handlers, mounts };
}

function endpointsMatch(callerEp: string, handlerEp: string): "exact" | "suffix" | "none" {
  if (callerEp === handlerEp) return "exact";
  // Match when frontend uses baseURL "/api" and calls "/quiz/generate" while backend mounts "/api/quiz/generate"
  if (handlerEp === `/api${callerEp}` || callerEp === `/api${handlerEp}`) {
    return "exact";
  }
  // Match when Express router defines sub-route "/generate" inside "quizRoutes.js" and caller hits "/api/quiz/generate"
  if (handlerEp.length > 1 && (callerEp.endsWith(handlerEp) || handlerEp.endsWith(callerEp))) {
    return "suffix";
  }
  return "none";
}

function methodsCompatible(a: HttpMethod, b: HttpMethod): boolean {
  return a === "ANY" || b === "ANY" || a === b;
}

/**
 * Builds deterministic cross-layer API relationships between frontend callers and backend handlers.
 */
export function buildApiRelationships(
  allCalls: readonly ExtractedApiCall[],
  allHandlers: readonly ExtractedApiHandler[],
  allMounts: readonly ExtractedRouteMount[] = []
): ApiRelationship[] {
  // Expand Express sub-routes using matching mount prefixes (e.g. app.use("/api/quiz", quizRoutes))
  const expandedHandlers: ExtractedApiHandler[] = [...allHandlers];

  for (const mount of allMounts) {
    const routerToken = mount.routerIdentifier.toLowerCase().replace(/routes?$|router$/i, "");
    if (routerToken.length < 2) continue;

    for (const h of allHandlers) {
      if (h.framework !== "express") continue;
      if (h.normalizedEndpoint.startsWith(mount.mountPrefix)) continue;

      const lowerPath = h.filePath.toLowerCase();
      if (lowerPath.includes(routerToken)) {
        const joined = normalizeApiEndpoint(`${mount.mountPrefix}${h.normalizedEndpoint}`);
        expandedHandlers.push({
          ...h,
          normalizedEndpoint: joined
        });
      }
    }
  }

  const relationships: ApiRelationship[] = [];
  const seen = new Set<string>();

  for (const call of allCalls) {
    const exactMatches: ExtractedApiHandler[] = [];
    const suffixMatches: ExtractedApiHandler[] = [];

    for (const handler of expandedHandlers) {
      if (handler.filePath === call.filePath) continue;
      if (!methodsCompatible(call.method, handler.method)) continue;

      const matchType = endpointsMatch(call.normalizedEndpoint, handler.normalizedEndpoint);
      if (matchType === "exact") {
        exactMatches.push(handler);
      } else if (matchType === "suffix") {
        // Require at least one shared path segment token with handler filename to avoid false suffix matches
        const callSegments = call.normalizedEndpoint
          .split("/")
          .filter((s) => s && s !== "api" && s !== ":param");
        const handlerPathLower = handler.filePath.toLowerCase();
        if (callSegments.some((seg) => seg.length >= 3 && handlerPathLower.includes(seg))) {
          suffixMatches.push(handler);
        }
      }
    }

    const candidates = exactMatches.length > 0 ? exactMatches : suffixMatches;
    const uniqueByFile = new Map<string, ExtractedApiHandler>();
    for (const c of candidates) {
      if (!uniqueByFile.has(c.filePath)) {
        uniqueByFile.set(c.filePath, c);
      }
    }

    const matchedHandlers = Array.from(uniqueByFile.values());
    const ambiguous = matchedHandlers.length > 1;
    const confidence: "confirmed" | "inferred" =
      exactMatches.length > 0 && !ambiguous ? "confirmed" : "inferred";

    for (const handler of matchedHandlers) {
      const key = `${call.filePath}:${call.line}->${handler.filePath}:${handler.line}:${handler.normalizedEndpoint}`;
      if (seen.has(key)) continue;
      seen.add(key);

      relationships.push({
        method: call.method !== "ANY" ? call.method : handler.method,
        endpoint: handler.normalizedEndpoint,
        callerFile: call.filePath,
        callerLine: call.line,
        handlerFile: handler.filePath,
        handlerLine: handler.line,
        confidence,
        ambiguous,
        explanation: `${call.method} ${call.normalizedEndpoint} -> ${handler.filePath}:${handler.line}`
      });
    }
  }

  relationships.sort(
    (a, b) =>
      a.endpoint.localeCompare(b.endpoint) ||
      a.callerFile.localeCompare(b.callerFile) ||
      a.handlerFile.localeCompare(b.handlerFile)
  );

  return relationships;
}
