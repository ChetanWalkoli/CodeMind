export interface InlineSecretMatch {
  ruleId: string;
  description: string;
  line: number;
}

interface SecretRule {
  id: string;
  description: string;
  pattern: RegExp;
}

const INLINE_SECRET_RULES: readonly SecretRule[] = [
  {
    id: "google-api-key",
    description: "Google / Gemini API key",
    pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/
  },
  {
    id: "sk-prefixed-api-key",
    description: "Secret API key token",
    pattern: /\bsk-(?:proj-)?[a-zA-Z0-9_-]{20,}\b/
  },
  {
    id: "aws-access-key",
    description: "AWS Access Key ID",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    id: "github-token",
    description: "GitHub personal access token",
    pattern: /\b(?:ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,})\b/
  },
  {
    id: "slack-token",
    description: "Slack API token",
    pattern: /\bxox[baprs]-[0-9a-zA-Z-]{16,}\b/
  },
  {
    id: "private-key-block",
    description: "PEM private key header",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/
  },
  {
    id: "hardcoded-secret-assignment",
    description: "Hardcoded secret/API key literal",
    pattern:
      /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key)\b\s*[:=]\s*["'][a-zA-Z0-9_/+=-]{16,}["']/i
  }
];

/**
 * Scans source text for high-confidence inline secrets (never returns the matched secret value).
 */
export function detectInlineSecrets(content: string): InlineSecretMatch[] {
  if (!content) return [];
  const matches: InlineSecretMatch[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i]!;
    for (const rule of INLINE_SECRET_RULES) {
      if (rule.pattern.test(lineText)) {
        matches.push({
          ruleId: rule.id,
          description: rule.description,
          line: i + 1
        });
      }
    }
  }

  return matches;
}
