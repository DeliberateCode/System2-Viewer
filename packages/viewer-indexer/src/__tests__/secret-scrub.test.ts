import { describe, it, expect } from 'vitest';
import { scrubSecrets, shannonEntropy } from '../secret-scrub.js';
import type { ScrubResult } from '../secret-scrub.js';

describe('shannonEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 for single repeated character', () => {
    expect(shannonEntropy('aaaaaaaaaa')).toBe(0);
  });

  it('returns 1.0 for two equally distributed characters', () => {
    // "ab" repeated gives exactly 1 bit per character
    const result = shannonEntropy('abababababababababab');
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('returns higher entropy for more diverse strings', () => {
    const low = shannonEntropy('aaabbb');
    const high = shannonEntropy('abcdef');
    expect(high).toBeGreaterThan(low);
  });

  it('returns near log2(N) for N uniformly distributed characters', () => {
    // 4 equally distributed characters -> log2(4) = 2.0
    const s = 'abcdabcdabcdabcd';
    expect(shannonEntropy(s)).toBeCloseTo(2.0, 5);
  });
});

describe('scrubSecrets', () => {
  describe('known-prefix patterns', () => {
    it('detects and redacts AWS access key IDs', () => {
      const result = scrubSecrets('key=AKIAIOSFODNN7EXAMPLE');
      expect(result.scrubbed).toBe('key=[REDACTED:aws-key]');
      expect(result.secretsFound).toBe(1);
      expect(result.patterns).toContain('aws-key');
    });

    it('detects and redacts GitHub personal tokens (ghp_)', () => {
      const token = 'ghp_' + 'A'.repeat(36);
      const result = scrubSecrets(`GITHUB_TOKEN=${token}`);
      expect(result.scrubbed).toBe('GITHUB_TOKEN=[REDACTED:github-token]');
      expect(result.secretsFound).toBe(1);
      expect(result.patterns).toContain('github-token');
    });

    it('detects and redacts GitHub server tokens (ghs_)', () => {
      const token = 'ghs_' + 'B'.repeat(36);
      const result = scrubSecrets(`token: ${token}`);
      expect(result.scrubbed).toBe('token: [REDACTED:github-token]');
      expect(result.secretsFound).toBe(1);
      expect(result.patterns).toContain('github-token');
    });

    it('detects and redacts Slack tokens', () => {
      const result = scrubSecrets('SLACK_TOKEN=xoxb-123456789012-abcdef');
      expect(result.scrubbed).toBe('SLACK_TOKEN=[REDACTED:slack-token]');
      expect(result.secretsFound).toBe(1);
      expect(result.patterns).toContain('slack-token');
    });

    it('detects and redacts OpenAI/Anthropic API keys', () => {
      const key = 'sk-' + 'a'.repeat(40);
      const result = scrubSecrets(`OPENAI_KEY=${key}`);
      expect(result.scrubbed).toBe('OPENAI_KEY=[REDACTED:api-key]');
      expect(result.secretsFound).toBe(1);
      expect(result.patterns).toContain('api-key');
    });

    it('detects and redacts PEM private key blocks', () => {
      const pem = [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB',
        'aNVt6WNbmTz/Mq2J6iE21RqJuCjC3RIXO+DJ3RRBCGwckg4UM5Ry4e3+',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n');
      const result = scrubSecrets(`cert:\n${pem}\nend`);
      expect(result.scrubbed).toBe('cert:\n[REDACTED:private-key]\nend');
      expect(result.secretsFound).toBe(1);
      expect(result.patterns).toContain('private-key');
    });

    it('detects multiple secrets in the same content', () => {
      const content = 'AWS=AKIAIOSFODNN7EXAMPLE slack=xoxb-abc-defghij-klmnop';
      const result = scrubSecrets(content);
      expect(result.scrubbed).toContain('[REDACTED:aws-key]');
      expect(result.scrubbed).toContain('[REDACTED:slack-token]');
      expect(result.secretsFound).toBe(2);
      expect(result.patterns).toContain('aws-key');
      expect(result.patterns).toContain('slack-token');
    });
  });

  describe('Shannon entropy detection', () => {
    it('detects high-entropy strings >= 40 chars with entropy > 4.5', () => {
      // A random-looking base64 string of 48 chars with high entropy
      const secret = 'aB3dE7fG9hJ1kL4mN6pQ8rS0tU2vW5xY7zA3cD6eF8gH1jK';
      const result = scrubSecrets(`token: ${secret}`);
      expect(result.scrubbed).toBe('token: [REDACTED]');
      expect(result.secretsFound).toBe(1);
    });

    it('does not redact low-entropy long strings', () => {
      // Repeated pattern, low entropy despite being 50 chars
      const lowEntropy = 'abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcab';
      const result = scrubSecrets(`data=${lowEntropy}`);
      expect(result.scrubbed).toBe(`data=${lowEntropy}`);
      expect(result.secretsFound).toBe(0);
    });

    it('does not redact strings shorter than 40 characters', () => {
      // High entropy but only 20 chars
      const shortSecret = 'aB3dE7fG9hJ1kL4mN6pQ';
      const result = scrubSecrets(`x=${shortSecret}`);
      expect(result.scrubbed).toBe(`x=${shortSecret}`);
      expect(result.secretsFound).toBe(0);
    });
  });

  describe('entropy pre-filter optimization', () => {
    it('skips entropy for strings with 3+ spaces (natural language)', () => {
      // 40+ chars, has 3+ spaces -> pre-filter skips entropy calc
      const text = 'this is a normal english sentence that happens to be quite long indeed';
      const joined = text.replace(/ /g, '_'); // no spaces -> single token
      // As a single long token it should still work, but the spaced version should not be redacted
      const result = scrubSecrets(text);
      expect(result.scrubbed).toBe(text);
      expect(result.secretsFound).toBe(0);
    });

    it('skips entropy for all-lowercase ASCII with spaces', () => {
      const text = 'abcdefghijklmnopqrstuvwxyz abcdefghijklmno';
      const result = scrubSecrets(text);
      expect(result.scrubbed).toBe(text);
      expect(result.secretsFound).toBe(0);
    });

    it('still detects high-entropy secrets without spaces', () => {
      const secret = 'aB3dE7fG9hJ1kL4mN6pQ8rS0tU2vW5xY7zA3cD6eF8gH1jK';
      const result = scrubSecrets(`token: ${secret}`);
      expect(result.scrubbed).toBe('token: [REDACTED]');
      expect(result.secretsFound).toBe(1);
    });
  });

  describe('exemptions', () => {
    it('does not scrub git hashes (40-char hex)', () => {
      const gitHash = 'a' + '1234567890abcdef1234567890abcdef1234567'.slice(0, 39);
      // Make it exactly 40 lowercase hex chars
      const hash40 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
      const result = scrubSecrets(`commit: ${hash40}`);
      expect(result.scrubbed).toBe(`commit: ${hash40}`);
      expect(result.secretsFound).toBe(0);
    });

    it('does not scrub UUIDs', () => {
      // UUIDs are 36 chars with dashes, under the 40-char threshold for non-whitespace runs
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = scrubSecrets(`id: ${uuid}`);
      expect(result.scrubbed).toBe(`id: ${uuid}`);
      expect(result.secretsFound).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('returns unchanged text for normal content', () => {
      const text = 'This is a normal text with no secrets.';
      const result = scrubSecrets(text);
      expect(result.scrubbed).toBe(text);
      expect(result.secretsFound).toBe(0);
      expect(result.patterns).toEqual([]);
    });

    it('returns unchanged empty string', () => {
      const result = scrubSecrets('');
      expect(result.scrubbed).toBe('');
      expect(result.secretsFound).toBe(0);
      expect(result.patterns).toEqual([]);
    });

    it('does not double-redact already redacted tokens', () => {
      const text = 'key=[REDACTED:aws-key] other=[REDACTED:api-key]';
      const result = scrubSecrets(text);
      expect(result.scrubbed).toBe(text);
      // The original redaction markers should not be counted as new secrets
    });
  });

  describe('ScrubResult type', () => {
    it('returns all expected fields', () => {
      const result: ScrubResult = scrubSecrets('token=AKIAIOSFODNN7EXAMPLE');
      expect(result).toHaveProperty('scrubbed');
      expect(result).toHaveProperty('secretsFound');
      expect(result).toHaveProperty('patterns');
      expect(typeof result.scrubbed).toBe('string');
      expect(typeof result.secretsFound).toBe('number');
      expect(Array.isArray(result.patterns)).toBe(true);
    });
  });
});
