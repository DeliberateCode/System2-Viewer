/**
 * Standardized API response types.
 */

export enum StatusCode {
  OK = 200,
  Created = 201,
  NoContent = 204,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  Conflict = 409,
  InternalError = 500,
}

export interface ApiResponse<T = unknown> {
  status: StatusCode;
  data?: T;
  message?: string;
  timestamp: string;
}

export class ApiError extends Error {
  public readonly status: StatusCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    status: StatusCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function successResponse<T>(data: T, status: StatusCode = StatusCode.OK): ApiResponse<T> {
  return {
    status,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function errorResponse(error: ApiError): ApiResponse {
  return {
    status: error.status,
    message: error.message,
    timestamp: new Date().toISOString(),
  };
}
