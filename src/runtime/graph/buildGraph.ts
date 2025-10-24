import { StateGraph, START, END, BaseCheckpointSaver } from '@langchain/langgraph';
import { WorkflowDefinition } from '../../schema/types';
import { RunStateAnnotation, RunState } from './state';
import { createNodeHandler, NodeContext } from './nodes';

/**
 * Build a LangGraph StateGraph from a workflow definition.
 *
 * This function converts a YAML workflow into a LangGraph state machine using
 * a sequential execution model with a router node that handles dependency resolution.
 *
 * The graph structure:
 * START -> router -> [execute nodes] -> router -> ... -> END
 *
 * The router node:
 * - Checks which nodes are ready to execute based on dependencies
 * - Marks nodes as SKIPPED if their dependencies failed
 * - Returns END when all nodes are processed
 *
 * @param workflow The workflow definition from YAML
 * @param ctx Context containing stores and registries
 * @param checkpointer Optional checkpointer for state persistence and resume
 * @returns A compiled LangGraph that can be invoked
 */
export function buildGraphFromWorkflow(
  workflow: WorkflowDefinition,
  ctx: NodeContext,
  checkpointer?: BaseCheckpointSaver
) {
  // Create the state graph
  const graph = new StateGraph(RunStateAnnotation);

  // Add all workflow nodes
  for (const node of workflow.nodes) {
    const handler = createNodeHandler(node, ctx);
    graph.addNode(node.id, handler);
  }

  // Add a router node that determines which nodes should execute next
  graph.addNode('router', async (state: RunState): Promise<Partial<RunState>> => {
    const ready: string[] = [];
    const completed = new Set<string>();
    const failed = new Set<string>();
    const skipped = new Set<string>();

    // Categorize nodes by status
    for (const [nodeId, status] of Object.entries(state.statuses)) {
      if (status === 'SUCCESS' || status === 'CACHED') {
        completed.add(nodeId);
      } else if (status === 'FAILED') {
        failed.add(nodeId);
      } else if (status === 'SKIPPED') {
        skipped.add(nodeId);
      }
    }

    // Find nodes that are ready to execute
    const statusUpdates: Record<string, 'SKIPPED'> = {};

    for (const node of workflow.nodes) {
      const nodeId = node.id;

      // Skip if already processed
      if (completed.has(nodeId) || failed.has(nodeId) || skipped.has(nodeId)) {
        continue;
      }

      // Skip if currently running
      if (state.statuses[nodeId] === 'RUNNING') {
        continue;
      }

      const deps = node.deps || [];
      const allDepsComplete = deps.every((dep) => completed.has(dep));
      const anyDepFailed = deps.some((dep) => failed.has(dep) || skipped.has(dep));

      if (anyDepFailed) {
        // Mark as skipped if any dependency failed
        statusUpdates[nodeId] = 'SKIPPED';
        await ctx.runStore.setNodeStatus(nodeId, 'SKIPPED');
      } else if (allDepsComplete) {
        // Ready to execute
        ready.push(nodeId);
      }
    }

    return {
      next: ready,
      statuses: statusUpdates,
    };
  });

  // Connect START to router
  graph.addEdge(START, 'router' as any);

  // Add conditional edges from router
  graph.addConditionalEdges(
    'router' as any,
    (state: RunState) => {
      // Check if workflow is complete
      const allNodes = workflow.nodes.map((n) => n.id);
      const processedNodes = Object.entries(state.statuses).filter(
        ([_, status]) => status !== 'PENDING' && status !== 'RUNNING'
      );

      if (processedNodes.length === allNodes.length) {
        // All nodes processed
        return END;
      }

      // Return next nodes to execute (or END if none ready)
      if (state.next.length === 0) {
        // No nodes ready - check for deadlock
        const pendingNodes = allNodes.filter(
          (id) => !state.statuses[id] || state.statuses[id] === 'PENDING'
        );

        if (pendingNodes.length > 0) {
          // Deadlock detected - no nodes ready but some still pending
          throw new Error(
            `Workflow deadlock detected. Nodes still pending but none are ready: ${pendingNodes.join(', ')}`
          );
        }

        return END;
      }

      // Execute the first ready node
      return state.next[0];
    }
  );

  // Connect all nodes back to router
  for (const node of workflow.nodes) {
    graph.addEdge(node.id as any, 'router' as any);
  }

  // Compile and return the graph
  return graph.compile(checkpointer ? { checkpointer } : undefined);
}



