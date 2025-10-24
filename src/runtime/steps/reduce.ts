import { Agent } from '../agents/types';
import { hashInputs } from '../util/hash';
import { NodeOutput } from '../graph/state';
import { ReduceNode, ExecNode, TaskNode } from '../../schema/types';
import { runExec } from './exec';
import { runTask } from './task';
import { createTemplateEngine } from '../../templating/engine';

export interface ReduceContext {
  cacheGet: (key: string) => Promise<NodeOutput | null>;
  cachePut: (key: string, val: NodeOutput) => Promise<void>;
  writeArtifact: (rel: string, data: Buffer | string) => Promise<string>;
  log: (msg: string) => void;
  getAgent: (name: string) => Agent | undefined;
  vars: Record<string, unknown>;
  outputs: Record<string, NodeOutput>;
}

export async function runReduce(
  spec: ReduceNode,
  ctx: ReduceContext
): Promise<NodeOutput> {
  ctx.log(`[Reduce] Starting reduce operation`);

  // Create template engine with current context
  const templateEngine = createTemplateEngine({
    vars: ctx.vars,
    outputs: ctx.outputs,
  });

  // Resolve the reduce body with the current context
  // The reduce body can access outputs from previous nodes (especially map nodes)
  const resolvedBody = templateEngine.renderObject(spec.reduce);

  let output: NodeOutput;

  if (resolvedBody.kind === 'exec') {
    const execBody = resolvedBody as ExecNode;
    output = await runExec(execBody, {
      cacheGet: ctx.cacheGet,
      cachePut: ctx.cachePut,
      log: (msg) => ctx.log(`[Reduce] ${msg}`),
    });
  } else if (resolvedBody.kind === 'task') {
    const taskBody = resolvedBody as TaskNode;
    const agent = ctx.getAgent(taskBody.agent);
    if (!agent) {
      throw new Error(`Agent ${taskBody.agent} not found`);
    }
    output = await runTask(agent, taskBody, {
      cacheGet: ctx.cacheGet,
      cachePut: ctx.cachePut,
      writeArtifact: ctx.writeArtifact,
      log: (msg) => ctx.log(`[Reduce] ${msg}`),
    });
  } else {
    throw new Error(`Unsupported reduce body kind: ${(resolvedBody as any).kind}`);
  }

  ctx.log(`[Reduce] Reduce operation completed`);

  return output;
}

