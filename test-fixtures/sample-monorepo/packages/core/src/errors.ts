/**
 * Core error hierarchy.
 */

export class CoreError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
  }
}

export class NotFoundError extends CoreError {
  public readonly resourceType: string;
  public readonly resourceId: string;

  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} with id '${resourceId}' not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

export class ValidationFailedError extends CoreError {
  public readonly fieldErrors: Array<{ field: string; message: string }>;

  constructor(fieldErrors: Array<{ field: string; message: string }>) {
    const summary = fieldErrors.map(e => `${e.field}: ${e.message}`).join(', ');
    super(`Validation failed: ${summary}`, 'VALIDATION_FAILED');
    this.name = 'ValidationFailedError';
    this.fieldErrors = fieldErrors;
  }
}

export class AuthorizationError extends CoreError {
  constructor(action: string, resource: string) {
    super(`Not authorized to ${action} on ${resource}`, 'UNAUTHORIZED');
    this.name = 'AuthorizationError';
  }
}
