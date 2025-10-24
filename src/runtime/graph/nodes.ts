import { WorkflowDefinition, NodeDefinition, ExecNode, TaskNode, MapNode, ReduceNode } from '../../schema/types';
import { RunState, NodeOutput } from './state';
import { runExec } from '../steps/exec';
import { runTask } from '../steps/task';
import { runMap } from '../steps/map';
import { runReduce } from '../steps/reduce';
import { AgentRegistry } from '../agents/registry';
import { CacheStore } from '../store/cache-store';
import { RunStore } from '../store/run-store';
import { createTemplateEngine } from '../../templating/engine';

/**
 * Context passed to all node handlers
 */
export interface NodeContext {
  agentRegistry: AgentRegistry;
  cacheStore: CacheStore;
  runStore: RunStore;
  verbose?: boolean;
}

/**
 * Create a node handler function for a specific workflow node.
 * This returns a function that can be added to the LangGraph StateGraph.
 */
export function createNodeHandler(
  node: NodeDefinition,
  ctx: NodeContext
): (state: RunState) => Promise<Partial<RunState>> {
  return async (state: RunState): Promise<Partial<RunState>> => {
    const nodeId = node.id;
    
    // Log function for this node
    const log = (msg: string) => {
      if (ctx.verbose) {
        console.log(`[${nodeId}] ${msg}`);
      }
    };

    try {
      // Update status to RUNNING
      await ctx.runStore.setNodeStatus(nodeId, 'RUNNING');
      log(`Starting node ${node.name || nodeId}`);

      let output: NodeOutput;

      // Handle different node types
      if (node.kind === 'map') {
        // Map nodes handle their own templating
        const mapNode = node as MapNode;
        output = await runMap(mapNode, {
          cacheGet: (key) => ctx.cacheStore.get(key),
          cachePut: (key, val) => ctx.cacheStore.put(key, val),
          writeArtifact: (rel, data) => ctx.runStore.writeArtifact(rel, data),
          log,
          getAgent: (name) => ctx.agentRegistry.get(name),
          vars: state.vars,
          outputs: state.outputs,
        });
      } else if (node.kind === 'reduce') {
        // Reduce nodes handle their own templating
        const reduceNode = node as ReduceNode;
        output = await runReduce(reduceNode, {
          cacheGet: (key) => ctx.cacheStore.get(key),
          cachePut: (key, val) => ctx.cacheStore.put(key, val),
          writeArtifact: (rel, data) => ctx.runStore.writeArtifact(rel, data),
          log,
          getAgent: (name) => ctx.agentRegistry.get(name),
          vars: state.vars,
          outputs: state.outputs,
        });
      } else {
        // For exec and task nodes, resolve templates first
        const templateEngine = createTemplateEngine({
          vars: state.vars,
          outputs: state.outputs,
        });

        const resolvedNode = templateEngine.renderObject(node);

        if (resolvedNode.kind === 'exec') {
          output = await runExec(resolvedNode as ExecNode, {
            cacheGet: (key) => ctx.cacheStore.get(key),
            cachePut: (key, val) => ctx.cacheStore.put(key, val),
            log,
          });
        } else if (resolvedNode.kind === 'task') {
          const taskNode = resolvedNode as TaskNode;
          const agent = ctx.agentRegistry.get(taskNode.agent);
          if (!agent) {
            throw new Error(`Agent ${taskNode.agent} not found`);
          }
          output = await runTask(agent, taskNode, {
            cacheGet: (key) => ctx.cacheStore.get(key),
            cachePut: (key, val) => ctx.cacheStore.put(key, val),
            writeArtifact: (rel, data) => ctx.runStore.writeArtifact(rel, data),
            log,
          });
        } else {
          throw new Error(`Unsupported node kind: ${(resolvedNode as any).kind}`);
        }
      }

      // Determine final status
      const status = output.cached ? 'CACHED' : 'SUCCESS';
      
      // Save output and status
      await ctx.runStore.setNodeOutput(nodeId, output);
      await ctx.runStore.setNodeStatus(nodeId, status);

      log(`Completed successfully`);

      // Return state updates
      return {
        outputs: { [nodeId]: output },
        statuses: { [nodeId]: status },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`Failed: ${errorMsg}`);
      
      // Save error information
      await ctx.runStore.setNodeError(nodeId, errorMsg);
      await ctx.runStore.setNodeStatus(nodeId, 'FAILED');

      // Return state updates with failure
      return {
        statuses: { [nodeId]: 'FAILED' as const },
        failed: { nodeId, error: errorMsg },
      };
    }
  };
}



