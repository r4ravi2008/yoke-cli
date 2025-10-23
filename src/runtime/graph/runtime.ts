import { WorkflowDefinition, NodeDefinition, ExecNode, TaskNode } from '../../schema/types';
import { NodeOutput, NodeStatus } from './state';
import { runExec } from '../steps/exec';
import { runTask } from '../steps/task';
import { AgentRegistry } from '../agents/registry';
import { CacheStore } from '../store/cache-store';
import { RunStore } from '../store/run-store';
import { createTemplateEngine } from '../../templating/engine';

export interface RuntimeContext {
  agentRegistry: AgentRegistry;
  cacheStore: CacheStore;
  runStore: RunStore;
  verbose?: boolean;
}

export class WorkflowRuntime {
  private workflow: WorkflowDefinition;
  private ctx: RuntimeContext;
  private state: {
    vars: Record<string, unknown>;
    outputs: Record<string, NodeOutput>;
    statuses: Record<string, NodeStatus>;
  };

  constructor(workflow: WorkflowDefinition, ctx: RuntimeContext) {
    this.workflow = workflow;
    this.ctx = ctx;
    this.state = {
      vars: workflow.vars || {},
      outputs: {},
      statuses: {},
    };
  }

  private log(nodeId: string, msg: string): void {
    if (this.ctx.verbose) {
      console.log(`[${nodeId}] ${msg}`);
    }
  }

  async run(): Promise<void> {
    const nodeMap = new Map<string, NodeDefinition>();
    this.workflow.nodes.forEach((node) => {
      nodeMap.set(node.id, node);
      this.state.statuses[node.id] = 'PENDING';
    });

    const nodeDeps = new Map<string, string[]>();
    this.workflow.nodes.forEach((node) => {
      nodeDeps.set(node.id, node.deps || []);
    });

    const completed = new Set<string>();
    const failed = new Set<string>();
    const skipped = new Set<string>();

    while (completed.size + failed.size + skipped.size < this.workflow.nodes.length) {
      const ready: string[] = [];

      for (const node of this.workflow.nodes) {
        if (completed.has(node.id) || failed.has(node.id) || skipped.has(node.id)) continue;
        if (this.state.statuses[node.id] === 'RUNNING') continue;

        const deps = nodeDeps.get(node.id) || [];
        const allDepsComplete = deps.every((dep) => completed.has(dep));
        const anyDepFailed = deps.some((dep) => failed.has(dep) || skipped.has(dep));

        if (anyDepFailed) {
          this.state.statuses[node.id] = 'SKIPPED';
          await this.ctx.runStore.setNodeStatus(node.id, 'SKIPPED');
          skipped.add(node.id);
          continue;
        }

        if (allDepsComplete) {
          ready.push(node.id);
        }
      }

      if (ready.length === 0) {
        const pending = this.workflow.nodes.filter(
          (node) => !completed.has(node.id) && !failed.has(node.id) && !skipped.has(node.id)
        );
        if (pending.length > 0) {
          await this.ctx.runStore.complete('failed');
          throw new Error(
            `Workflow deadlock detected. Nodes still pending but none are ready: ${pending.map((n) => n.id).join(', ')}`
          );
        }
        break;
      }

      for (const nodeId of ready) {
        try {
          await this.executeNode(nodeId);
          completed.add(nodeId);
        } catch (error) {
          failed.add(nodeId);
        }
      }
    }

    if (failed.size > 0) {
      await this.ctx.runStore.complete('failed');
      const failedNodes = Array.from(failed).join(', ');
      const skippedNodes = skipped.size > 0 ? ` (${skipped.size} skipped)` : '';
      throw new Error(`Workflow failed: ${failedNodes} failed${skippedNodes}`);
    }

    await this.ctx.runStore.complete('success');
  }

  private async executeNode(nodeId: string): Promise<void> {
    const node = this.workflow.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    try {
      await this.ctx.runStore.setNodeStatus(nodeId, 'RUNNING');
      this.state.statuses[nodeId] = 'RUNNING';
      this.log(nodeId, `Starting node ${node.name || nodeId}`);

      const templateEngine = createTemplateEngine({
        vars: this.state.vars,
        outputs: this.state.outputs,
      });

      const resolvedNode = templateEngine.renderObject(node);

      let output: NodeOutput;

      if (resolvedNode.kind === 'exec') {
        output = await runExec(resolvedNode as ExecNode, {
          cacheGet: (key) => this.ctx.cacheStore.get(key),
          cachePut: (key, val) => this.ctx.cacheStore.put(key, val),
          log: (msg) => this.log(nodeId, msg),
        });
      } else if (resolvedNode.kind === 'task') {
        const taskNode = resolvedNode as TaskNode;
        const agent = this.ctx.agentRegistry.get(taskNode.agent);
        if (!agent) {
          throw new Error(`Agent ${taskNode.agent} not found`);
        }
        output = await runTask(agent, taskNode, {
          cacheGet: (key) => this.ctx.cacheStore.get(key),
          cachePut: (key, val) => this.ctx.cacheStore.put(key, val),
          writeArtifact: (rel, data) => this.ctx.runStore.writeArtifact(rel, data),
          log: (msg) => this.log(nodeId, msg),
        });
      } else {
        throw new Error(`Unsupported node kind: ${resolvedNode.kind}`);
      }

      this.state.outputs[nodeId] = output;
      this.state.statuses[nodeId] = output.cached ? 'CACHED' : 'SUCCESS';

      await this.ctx.runStore.setNodeOutput(nodeId, output);
      await this.ctx.runStore.setNodeStatus(nodeId, output.cached ? 'CACHED' : 'SUCCESS');

      this.log(nodeId, `Completed successfully`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(nodeId, `Failed: ${errorMsg}`);
      this.state.statuses[nodeId] = 'FAILED';
      await this.ctx.runStore.setNodeError(nodeId, errorMsg);
      await this.ctx.runStore.setNodeStatus(nodeId, 'FAILED');
      throw error;
    }
  }
}
