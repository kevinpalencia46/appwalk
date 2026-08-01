// src/ai/explain.js
// Thin re-export wrapper: the explain implementation lives in index.js (loadEnv/pickLite/
// providerAvailable/costFor live alongside it). This module exists so callers can import
// the explain entry point directly without reaching into the index.
export { explain } from './index.js';
