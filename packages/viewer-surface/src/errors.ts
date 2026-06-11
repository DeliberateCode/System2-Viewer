/**
 * Surface-level error types.
 */

/**
 * Thrown when a read operation is attempted before any model has been indexed.
 * Provides a structured message directing the user to run `viewer.index`.
 */
export class NoModelIndexedError extends Error {
  override readonly name = 'NoModelIndexedError';

  constructor() {
    super(
      'Run `viewer.index` with the repository root to build the model before querying.',
    );
  }
}
