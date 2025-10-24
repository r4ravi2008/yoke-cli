import { Annotation } from '@langchain/langgraph';

export type NodeStatus = 'PENDING' | 'RUNNING' | 'CACHED' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface NodeOutput {
  result: unknown;
  artifacts: string[];
  logs?: string[];
  hash?: string;
  cached?: boolean;
}

/**
 * State annotation for the workflow graph using LangGraph's Annotation pattern.
 * This defines the structure of state that flows through the graph.
 */
export const RunStateAnnotation = Annotation.Root({
  // Workflow variables (from YAML vars section)
  vars: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  // Node outputs indexed by node ID
  outputs: Annotation<Record<string, NodeOutput>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  // Node statuses indexed by node ID
  statuses: Annotation<Record<string, NodeStatus>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  // List of node IDs that are ready to execute
  next: Annotation<string[]>({
    reducer: (left, right) => right, // Replace with new value
    default: () => [],
  }),

  // Error information if a node failed
  failed: Annotation<{ nodeId: string; error: string } | null>({
    reducer: (left, right) => right, // Replace with new value
    default: () => null,
  }),
});

// Type alias for the state
export type RunState = typeof RunStateAnnotation.State;

/**
 * Create initial state for a workflow run
 */
export function createInitialState(vars: Record<string, unknown> = {}): RunState {
  return {
    vars: { ...vars }, // Clone to avoid mutation
    outputs: {},
    statuses: {},
    next: [],
    failed: null,
  };
}
