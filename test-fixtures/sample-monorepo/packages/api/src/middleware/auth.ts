/**
 * Authentication middleware.
 */

import { CoreError } from '@sample/core';

export interface AuthContext {
  userId: string;
  role: string;
  token: string;
}

export function authMiddleware(token: string | undefined): AuthContext {
  if (!token) {
    throw new CoreError('Authentication required', 'AUTH_REQUIRED');
  }

  if (!token.startsWith('Bearer ')) {
    throw new CoreError('Invalid token format', 'INVALID_TOKEN');
  }

  // Simulate token parsing (no real auth in fixture)
  const payload = token.slice(7);
  return {
    userId: `user_${payload.length}`,
    role: 'viewer',
    token: payload,
  };
}
