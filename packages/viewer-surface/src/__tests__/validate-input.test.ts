/**
 * Tests for validateUntrustedInput -- structural guard against
 * prototype pollution and function injection in MCP tool args.
 *
 */
import { describe, it, expect } from 'vitest';
import { validateUntrustedInput } from '../validate-input.js';

// ---------------------------------------------------------------------------
// Prototype-pollution keys
// ---------------------------------------------------------------------------

describe('validateUntrustedInput', () => {
  it('throws on __proto__ key', () => {
    const obj = JSON.parse('{"__proto__": {}}') as Record<string, unknown>;
    expect(() => validateUntrustedInput(obj)).toThrow(TypeError);
    expect(() => validateUntrustedInput(obj)).toThrow('__proto__');
  });

  it('throws on constructor key', () => {
    const obj = { constructor: {} };
    expect(() => validateUntrustedInput(obj)).toThrow(TypeError);
    expect(() => validateUntrustedInput(obj)).toThrow('constructor');
  });

  it('throws on prototype key', () => {
    const obj = { prototype: {} };
    expect(() => validateUntrustedInput(obj)).toThrow(TypeError);
    expect(() => validateUntrustedInput(obj)).toThrow('prototype');
  });

  // ---------------------------------------------------------------------------
  // Valid inputs
  // ---------------------------------------------------------------------------

  it('does not throw on normal object', () => {
    expect(() => validateUntrustedInput({ normal: 'value' })).not.toThrow();
  });

  it('does not throw on non-objects (numbers pass through)', () => {
    expect(() => validateUntrustedInput(42)).not.toThrow();
  });

  it('does not throw on null', () => {
    expect(() => validateUntrustedInput(null)).not.toThrow();
  });

  it('does not throw on strings', () => {
    expect(() => validateUntrustedInput('hello')).not.toThrow();
  });

  it('does not throw on empty object', () => {
    expect(() => validateUntrustedInput({})).not.toThrow();
  });

  it('does not throw on arrays of safe values', () => {
    expect(() => validateUntrustedInput([1, 'a', { safe: true }])).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Nested prototype pollution
  // ---------------------------------------------------------------------------

  it('catches nested __proto__ key', () => {
    const obj = JSON.parse('{"a": {"__proto__": {}}}') as Record<string, unknown>;
    expect(() => validateUntrustedInput(obj)).toThrow(TypeError);
    expect(() => validateUntrustedInput(obj)).toThrow('__proto__');
  });

  it('catches deeply nested constructor key', () => {
    const obj = { a: { b: { constructor: {} } } };
    expect(() => validateUntrustedInput(obj)).toThrow(TypeError);
    expect(() => validateUntrustedInput(obj)).toThrow('constructor');
  });

  it('catches prototype key inside array element', () => {
    const obj = [{ prototype: {} }];
    expect(() => validateUntrustedInput(obj)).toThrow(TypeError);
    expect(() => validateUntrustedInput(obj)).toThrow('prototype');
  });

  // ---------------------------------------------------------------------------
  // Function rejection
  // ---------------------------------------------------------------------------

  it('throws on function values', () => {
    expect(() => validateUntrustedInput(() => {})).toThrow(TypeError);
    expect(() => validateUntrustedInput(() => {})).toThrow('function');
  });

  it('throws on nested function values', () => {
    expect(() => validateUntrustedInput({ fn: () => {} })).toThrow(TypeError);
  });
});
