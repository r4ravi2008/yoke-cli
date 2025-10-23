export type NodeStatus = 'PENDING' | 'RUNNING' | 'CACHED' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface NodeOutput {
  result: unknown;
  artifacts: string[];
  logs?: string[];
  hash?: string;
  cached?: boolean;
}

export interface RunState {
  vars: Record<string, unknown>;
  outputs: Record<string, NodeOutput>;
  statuses: Record<string, NodeStatus>;
  next: string[];
  failed?: { nodeId: string; error: string } | null;
}

export function createInitialState(vars: Record<string, unknown> = {}): RunState {
  return {
    vars,
    outputs: {},
    statuses: {},
    next: [],
    failed: null,
  };
}
