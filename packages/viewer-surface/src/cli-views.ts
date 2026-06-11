/**
 * CLI view rendering: converts ResultEnvelopes into tagged terminal output.
 *
 * Implementation split into views/ directory:
 *   views/op-map.ts       - viewKindForOp
 *   views/render-view.ts  - renderView
 *   views/format.ts       - formatView
 *   views/renderers.ts    - per-kind renderer functions
 *   views/line-builders.ts - line construction helpers
 */

export { viewKindForOp } from './views/op-map.js';
export { renderView } from './views/render-view.js';
export { formatView } from './views/format.js';
