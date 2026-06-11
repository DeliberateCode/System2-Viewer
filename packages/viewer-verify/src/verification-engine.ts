/**
 * Verification engine.
 *
 * Loads claims, runs verification recipes, rescores via viewer-core,
 * derives new status via nextClaimStatus, and returns VerificationResult.
 */

// IDs use randomUUID() intentionally rather than content-hashing.
// Content-hashing would create unstable IDs when the same verification
// runs at different times, breaking successor chain references.
import { randomUUID } from 'node:crypto';
import { nextClaimStatus } from '@system2-viewer/viewer-core';
import type {
  EvidenceRef as CoreEvidenceRef,
  Claim,
  ConfidenceBand,
  FreshnessBand,
  ClaimStatus,
} from '@system2-viewer/viewer-core';

import { runRecipe, isMvpRecipe } from './recipes.js';
import { rescoreFromEvidence } from './rescore.js';
import type {
  VerificationResult,
  VerificationRecipe,
  VerificationModelHandle,
  VerificationWriteTxn,
  RecipeOutcome,
} from './types.js';

/**
 * Verification engine that verifies claims by running recipes,
 * rescoring, and creating non-destructive successors.
 */
export class VerificationEngine {
  /**
   * Verifies a single claim.
   *
   * 1. Load the claim and its recipes
   * 2. Run recipes (all or cheapest-first per strategy)
   * 3. Rescore via computeConfidence/computeFreshness
   * 4. Derive new status via nextClaimStatus
   * 5. Append verification_history row
   * 6. Create non-destructive claim successor
   */
  verifyClaim(
    claimId: string,
    modelHandle: VerificationModelHandle,
    writeTxn: VerificationWriteTxn,
    options?: { strategy?: 'all' | 'cheapest'; revision?: string },
  ): VerificationResult {
    const strategy = options?.strategy ?? 'all';
    const revision = options?.revision ?? 'unknown';

    // Load the claim
    const claimRow = modelHandle.getClaim(claimId);
    if (!claimRow) {
      return {
        claimId,
        priorStatus: 'hypothesis',
        newStatus: 'hypothesis',
        priorConfidence: 'none',
        newConfidence: 'none',
        priorFreshness: 'fresh',
        newFreshness: 'fresh',
        recipeOutcomes: [],
        unresolvedReason: `Claim not found: ${claimId}`,
      };
    }

    const priorStatus = claimRow.status as ClaimStatus;
    const priorConfidence = claimRow.confidenceBand as ConfidenceBand;
    const priorFreshness = claimRow.freshnessBand as FreshnessBand;

    // Parse recipes from the claim
    let recipes: VerificationRecipe[] = [];
    try {
      const recipesStr = claimRow.verificationRecipesJson ?? '[]';
      const parsed: unknown = JSON.parse(recipesStr);
      if (Array.isArray(parsed)) {
        recipes = parsed as VerificationRecipe[];
      }
    } catch {
      // No recipes available
    }

    // Filter to MVP recipes if cheapest strategy
    let recipesToRun = recipes;
    if (strategy === 'cheapest') {
      const mvpRecipes = recipes.filter(isMvpRecipe);
      recipesToRun = mvpRecipes.length > 0 ? mvpRecipes : recipes;
    }

    // Run recipes, collecting outcomes
    const recipeOutcomes: RecipeOutcome[] = [];
    const newEvidence: CoreEvidenceRef[] = [];
    const now = new Date().toISOString();

    for (const recipe of recipesToRun) {
      const outcome = runRecipe(recipe, modelHandle);
      recipeOutcomes.push(outcome);

      // Convert recipe evidence to core evidence refs for scoring
      // and persist them so downstream lookups can find them
      for (const ev of outcome.evidence) {
        const evidenceId = `verify-${claimId}-${ev.kind}-${randomUUID()}`;
        newEvidence.push({
          evidenceId,
          kind: ev.kind,
        });

        writeTxn.appendEvidence({
          id: evidenceId,
          kind: ev.kind,
          epistemic: 'static',
          repositoryId: claimRow.repositoryId ?? '',
          revision,
          path: ev.path ?? null,
          startLine: ev.startLine ?? null,
          endLine: ev.endLine ?? null,
          contentHash: ev.contentHash ?? null,
          extractor: 'verification-engine',
          derivationLocality: 'local',
          actor: null,
          metadataJson: JSON.stringify({ description: ev.description }),
          createdAt: now,
        });
      }

      // In cheapest mode, stop early if decisive
      if (strategy === 'cheapest' && !outcome.passed) {
        break;
      }
    }

    // Build full evidence set for rescoring
    const existingEvidence: CoreEvidenceRef[] = (
      claimRow.supportingEvidenceIds ?? []
    ).map((id: string) => ({
      evidenceId: id,
      kind: 'static_analysis_result' as const,
    }));

    const allEvidence = [...existingEvidence, ...newEvidence];

    // Determine contradictions from failed recipes and persist evidence rows
    const contradictions: CoreEvidenceRef[] = [];
    for (const o of recipeOutcomes) {
      if (o.passed) continue;
      for (const ev of o.evidence) {
        const evidenceId = `contradict-${claimId}-${ev.kind}-${randomUUID()}`;
        contradictions.push({ evidenceId, kind: ev.kind });

        writeTxn.appendEvidence({
          id: evidenceId,
          kind: ev.kind,
          epistemic: 'static',
          repositoryId: claimRow.repositoryId ?? '',
          revision,
          path: ev.path ?? null,
          startLine: ev.startLine ?? null,
          endLine: ev.endLine ?? null,
          contentHash: ev.contentHash ?? null,
          extractor: 'verification-engine',
          derivationLocality: 'local',
          actor: null,
          metadataJson: JSON.stringify({ description: ev.description }),
          createdAt: now,
        });
      }
    }

    // Rescore
    const rescored = rescoreFromEvidence({
      evidence: allEvidence,
      contradictions,
      priorState: {
        confidence: priorConfidence,
        freshness: priorFreshness,
      },
    });

    // Build claim projection for state machine
    const claimProjection: Claim = {
      id: claimId,
      status: priorStatus,
      confidence: rescored.confidence,
      supportingEvidence: allEvidence,
      contradictingEvidence: contradictions,
      verificationRecipeCount: recipes.length,
    };

    // Derive new status
    const newStatus = nextClaimStatus(claimProjection, allEvidence, contradictions);

    const historyId = `vh-${claimId}-${randomUUID()}`;

    // Append verification history (audit trail)
    try {
      writeTxn.appendVerificationHistory({
        id: historyId,
        claimId,
        recipesJson: JSON.stringify(recipeOutcomes),
        priorConfidence,
        newConfidence: rescored.confidence,
        priorFreshness,
        newFreshness: rescored.freshness,
        priorStatus,
        newStatus,
        unresolvedReason: null,
        ranAt: now,
      });

      // Close interval on prior claim and create successor
      const successorId = `${claimId}-v-${randomUUID()}`;
      writeTxn.closeInterval(claimId, revision);
      writeTxn.versionClaim({
        id: successorId,
        claimType: claimRow.claimType,
        statement: claimRow.statement,
        status: newStatus,
        repositoryId: claimRow.repositoryId ?? '',
        scopeJson: claimRow.scopeJson,
        confidenceBand: rescored.confidence,
        freshnessBand: rescored.freshness,
        supportingEvidenceIdsJson: JSON.stringify(allEvidence.map((e) => e.evidenceId)),
        contradictingEvidenceIdsJson:
          contradictions.length > 0
            ? JSON.stringify(contradictions.map((e) => e.evidenceId))
            : null,
        verificationRecipesJson: claimRow.verificationRecipesJson ?? '[]',
        derivationMethod: 'verification',
        generationId: `gen-verify-${randomUUID()}`,
        surfaced: claimRow.surfaced ?? 0,
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      writeTxn.abort();
      return {
        claimId,
        priorStatus,
        newStatus: priorStatus,
        priorConfidence,
        newConfidence: priorConfidence,
        priorFreshness,
        newFreshness: priorFreshness,
        recipeOutcomes,
        unresolvedReason: 'Write transaction failed',
      };
    }

    return {
      claimId,
      priorStatus,
      newStatus,
      priorConfidence,
      newConfidence: rescored.confidence,
      priorFreshness,
      newFreshness: rescored.freshness,
      recipeOutcomes,
    };
  }
}
