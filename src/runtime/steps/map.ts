import pLimit from 'p-limit';
import { Agent } from '../agents/types';
import { hashInputs } from '../util/hash';
import { NodeOutput } from '../graph/state';
import { MapNode, ExecNode, TaskNode } from '../../schema/types';
import { runExec } from './exec';
import { runTask } from './task';
import { createTemplateEngine } from '../../templating/engine';

export interface MapContext {
  cacheGet: (key: string) => Promise<NodeOutput | null>;
  cachePut: (key: string, val: NodeOutput) => Promise<void>;
  writeArtifact: (rel: string, data: Buffer | string) => Promise<string>;
  log: (msg: string) => void;
  getAgent: (name: string) => Agent | undefined;
  vars: Record<string, unknown>;
  outputs: Record<string, NodeOutput>;
}

export async function runMap(
  spec: MapNode,
  ctx: MapContext
): Promise<NodeOutput> {
  ctx.log(`[Map] Starting map operation over array`);

  // Resolve the 'over' expression to get the array
  const templateEngine = createTemplateEngine({
    vars: ctx.vars,
    outputs: ctx.outputs,
  });

  let items: unknown[];
  
  // Handle 'over' which can be a template string or direct value
  if (typeof spec.over === 'string') {
    const resolved = templateEngine.render(spec.over);
    try {
      // Try to parse as JSON if it's a string
      items = JSON.parse(resolved);
    } catch {
      // If not JSON, treat as the resolved value itself
      const renderedObj = templateEngine.renderObject(spec.over);
      items = Array.isArray(renderedObj) ? renderedObj : [renderedObj];
    }
  } else {
    const renderedObj = templateEngine.renderObject(spec.over);
    items = Array.isArray(renderedObj) ? renderedObj : [renderedObj];
  }

  if (!Array.isArray(items)) {
    throw new Error(`Map 'over' expression did not resolve to an array: ${typeof items}`);
  }

  ctx.log(`[Map] Processing ${items.length} items`);

  // Create a concurrency limiter (default to 5 concurrent items)
  const limit = pLimit(5);

  // Process each item in parallel with concurrency control
  const results = await Promise.all(
    items.map((item, index) =>
      limit(async () => {
        ctx.log(`[Map] Processing item ${index + 1}/${items.length}`);

        // Create a new template engine with 'item' in context
        const itemTemplateEngine = createTemplateEngine({
          vars: ctx.vars,
          outputs: ctx.outputs,
          item, // Add the current item to the context
        });

        // Resolve the map body with the item context
        const resolvedBody = itemTemplateEngine.renderObject(spec.map);

        let itemOutput: NodeOutput;

        if (resolvedBody.kind === 'exec') {
          const execBody = resolvedBody as ExecNode;
          itemOutput = await runExec(execBody, {
            cacheGet: ctx.cacheGet,
            cachePut: ctx.cachePut,
            log: (msg) => ctx.log(`[Map Item ${index}] ${msg}`),
          });
        } else if (resolvedBody.kind === 'task') {
          const taskBody = resolvedBody as TaskNode;
          const agent = ctx.getAgent(taskBody.agent);
          if (!agent) {
            throw new Error(`Agent ${taskBody.agent} not found`);
          }
          itemOutput = await runTask(agent, taskBody, {
            cacheGet: ctx.cacheGet,
            cachePut: ctx.cachePut,
            writeArtifact: ctx.writeArtifact,
            log: (msg) => ctx.log(`[Map Item ${index}] ${msg}`),
          });
        } else {
          throw new Error(`Unsupported map body kind: ${(resolvedBody as any).kind}`);
        }

        ctx.log(`[Map] Item ${index + 1}/${items.length} completed`);
        return itemOutput.result;
      })
    )
  );

  // Collect all artifacts from all items
  const allArtifacts: string[] = [];
  
  ctx.log(`[Map] All ${items.length} items processed successfully`);

  // Return the array of results
  const output: NodeOutput = {
    result: results,
    artifacts: allArtifacts,
    logs: [`Processed ${items.length} items`],
    cached: false,
  };

  return output;
}

