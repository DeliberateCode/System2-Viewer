/**
 * Content-level secret scrubbing with known-prefix patterns and Shannon entropy detection.
 *
 * Two-phase detection:
 *   1. Known-prefix regex patterns (zero false positives)
 *   2. Shannon entropy >= 4.5 bits/char AND >= 40 characters (high-entropy strings)
 *
 * Exemptions: git hashes (40-char hex), UUIDs (36 chars with dashes),
 * already-redacted markers.
 */

export interface ScrubResult {
  scrubbed: string;
  secretsFound: number;
  patterns: string[];
}

interface PatternDef {
  name: string;
  regex: RegExp;
  replacement: string;
}

const KNOWN_PATTERNS: ReadonlyArray<PatternDef> = [
  {
    name: 'aws-key',
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED:aws-key]',
  },
  {
    name: 'github-token',
    regex: /gh[ps]_[A-Za-z0-9]{36,}/g,
    replacement: '[REDACTED:github-token]',
  },
  {
    name: 'slack-token',
    regex: /xox[bpras]-[A-Za-z0-9\-]{10,}/g,
    replacement: '[REDACTED:slack-token]',
  },
  {
    name: 'api-key',
    regex: /sk-[A-Za-z0-9]{20,}/g,
    replacement: '[REDACTED:api-key]',
  },
  {
    name: 'private-key',
    regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED:private-key]',
  },
];

const HIGH_ENTROPY_REGEX = /\S{40,}/g;
const ENTROPY_THRESHOLD = 4.5;
const GIT_HASH_RE = /^[0-9a-f]{40}$/;
const LOWERCASE_WITH_SPACES_RE = /^[a-z ]+$/;

/**
 * Pre-filter: returns true if the string is obviously not a secret and
 * entropy calculation can be skipped. Avoids O(n * charSet) frequency
 * counting for natural-language strings.
 */
function isObviouslyNotSecret(s: string): boolean {
  // Strings with 3+ spaces are likely natural language
  let spaceCount = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 32) {
      spaceCount++;
      if (spaceCount >= 3) return true;
    }
  }

  // All-lowercase ASCII with spaces is natural language
  if (LOWERCASE_WITH_SPACES_RE.test(s)) return true;

  return false;
}

/**
 * Compute Shannon entropy in bits per character.
 */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of s) {
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Scrub secrets from content text.
 * Applied before any text reaches the model store (FTS, claims, evidence).
 */
export function scrubSecrets(content: string): ScrubResult {
  let scrubbed = content;
  let secretsFound = 0;
  const patterns: string[] = [];

  // Phase 1: Known-prefix patterns
  for (const pattern of KNOWN_PATTERNS) {
    // Reset lastIndex for global regexes that may have been used before
    pattern.regex.lastIndex = 0;
    const matches = scrubbed.match(pattern.regex);
    if (matches) {
      secretsFound += matches.length;
      patterns.push(pattern.name);
      scrubbed = scrubbed.replace(pattern.regex, pattern.replacement);
    }
  }

  // Phase 2: Generic high-entropy detection
  scrubbed = scrubbed.replace(HIGH_ENTROPY_REGEX, (match) => {
    // Skip already-redacted markers
    if (match.startsWith('[REDACTED')) return match;
    // Skip git hashes (exactly 40 lowercase hex chars)
    if (GIT_HASH_RE.test(match)) return match;
    // Skip strings that are obviously not secrets (natural language)
    if (isObviouslyNotSecret(match)) return match;

    const entropy = shannonEntropy(match);
    if (entropy > ENTROPY_THRESHOLD) {
      secretsFound++;
      return '[REDACTED]';
    }
    return match;
  });

  return { scrubbed, secretsFound, patterns };
}

export function getPatternCount(): number {
  return KNOWN_PATTERNS.length + 1; // +1 for generic entropy pattern
}
