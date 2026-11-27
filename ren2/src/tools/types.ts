import type { Core } from '../core.js';
import type { GateKind } from '../gate/gate.js';
import type { TaskRow } from '../tasks/store.js';
import type { AgentDef } from '../agents/agents.js';

export type ToolState = 'ok' | 'needs_config' | 'needs_credentials' | 'unavailable';

export interface ToolCtx {
  core: Core;
  task: TaskRow;
  stepIdx: number;
  agent: AgentDef | null;
  signal: AbortSignal;
  /** Ask the gate. Returns when allowed; throws NeedsDecision/Rejected otherwise. */
  gate(g: { gate: GateKind; actionType: string; summary: string; preview?: string }): 'auto' | 'approved';
  /** Idempotency key for this step (pass to adapters/actions that must not repeat). */
  key: string;
}

export interface ToolResult {
  output: string;
  data?: unknown;
}

export interface Tool {
  name: string;
  description: string; // shown to the planner
  heavy?: boolean;
  status(core: Core): Promise<{ status: ToolState; detail?: string }>;
  run(args: Record<string, any>, ctx: ToolCtx): Promise<ToolResult>;
}

export class ToolError extends Error {}
