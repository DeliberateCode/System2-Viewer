/**
 * Error handling middleware.
 */

import { CoreError } from '@sample/core';
import { ApiError, StatusCode, errorResponse, ApiResponse } from '../response.js';

export function errorMiddleware(error: unknown): ApiResponse {
  if (error instanceof ApiError) {
    return errorResponse(error);
  }

  if (error instanceof CoreError) {
    const status = error.code === 'NOT_FOUND'
      ? StatusCode.NotFound
      : error.code === 'UNAUTHORIZED'
      ? StatusCode.Unauthorized
      : StatusCode.BadRequest;
    return errorResponse(new ApiError(status, error.message));
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return errorResponse(new ApiError(StatusCode.InternalError, message));
}
