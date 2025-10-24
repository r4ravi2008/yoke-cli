import { BaseCheckpointSaver } from '@langchain/langgraph';
import { WorkflowDefinition } from '../../schema/types';
import { createInitialState } from './state';
import { buildGraphFromWorkflow } from './buildGraph';
import { AgentRegistry } from '../agents/registry';
import { CacheStore } from '../store/cache-store';
import { RunStore } from '../store/run-store';

/**
 * Runtime context containing stores and configuration
 */
export interface RuntimeContext {
  agentRegistry: AgentRegistry;
  cacheStore: CacheStore;
  runStore: RunStore;
  checkpointer?: BaseCheckpointSaver;  // Optional checkpointer for resume
  threadId?: string;  // Thread ID for resume (if resuming existing run)
  verbose?: boolean;
}

/**
 * WorkflowRuntime orchestrates workflow execution using LangGraph.
 *
 * This class builds a LangGraph StateGraph from the workflow definition
 * and executes it, handling state management, node execution, and error handling.
 */
export class WorkflowRuntime {
  private workflow: WorkflowDefinition;
  private ctx: RuntimeContext;

  constructor(workflow: WorkflowDefinition, ctx: RuntimeContext) {
    this.workflow = workflow;
    this.ctx = ctx;
  }

  /**
   * Execute the workflow using LangGraph.
   *
   * This method:
   * 1. Creates initial state from workflow vars (or loads from checkpoint if resuming)
   * 2. Builds a LangGraph StateGraph from the workflow definition
   * 3. Invokes the graph to execute the workflow
   * 4. Handles success/failure and updates run store
   */
  async run(): Promise<void> {
    // Get thread ID (from context if resuming, or from run store if new)
    const threadId = this.ctx.threadId || this.ctx.runStore.getThreadId();
    const isResume = !!this.ctx.threadId;

    // Build the LangGraph from workflow definition with checkpointer
    const graph = buildGraphFromWorkflow(
      this.workflow,
      {
        agentRegistry: this.ctx.agentRegistry,
        cacheStore: this.ctx.cacheStore,
        runStore: this.ctx.runStore,
        verbose: this.ctx.verbose,
      },
      this.ctx.checkpointer
    );

    let initialState;

    if (!isResume) {
      // NEW RUN: Initialize all node statuses to PENDING
      const initialStatuses: Record<string, 'PENDING'> = {};
      for (const node of this.workflow.nodes) {
        initialStatuses[node.id] = 'PENDING';
        await this.ctx.runStore.setNodeStatus(node.id, 'PENDING');
      }

      // Create initial state
      initialState = createInitialState(this.workflow.vars || {});
      initialState.statuses = initialStatuses;
    } else {
      // RESUME: Load state from checkpoint and reset failed nodes
      if (!this.ctx.checkpointer) {
        throw new Error('Cannot resume without a checkpointer');
      }

      if (this.ctx.verbose) {
        console.log(`[Resume] Resuming from checkpoint for thread: ${threadId}`);
      }

      // Get the current state from the checkpoint
      const checkpointState = await graph.getState({
        configurable: { thread_id: threadId },
      } as any);

      if (checkpointState && checkpointState.values) {
        // Reset FAILED and SKIPPED nodes to PENDING so they can be re-executed
        const statusUpdates: Record<string, 'PENDING'> = {};
        for (const [nodeId, status] of Object.entries(checkpointState.values.statuses || {})) {
          if (status === 'FAILED' || status === 'SKIPPED') {
            statusUpdates[nodeId] = 'PENDING';
            await this.ctx.runStore.setNodeStatus(nodeId, 'PENDING');
            if (this.ctx.verbose) {
              console.log(`[Resume] Resetting ${status.toLowerCase()} node ${nodeId} to PENDING`);
            }
          }
        }

        // Create initial state from checkpoint with updated statuses
        // Clear the failed field since we're resetting failed nodes
        initialState = {
          ...checkpointState.values,
          statuses: {
            ...checkpointState.values.statuses,
            ...statusUpdates,
          },
          failed: undefined,  // Clear failed state when resuming
        };
      } else {
        // No checkpoint found, start fresh
        initialState = null;
      }
    }

    try {
      // Execute the graph
      // Pass initialState (either from checkpoint with reset failed nodes, or fresh initial state)
      // Pass config with thread_id for checkpointing
      const finalState = await graph.invoke(initialState, {
        configurable: { thread_id: threadId },
      } as any);

      // Check for failures
      if (finalState.failed) {
        await this.ctx.runStore.complete('failed');
        const failedNode = finalState.failed.nodeId;
        const error = finalState.failed.error;

        // Count skipped nodes
        const skippedCount = Object.values(finalState.statuses).filter(
          (s) => s === 'SKIPPED'
        ).length;
        const skippedMsg = skippedCount > 0 ? ` (${skippedCount} skipped)` : '';

        throw new Error(`Workflow failed: ${failedNode} failed: ${error}${skippedMsg}`);
      }

      // Check if any nodes failed
      const failedNodes = Object.entries(finalState.statuses)
        .filter(([_, status]) => status === 'FAILED')
        .map(([nodeId, _]) => nodeId);

      if (failedNodes.length > 0) {
        await this.ctx.runStore.complete('failed');
        const skippedCount = Object.values(finalState.statuses).filter(
          (s) => s === 'SKIPPED'
        ).length;
        const skippedMsg = skippedCount > 0 ? ` (${skippedCount} skipped)` : '';
        throw new Error(`Workflow failed: ${failedNodes.join(', ')} failed${skippedMsg}`);
      }

      // Success!
      await this.ctx.runStore.complete('success');
    } catch (error) {
      // Ensure run store is marked as failed
      await this.ctx.runStore.complete('failed');
      throw error;
    }
  }
}
