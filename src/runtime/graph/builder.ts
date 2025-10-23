import { StateGraph, Annotation } from '@langchain/langgraph';
import { WorkflowDefinition, NodeDefinition, ExecNode, TaskNode } from '../../schema/types';
import { NodeOutput } from './state';
import { runExec } from '../steps/exec';
import { runTask } from '../steps/task';
import { AgentRegistry } from '../agents/registry';
import { CacheStore } from '../store/cache-store';
import { RunStore } from '../store/run-store';
import { createTemplateEngine } from '../templating/engine';

const WorkflowAnnotation = Annotation.Root({
  vars: Annotation<Record<string, unknown>>,
  outputs: Annotation<Record<string, NodeOutput>>,
  statuses: Annotation<Record<string, string>>,
  next: Annotation<string[]>,
  failed: Annotation<{ nodeId: string; error: string } | null>,
});

export interface BuildContext {
  agentRegistry: AgentRegistry;
  cacheStore: CacheStore;
  runStore: RunStore;
  verbose?: boolean;
}

export function buildGraphFromYaml(
  workflow: WorkflowDefinition,
  ctx: BuildContext
) {
  const graph = new StateGraph(WorkflowAnnotation);
  const { agentRegistry, cacheStore, runStore, verbose } = ctx;

  const nodeMap = new Map<string, NodeDefinition>();
  workflow.nodes.forEach((node) => nodeMap.set(node.id, node));

  const logger = (nodeId: string, msg: string) => {
    if (verbose) {
      console.log(`[${nodeId}] ${msg}`);
    }
  };

  for (const node of workflow.nodes) {
    const nodeHandler = async (state: typeof WorkflowAnnotation.State) => {
      const nodeId = node.id;
      
      try {
        await runStore.setNodeStatus(nodeId, 'RUNNING');
        logger(nodeId, `Starting node ${node.name || nodeId}`);

        const templateEngine = createTemplateEngine({
          vars: state.vars,
          outputs: state.outputs,
        });

        const resolvedNode = templateEngine.renderObject(node);

        let output: NodeOutput;

        if (resolvedNode.kind === 'exec') {
          output = await runExec(resolvedNode as ExecNode, {
            cacheGet: (key) => cacheStore.get(key),
            cachePut: (key, val) => cacheStore.put(key, val),
            log: (msg) => logger(nodeId, msg),
          });
        } else if (resolvedNode.kind === 'task') {
          const taskNode = resolvedNode as TaskNode;
          const agent = agentRegistry.get(taskNode.agent);
          if (!agent) {
            throw new Error(`Agent ${taskNode.agent} not found`);
          }
          output = await runTask(agent, taskNode, {
            cacheGet: (key) => cacheStore.get(key),
            cachePut: (key, val) => cacheStore.put(key, val),
            writeArtifact: (rel, data) => runStore.writeArtifact(rel, data),
            log: (msg) => logger(nodeId, msg),
          });
        } else {
          throw new Error(`Unsupported node kind: ${resolvedNode.kind}`);
        }

        await runStore.setNodeOutput(nodeId, output);
        await runStore.setNodeStatus(nodeId, output.cached ? 'CACHED' : 'SUCCESS');

        logger(nodeId, `Completed successfully`);

        return {
          outputs: { ...state.outputs, [nodeId]: output },
          statuses: { ...state.statuses, [nodeId]: output.cached ? 'CACHED' : 'SUCCESS' },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger(nodeId, `Failed: ${errorMsg}`);
        await runStore.setNodeError(nodeId, errorMsg);
        await runStore.setNodeStatus(nodeId, 'FAILED');

        return {
          failed: { nodeId, error: errorMsg },
          statuses: { ...state.statuses, [nodeId]: 'FAILED' },
        };
      }
    };

    graph.addNode(node.id, nodeHandler);
  }

  const nodeDeps = new Map<string, string[]>();
  workflow.nodes.forEach((node) => {
    nodeDeps.set(node.id, node.deps || []);
  });

  const nodesWithoutDeps = workflow.nodes.filter((n) => !n.deps || n.deps.length === 0);
  nodesWithoutDeps.forEach((node) => {
    graph.addEdge('__start__', node.id);
  });

  workflow.nodes.forEach((node) => {
    if (node.deps && node.deps.length > 0) {
      node.deps.forEach((depId) => {
        graph.addEdge(depId, node.id);
      });
    }
  });

  const nodesDependedOn = new Set<string>();
  workflow.nodes.forEach((node) => {
    if (node.deps) {
      node.deps.forEach((dep) => nodesDependedOn.add(dep));
    }
  });

  const leafNodes = workflow.nodes.filter((n) => !nodesDependedOn.has(n.id));
  leafNodes.forEach((node) => {
    graph.addEdge(node.id, '__end__');
  });

  return graph.compile();
}
