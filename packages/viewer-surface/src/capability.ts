/**
 * Capability classes, tool descriptors, and related helpers.
 *
 * CapabilityClass has exactly 4 members: read, feedback, verify, index.
 * source-write is structurally unrepresentable (compile-time proof
 * lives in viewer-core; re-exported from this package's barrel).
 */

import type { CapabilityClass, ToolDescriptor } from './types.js';
import { TOOL_TABLE } from './tool-table.js';

/** The complete set of capability classes -- exactly 4 members. */
export const CAPABILITY_CLASSES: readonly CapabilityClass[] = [
  'read',
  'feedback',
  'verify',
  'index',
] as const;

/**
 * Returns the capability class for a given tool name.
 * Throws if the tool name is not recognized.
 */
export function capabilityClassOf(toolName: string): CapabilityClass {
  const entry = TOOL_TABLE.find(t => t.name === toolName);
  if (!entry) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return entry.capabilityClass;
}

/**
 * Returns a ToolDescriptor for a single tool by name.
 * Throws if the tool name is not recognized.
 */
export function describeTool(name: string): ToolDescriptor {
  const entry = TOOL_TABLE.find(t => t.name === name);
  if (!entry) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return {
    name: entry.name,
    capability: entry.capabilityClass,
    mutatesModel: entry.capabilityClass !== 'read',
  };
}

/**
 * Returns descriptors for all 21 tools.
 */
export function allToolDescriptors(): ToolDescriptor[] {
  return TOOL_TABLE.map(entry => ({
    name: entry.name,
    capability: entry.capabilityClass,
    mutatesModel: entry.capabilityClass !== 'read',
  }));
}
