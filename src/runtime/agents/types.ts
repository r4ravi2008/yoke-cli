export interface AgentContext {
  prompt: string;
  inputs: Record<string, unknown>;
  env: Record<string, string>;
  cwd: string;
  writeArtifact: (relPath: string, data: Buffer | string) => Promise<string>;
  timeoutMs: number;
  log: (msg: string) => void;
}

export interface AgentResult {
  result: unknown;
  logs?: string[];
  createdArtifacts?: string[];
}

export interface Agent {
  name: string;
  run(ctx: AgentContext): Promise<AgentResult>;
}
