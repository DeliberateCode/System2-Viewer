// Composition root
export { createViewerEngine } from './engine.js';

// CLI
export { runCli } from './cli.js';
export { formatView } from './cli-views.js';

// Feedback operations
export { createFeedbackOperations, noProseEditGuard } from './feedback.js';

// Errors
export { NoModelIndexedError } from './errors.js';

// Doctor, secret redaction
export {
  buildDoctorReport,
  looksLikeSecretValue,
  redactConfigValues,
  REDACTED,
} from './doctor.js';

// Doctor fix auto-remediation
export { runDoctorFix } from './doctor-fix.js';

// Init
export { runInit } from './init.js';

// MCP config generation
export { generateMcpConfig } from './mcp-config-gen.js';

// Reference resolver
export { ReferenceResolver } from './reference-resolver.js';

// Types -- public per interfaces.json
export type {
  ViewerEngine,
  ViewerOperations,
  FeedbackOperations,
  FeedbackReadHandle,
  FeedbackWriteTxn,
  FeedbackClaimRecord,
  CapabilityClass,
  ToolDescriptor,
  CliOps,
  IndexerLike,
  WorkspaceMode,
  InitResult,
  McpConfigResult,
  DoctorReport,
  DoctorSuggestion,
  DoctorFixResult,
  StatusReport,
  ResolveResult,
  ReferenceKind,
  CompareRevisionsResult,
  RenameCandidate,
  CreateCustomClaimInput,
  CreateCustomClaimResult,
  DerivedView,
  ViewLine,
} from './types.js';

// Re-export SOURCE_WRITE_IS_UNREPRESENTABLE from viewer-core
export { SOURCE_WRITE_IS_UNREPRESENTABLE } from '@system2-viewer/viewer-core';

// MCP server
export { McpToolServer } from './mcp-server.js';

// Input validation
export { validateUntrustedInput } from './validate-input.js';

// Capability classes and tool descriptors
export {
  CAPABILITY_CLASSES,
  capabilityClassOf,
  describeTool,
  allToolDescriptors,
} from './capability.js';

// Rule authoring
export {
  atomicConfigWrite,
  appendAuditEntry,
  addRule,
  removeRule,
  listRules,
  testRule,
  enableRule,
  disableRule,
  exportRules,
  importRules,
} from './rule-authoring.js';
export type {
  RuleAuthoringOps,
  RuleAddOpts,
  RuleRemoveOpts,
  RuleTestOpts,
  RuleToggleOpts,
  RuleImportOpts,
  RuleExportOpts,
  AuditEntry,
  RuleAuthoringResult,
  RuleListResult,
  RuleTestResult,
  RuleExportResult,
  RuleImportResult,
} from './rule-authoring.js';
