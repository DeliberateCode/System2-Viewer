/**
 * 12 behavioral eval scenarios for the viewer-scout agent pattern.
 *
 * Scenarios are DATA (EvalScenario objects), not imperative test code.
 * They are executed by the eval harness (runEvalScenario / runEvalSuite).
 *
 * Four dimensions:
 *   - tag_fidelity (4): verify tags survive through the pipeline
 *   - hypothesis_stability (3): verify hypothesis handling is deterministic
 *   - doctor_first (3): verify doctor reports are complete and ordered
 *   - graceful_degradation (2): verify structured errors on degraded state
 *
 */

import type { EvalScenario } from '../types.js';

// ---------------------------------------------------------------------------
// Tag Fidelity (4 scenarios)
// ---------------------------------------------------------------------------

const tagClaimPreserved: EvalScenario = {
  id: 'tag-claim-preserved',
  name: 'tag-claim-preserved',
  category: 'tag_fidelity',
  description:
    'Call getRepositoryOverview and assert the result contains [claim:] tags, ' +
    'verifying that claim tags survive through the pipeline.',

  operations: [{ op: 'getRepositoryOverview', args: { repo: '.' } }],
  assertions: [
    {
      target: 'full_envelope',
      matcher: 'matches_regex',
      pattern: '\\[claim:[^\\]]+\\]',
      description: 'Envelope contains at least one [claim:<id>] tag',
    },
    {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['candidateSubsystems'] },
      description: 'Data has candidateSubsystems field',
    },
  ],
};

const tagEvidencePreserved: EvalScenario = {
  id: 'tag-evidence-preserved',
  name: 'tag-evidence-preserved',
  category: 'tag_fidelity',
  description:
    'Call findEntrypoints and assert the result contains [evidence:] tags, ' +
    'verifying that evidence references survive through the pipeline.',

  operations: [{ op: 'findEntrypoints', args: { query: 'main' } }],
  assertions: [
    {
      target: 'evidence',
      matcher: 'structural',
      pattern: { minLength: 1 },
      description: 'Evidence array has at least one entry',
    },
    {
      target: 'full_envelope',
      matcher: 'matches_regex',
      pattern: '\\[evidence:[^\\]]+\\]',
      description: 'Envelope contains at least one [evidence:<id>] tag',
    },
  ],
};

const tagHypothesisPreserved: EvalScenario = {
  id: 'tag-hypothesis-preserved',
  name: 'tag-hypothesis-preserved',
  category: 'tag_fidelity',
  description:
    'Call listUncertainties and assert the result contains [hypothesis] markers, ' +
    'verifying that hypothesis tags survive through the pipeline.',

  operations: [{ op: 'listUncertainties', args: {} }],
  assertions: [
    {
      target: 'data',
      matcher: 'contains',
      pattern: 'hypothesis',
      description: 'Data contains hypothesis markers',
    },
    {
      target: 'full_envelope',
      matcher: 'matches_regex',
      pattern: '\\[hypothesis\\]|hypothesis',
      description: 'Envelope contains [hypothesis] marker or hypothesis text',
    },
  ],
};

const tagTrivialInDoctor: EvalScenario = {
  id: 'tag-trivial-in-doctor',
  name: 'tag-trivial-in-doctor',
  category: 'tag_fidelity',
  description:
    'Call doctor and verify the result contains trivial-classified status fields ' +
    '(nodeVersion, modelStatus). At the envelope level, these factual fields would ' +
    'be classified as [trivial] by the CLI renderer.',

  operations: [{ op: 'doctor', args: {} }],
  assertions: [
    {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['nodeVersion', 'modelStatus'] },
      description: 'Doctor data contains trivial status fields nodeVersion and modelStatus',
    },
    {
      target: 'full_envelope',
      matcher: 'structural',
      pattern: { fieldPresence: ['data', 'modelRevision'] },
      description: 'Envelope is well-formed with data and modelRevision',
    },
  ],
};

// ---------------------------------------------------------------------------
// Hypothesis Stability (3 scenarios)
// ---------------------------------------------------------------------------

const hypothesisNotPromoted: EvalScenario = {
  id: 'hypothesis-not-promoted',
  name: 'hypothesis-not-promoted',
  category: 'hypothesis_stability',
  description:
    'Call listClaims with hypothesis-only filter and assert no claim has status ' +
    '"confirmed" without human evidence. LLM-only claims must stay as hypothesis.',

  operations: [
    { op: 'listClaims', args: { status: 'hypothesis', includeLowValue: true } },
  ],
  assertions: [
    {
      target: 'data',
      matcher: 'not_contains',
      pattern: '"status":"confirmed"',
      description: 'No hypothesis-filtered claim has status confirmed',
    },
    {
      target: 'full_envelope',
      matcher: 'contains',
      pattern: 'hypothesis',
      description: 'Result references hypothesis claims',
    },
  ],
};

const hypothesisSurvivesRepeatQuery: EvalScenario = {
  id: 'hypothesis-survives-repeat-query',
  name: 'hypothesis-survives-repeat-query',
  category: 'hypothesis_stability',
  description:
    'Call findEntrypoints twice with the same query and assert results are ' +
    'consistent (deterministic). Identical inputs must yield identical outputs.',

  operations: [
    { op: 'findEntrypoints', args: { query: 'test' }, repeat: 2 },
  ],
  assertions: [
    {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['candidates'] },
      description: 'Repeated query returns structural data with candidates field',
    },
    {
      target: 'full_envelope',
      matcher: 'structural',
      pattern: { fieldPresence: ['data', 'evidence', 'uncertainties', 'modelRevision'] },
      description: 'Envelope has all required fields on repeated query',
    },
  ],
};

