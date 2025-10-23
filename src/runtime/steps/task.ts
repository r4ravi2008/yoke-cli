import { Agent } from '../agents/types';
import { hashInputs } from '../util/hash';
import { NodeOutput } from '../graph/state';
import { TaskNode } from '../../schema/types';

export interface TaskContext {
  cacheGet: (key: string) => Promise<NodeOutput | null>;
  cachePut: (key: string, val: NodeOutput) => Promise<void>;
  writeArtifact: (rel: string, data: Buffer | string) => Promise<string>;
  log: (msg: string) => void;
}

export async function runTask(
  agent: Agent,
  spec: TaskNode,
  ctx: TaskContext
): Promise<NodeOutput> {
  const cacheKey = hashInputs({
    kind: 'task',
    agent: agent.name,
    prompt: spec.prompt,
    inputs: spec.inputs || {},
    env: spec.env || {},
  });

  if (spec.deterministic) {
    const hit = await ctx.cacheGet(cacheKey);
    if (hit) {
      ctx.log(`[Task] Cache hit for agent ${agent.name}`);
      return { ...hit, hash: cacheKey, cached: true };
    }
  }

  ctx.log(`[Task] Running agent: ${agent.name}`);

  const res = await agent.run({
    prompt: spec.prompt,
    inputs: spec.inputs || {},
    env: spec.env || {},
    cwd: spec.cwd || process.cwd(),
    timeoutMs: spec.timeout || 300000,
    writeArtifact: ctx.writeArtifact,
    log: ctx.log,
  });

  const output: NodeOutput = {
    result: res.result,
    artifacts: res.createdArtifacts || [],
    logs: res.logs,
    hash: cacheKey,
    cached: false,
  };

  if (spec.deterministic) {
    await ctx.cachePut(cacheKey, output);
  }

  return output;
}
