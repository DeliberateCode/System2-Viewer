/**
 * Validation utilities.
 */

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export type Validator<T> = (value: T) => ValidationResult;

export function validate<T>(
  value: T,
  validators: Validator<T>[],
): ValidationResult {
  const allErrors: ValidationError[] = [];

  for (const validator of validators) {
    const result = validator(value);
    if (!result.valid) {
      allErrors.push(...result.errors);
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

export function requiredString(field: string): Validator<Record<string, unknown>> {
  return (value) => {
    const fieldValue = value[field];
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
      return {
        valid: false,
        errors: [{ field, message: `${field} is required`, code: 'REQUIRED' }],
      };
    }
    return { valid: true, errors: [] };
  };
}

export function maxLength(field: string, max: number): Validator<Record<string, unknown>> {
  return (value) => {
    const fieldValue = value[field];
    if (typeof fieldValue === 'string' && fieldValue.length > max) {
      return {
        valid: false,
        errors: [{ field, message: `${field} must be at most ${max} characters`, code: 'MAX_LENGTH' }],
      };
    }
    return { valid: true, errors: [] };
  };
}
