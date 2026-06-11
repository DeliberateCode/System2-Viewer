/** Capability class for tool partitioning. 'source-write' is structurally unrepresentable. */
export type CapabilityClass = 'read' | 'feedback' | 'verify' | 'index';

/**
 * Compile-time proof that 'source-write' is not a member of CapabilityClass.
 * If someone adds 'source-write' to CapabilityClass, this line will fail to compile.
 */
export const SOURCE_WRITE_IS_UNREPRESENTABLE: 'source-write' extends CapabilityClass
  ? false
  : true = true;
