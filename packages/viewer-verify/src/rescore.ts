/**
 * Rescoring via viewer-core's single scoring path.
 *
 * All rescoring delegates to computeConfidence and computeFreshness.
 * There is no alternative scoring implementation.
 */

import {
  computeConfidence,
  computeFreshness,
} from '@system2-viewer/viewer-core';

import type { RescoreInput, RescoreResult } from './types.js';

/**
 * Rescores a claim from its evidence set and prior state.
 * Delegates entirely to viewer-core scoring functions.
 */
export function rescoreFromEvidence(input: RescoreInput): RescoreResult {
  const confidence = computeConfidence(
    input.evidence,
    input.contradictions,
    input.priorState,
  );

  let freshness = input.priorState.freshness;

  if (input.scopedChange && input.lastEvidenceRevision !== undefined) {
    freshness = computeFreshness(input.scopedChange, input.lastEvidenceRevision);
  }

  return { confidence, freshness };
}