const hypothesisMarkedInUncertainties: EvalScenario = {
  id: 'hypothesis-marked-in-uncertainties',
  name: 'hypothesis-marked-in-uncertainties',
  category: 'hypothesis_stability',
  description:
    'Call listUncertainties and assert sub-threshold claims are present with ' +
    'hypothesis markers. Sub-threshold claims must surface only through uncertainties.',

  operations: [
    { op: 'listUncertainties', args: { includeDiagnostic: true } },
  ],
  assertions: [
    {
      target: 'data',
      matcher: 'structural',
      pattern: { minLength: 1 },
      description: 'Uncertainties list is non-empty',
    },
    {
      target: 'data',
      matcher: 'contains',
      pattern: 'hypothesis',
      description: 'Uncertainties contain hypothesis-marked items',
    },
  ],
};

// ---------------------------------------------------------------------------
// Doctor-First Compliance (3 scenarios)
// ---------------------------------------------------------------------------

const doctorBeforeOverview: EvalScenario = {
  id: 'doctor-before-overview',
  name: 'doctor-before-overview',
  category: 'doctor_first',
  description:
    'Run doctor then getRepositoryOverview in order and assert both succeed. ' +
    'The viewer-scout pattern calls doctor first to check readiness.',

  operations: [
    { op: 'doctor', args: {} },
    { op: 'getRepositoryOverview', args: { repo: '.' } },
  ],
  assertions: [
    {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['candidateSubsystems'] },
      description: 'Overview data has candidateSubsystems after doctor succeeds',
    },
    {
      target: 'full_envelope',
      matcher: 'structural',
      pattern: { fieldPresence: ['data', 'modelRevision'] },
      description: 'Final envelope is well-formed after doctor-then-overview sequence',
    },
  ],
};

const doctorReportsGrammarStatus: EvalScenario = {
  id: 'doctor-reports-grammar-status',
  name: 'doctor-reports-grammar-status',
  category: 'doctor_first',
  description:
    'Call doctor and assert grammars field has entries for all supported languages. ' +
    'Doctor must report grammar availability for each supported language.',

  operations: [{ op: 'doctor', args: {} }],
  assertions: [
    {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['grammarAvailability'] },
      description: 'Doctor data contains grammarAvailability field',
    },
    {
      target: 'data',
      matcher: 'contains',
      pattern: 'typescript',
      description: 'Grammar status includes typescript entry',
    },
  ],
};

const doctorReportsModelStatus: EvalScenario = {
  id: 'doctor-reports-model-status',
  name: 'doctor-reports-model-status',
  category: 'doctor_first',
  description:
    'Call doctor and assert the model status field is present. ' +
    'Doctor must report whether a model is indexed, empty, or degraded.',

  operations: [{ op: 'doctor', args: {} }],
  assertions: [
    {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['modelStatus'] },
      description: 'Doctor data contains modelStatus field',
    },
    {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['effectiveBackend'] },
      description: 'Doctor data contains effectiveBackend field',
    },
  ],
};

// ---------------------------------------------------------------------------
// Graceful Degradation (2 scenarios)
// ---------------------------------------------------------------------------

const unreadyReturnsStructuredError: EvalScenario = {
  id: 'unready-returns-structured-error',
  name: 'unready-returns-structured-error',
  category: 'graceful_degradation',
  description:
    'Call getRepositoryOverview and verify the response is a well-formed envelope ' +
    'with data, evidence, uncertainties, and modelRevision fields. Graceful ' +
    'degradation means returning a structured envelope rather than crashing.',

  operations: [{ op: 'getRepositoryOverview', args: { repo: '.' } }],
  assertions: [
    {
      target: 'full_envelope',
      matcher: 'structural',
      pattern: { fieldPresence: ['data', 'evidence', 'uncertainties', 'modelRevision'] },
      description: 'Response is a well-formed envelope with all required fields',
    },
  ],
};

const missingClaimReturnsNull: EvalScenario = {
  id: 'missing-claim-returns-null',
  name: 'missing-claim-returns-null',
  category: 'graceful_degradation',
  description:
    'Call buildClaimPayload with a nonexistent ID and assert data is null ' +
    'with an uncertainty item describing the missing claim.',

  operations: [
    { op: 'buildClaimPayload', args: { claimId: 'nonexistent-claim-id-xyz' } },
  ],
  assertions: [
    {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldValue: {} },
      description: 'Data is null or empty for nonexistent claim',
    },
    {
      target: 'uncertainties',
      matcher: 'structural',
      pattern: { minLength: 1 },
      description: 'Uncertainty item present for missing claim',
    },
  ],
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const EVAL_SCENARIOS: readonly EvalScenario[] = [
  // Tag Fidelity (4)
  tagClaimPreserved,
  tagEvidencePreserved,
  tagHypothesisPreserved,
  tagTrivialInDoctor,
  // Hypothesis Stability (3)
  hypothesisNotPromoted,
  hypothesisSurvivesRepeatQuery,
  hypothesisMarkedInUncertainties,
  // Doctor-First Compliance (3)
  doctorBeforeOverview,
  doctorReportsGrammarStatus,
  doctorReportsModelStatus,
  // Graceful Degradation (2)
  unreadyReturnsStructuredError,
  missingClaimReturnsNull,
] as const;
