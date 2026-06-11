import { describe, it, expect } from 'vitest';
import { capitalize, truncate, slugify, camelCase } from '../string/transform.js';
import { escapeHtml, unescapeHtml } from '../string/escape.js';

describe('string transform', () => {
  it('should capitalize first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
    expect(capitalize('')).toBe('');
  });

  it('should truncate long strings', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('short', 10)).toBe('short');
  });

  it('should slugify strings', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  Foo  Bar  ')).toBe('foo-bar');
  });

  it('should convert to camelCase', () => {
    expect(camelCase('hello-world')).toBe('helloWorld');
    expect(camelCase('foo_bar_baz')).toBe('fooBarBaz');
  });
});

describe('string escape', () => {
  it('should escape HTML entities', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('should unescape HTML entities', () => {
    expect(unescapeHtml('&lt;div&gt;')).toBe('<div>');
    expect(unescapeHtml('a &amp; b')).toBe('a & b');
  });
});
