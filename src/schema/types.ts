export interface WorkflowDefinition {
  version: number;
  name: string;
  concurrency?: number;
  vars?: Record<string, unknown>;
  nodes: NodeDefinition[];
}

export type NodeDefinition = ExecNode | TaskNode | MapNode | ReduceNode;

export interface BaseNode {
  id: string;
  name?: string;
  deps?: string[];
  deterministic?: boolean;
  timeout?: number;
  retries?: number;
}

export interface ExecNode extends BaseNode {
  kind: 'exec';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  produces?: {
    files?: string[];
    json?: {
      resultFromFile?: string;
    };
  };
}

export interface TaskNode extends BaseNode {
  kind: 'task';
  agent: string;
  prompt: string;
  inputs?: Record<string, unknown>;
  artifacts?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface MapNode extends BaseNode {
  kind: 'map';
  over: unknown;
  map: TaskNode | ExecNode;
}

export interface ReduceNode extends BaseNode {
  kind: 'reduce';
  reduce: TaskNode | ExecNode;
}
