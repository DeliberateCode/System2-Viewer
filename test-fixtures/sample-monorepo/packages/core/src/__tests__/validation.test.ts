import { describe, it, expect } from 'vitest';
import { validate, requiredString, maxLength } from '../validation.js';

describe('validation', () => {
  it('should pass with valid input', () => {
    const result = validate(
      { name: 'hello' },
      [requiredString('name')],
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail on missing required string', () => {
    const result = validate(
      { name: '' },
      [requiredString('name')],
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('REQUIRED');
  });

  it('should fail on max length exceeded', () => {
    const result = validate(
      { name: 'a'.repeat(101) },
      [maxLength('name', 100)],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('MAX_LENGTH');
  });

  it('should aggregate errors from multiple validators', () => {
    const result = validate(
      { name: '', title: 'x'.repeat(200) },
      [requiredString('name'), maxLength('title', 100)],
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
