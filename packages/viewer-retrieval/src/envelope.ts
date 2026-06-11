/**
 * ResultEnvelope construction and structural validation.
 */

import type {
  EvidenceRef,
  ExtractionQuality,
  PartialitySummaryRef,
  ResultEnvelope,
  SuggestedCall,
  UncertaintyItem,
} from './types.js';

/** Input for constructing a ResultEnvelope. */
export interface EnvelopeInput<T> {
  op: string;
  args: Record<string, unknown>;
  data: T;
  evidence?: EvidenceRef[];
  uncertainties?: UncertaintyItem[];
  partiality?: PartialitySummaryRef;
  extractionQuality?: ExtractionQuality;
  suggestedNextCalls?: SuggestedCall[];
  modelRevision: string;
}

/**
 * Constructs a well-formed ResultEnvelope from the provided input.
 * Fills optional array fields with empty arrays when not provided.
 */
export function buildEnvelope<T>(input: EnvelopeInput<T>): ResultEnvelope<T> {
  const envelope: ResultEnvelope<T> = {
    query: { op: input.op, args: input.args },
    data: input.data,
    evidence: input.evidence ?? [],
    uncertainties: input.uncertainties ?? [],
    suggestedNextCalls: input.suggestedNextCalls ?? [],
    modelRevision: input.modelRevision,
  };

  if (input.partiality !== undefined) {
    envelope.partiality = input.partiality;
  }

  if (input.extractionQuality !== undefined) {
    envelope.extractionQuality = input.extractionQuality;
  }

  return envelope;
}

/**
 * Validates that a value has the shape of a ResultEnvelope.
 *
 * Rejects:
 * - strings, null, undefined, non-objects
 * - missing or non-object `data`
 * - missing structured `query` (must have `op` string and `args` object)
 * - empty `modelRevision`
 * - non-array `evidence`, `uncertainties`, or `suggestedNextCalls`
 *
 * @throws {TypeError} if the value does not satisfy the ResultEnvelope shape
 */
export function assertStructured<T>(
  value: unknown,
): asserts value is ResultEnvelope<T> {
  if (value === null || value === undefined) {
    throw new TypeError('Expected ResultEnvelope, got null or undefined');
  }

  if (typeof value === 'string') {
    throw new TypeError('Expected ResultEnvelope, got string');
  }

  if (typeof value !== 'object') {
    throw new TypeError(
      `Expected ResultEnvelope, got ${typeof value}`,
    );
  }

  const obj = value as Record<string, unknown>;

  // Validate query
  if (
    obj['query'] === null ||
    obj['query'] === undefined ||
    typeof obj['query'] !== 'object'
  ) {
    throw new TypeError(
      'ResultEnvelope.query must be a non-null object with op and args',
    );
  }

  const query = obj['query'] as Record<string, unknown>;
  if (typeof query['op'] !== 'string' || query['op'].length === 0) {
    throw new TypeError('ResultEnvelope.query.op must be a non-empty string');
  }
  if (
    query['args'] === null ||
    query['args'] === undefined ||
    typeof query['args'] !== 'object'
  ) {
    throw new TypeError('ResultEnvelope.query.args must be a non-null object');
  }

  // Validate data
  if (!('data' in obj)) {
    throw new TypeError('ResultEnvelope.data is required');
  }
  if (obj['data'] === null || obj['data'] === undefined) {
    throw new TypeError('ResultEnvelope.data must not be null or undefined');
  }
  if (typeof obj['data'] !== 'object') {
    throw new TypeError('ResultEnvelope.data must be an object');
  }

  // Validate modelRevision
  if (
    typeof obj['modelRevision'] !== 'string' ||
    obj['modelRevision'].length === 0
  ) {
    throw new TypeError(
      'ResultEnvelope.modelRevision must be a non-empty string',
    );
  }

  // Validate evidence array
  if (!Array.isArray(obj['evidence'])) {
    throw new TypeError('ResultEnvelope.evidence must be an array');
  }

  // Validate uncertainties array
  if (!Array.isArray(obj['uncertainties'])) {
    throw new TypeError('ResultEnvelope.uncertainties must be an array');
  }

  // Validate suggestedNextCalls array
  if (!Array.isArray(obj['suggestedNextCalls'])) {
    throw new TypeError('ResultEnvelope.suggestedNextCalls must be an array');
  }
}
