# Phase B.2: Resume Functionality - Implementation Plan

**Status**: Ready for Implementation  
**Approach**: LangGraph-Native (Leverage Built-in Checkpointing)  
**Estimated Time**: 5-6 hours  
**Priority**: 🔴 High (Top Priority - Now Unblocked)  
**Last Updated**: 2025-10-23

---

## 🎯 Executive Summary

This plan implements workflow resume capabilities by **leveraging LangGraph's built-in checkpointing system** rather than building custom logic. LangGraph already provides automatic state persistence, smart resume logic, and checkpoint management - we simply need to configure it.

### Key Insight

**LangGraph handles the hard parts automatically:**
- ✅ Saves state after each super-step
- ✅ Loads checkpoints on resume
- ✅ Skips completed nodes
- ✅ Resumes from exact failure point
- ✅ Manages checkpoint serialization

**We only need to:**
1. Pass a `SqliteSaver` checkpointer to `graph.compile()`
2. Pass a `thread_id` in config to `graph.invoke()`
3. Store the `thread_id` in `run.json` for resume

---

## 🏗️ Architecture Overview

### How LangGraph Checkpointing Works

```
┌─────────────────────────────────────────────────────────────┐
│                    New Workflow Run                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Initialize Checkpointer                                  │
│     const checkpointer = SqliteSaver.fromConnString(dbPath)  │
│     await checkpointer.setup()                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Compile Graph with Checkpointer                          │
│     const graph = workflow.compile({ checkpointer })         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Execute with Thread ID                                   │
│     await graph.invoke(initialState, {                       │
│       configurable: { thread_id: "run-abc123" }              │
│     })                                                        │
│                                                               │
│     LangGraph automatically:                                 │
│     • Saves checkpoint after each node                       │
│     • Associates checkpoints with thread_id                  │
│     • Stores in SQLite database                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    [Workflow Fails]
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Resume Workflow                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Load Same Checkpointer                                   │
│     const checkpointer = SqliteSaver.fromConnString(dbPath)  │
│     await checkpointer.setup()                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Compile Graph (Same Way)                                 │
│     const graph = workflow.compile({ checkpointer })         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Resume with Same Thread ID                               │
│     await graph.invoke(null, {  // null = use checkpoint     │
│       configurable: { thread_id: "run-abc123" }              │
│     })                                                        │
│                                                               │
│     LangGraph automatically:                                 │
│     • Loads last checkpoint for thread_id                    │
│     • Skips completed nodes                                  │
│     • Continues from failure point                           │
│     • Saves new checkpoints as it progresses                 │
└─────────────────────────────────────────────────────────────┘
```

### Thread ID Strategy

- **Thread ID**: Unique identifier for each workflow run
- **Generated once**: When run starts, stored in `run.json`
- **Persistent**: Used for all checkpoints in that run
- **Namespace**: Allows multiple runs in same database
- **Format**: `run-{timestamp}-{random}` (e.g., `run-1729701234-x7k9m2p`)

---

## 📝 Implementation Tasks

### Task 1: Install SQLite Checkpointer Package

**Priority**: High  
**Complexity**: Low  
**Estimated Time**: 5 minutes

**Action**:
```bash
npm install @langchain/langgraph-checkpoint-sqlite
```

**Verification**:
```bash
npm list @langchain/langgraph-checkpoint-sqlite
```

**Files Modified**:
- `package.json` (automatic)
- `package-lock.json` (automatic)

---

### Task 2: Update buildGraphFromWorkflow to Accept Checkpointer

**Priority**: High  
**Complexity**: Low  
**Estimated Time**: 15 minutes

**File**: `src/runtime/graph/buildGraph.ts`

**Changes**:
1. Import `BaseCheckpointSaver` type
2. Add optional `checkpointer` parameter
3. Pass checkpointer to `graph.compile()`

**Implementation**:
```typescript
import { StateGraph, START, END } from '@langchain/langgraph';
import { BaseCheckpointSaver } from '@langchain/langgraph';  // NEW
import { WorkflowDefinition } from '../../schema/types';
import { RunStateAnnotation, RunState } from './state';
import { createNodeHandler, NodeContext } from './nodes';

/**
 * Build a LangGraph StateGraph from a workflow definition.
 * 
 * @param workflow The workflow definition from YAML
 * @param ctx Context containing stores and registries
 * @param checkpointer Optional checkpointer for state persistence and resume
 * @returns A compiled LangGraph that can be invoked
 */
export function buildGraphFromWorkflow(
  workflow: WorkflowDefinition,
  ctx: NodeContext,
  checkpointer?: BaseCheckpointSaver  // NEW: Optional checkpointer parameter
) {
  // Create the state graph
  const graph = new StateGraph(RunStateAnnotation);

  // Add all workflow nodes
  for (const node of workflow.nodes) {
    const handler = createNodeHandler(node, ctx);
    graph.addNode(node.id, handler);
  }

  // Add router node
  graph.addNode('router', async (state: RunState): Promise<Partial<RunState>> => {
    // ... existing router logic ...
  });

  // ... existing edge configuration ...

  // Compile with checkpointer if provided
  return graph.compile(
    checkpointer ? { checkpointer } : undefined  // NEW: Pass checkpointer to compile
  );
}
```

**Testing**:
- Verify graph compiles without checkpointer (backward compatible)
- Verify graph compiles with checkpointer
- Verify no breaking changes to existing tests

---

### Task 3: Update RunStore for Thread ID Management

**Priority**: High  
**Complexity**: Low  
**Estimated Time**: 20 minutes

**File**: `src/runtime/store/run-store.ts`

**Changes**:
1. Add `threadId` to `RunMetadata` interface
2. Add `checkpointDbPath` to `RunMetadata` interface
3. Generate thread ID in constructor
4. Add getter methods for thread ID and checkpoint path

**Implementation**:
```typescript
import { promises as fs } from 'fs';
import path from 'path';
import { NodeOutput, NodeStatus } from '../graph/state';

export interface RunMetadata {
  workflowName: string;
  threadId: string;  // NEW: Thread ID for checkpointing
  checkpointDbPath: string;  // NEW: Path to checkpoint database
  startTime: string;
  endTime?: string;
  status: 'running' | 'success' | 'failed';
  nodes: Record<string, {
    status: NodeStatus;
    startTime?: string;
    endTime?: string;
    duration?: number;
    output?: NodeOutput;
    error?: string;
  }>;
}

export class RunStore {
  private runDir: string;
  private metadata: RunMetadata;

  constructor(runDir: string, workflowName: string, threadId?: string) {
    this.runDir = runDir;
    this.metadata = {
      workflowName,
      threadId: threadId || this.generateThreadId(),  // NEW: Generate or use provided
      checkpointDbPath: path.join(runDir, 'checkpoints.db'),  // NEW: Checkpoint DB location
      startTime: new Date().toISOString(),
      status: 'running',
      nodes: {},
    };
  }

  // NEW: Generate unique thread ID
  private generateThreadId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `run-${timestamp}-${random}`;
  }

  // NEW: Get thread ID for this run
  getThreadId(): string {
    return this.metadata.threadId;
  }

  // NEW: Get checkpoint database path
  getCheckpointDbPath(): string {
    return this.metadata.checkpointDbPath;
  }

  // ... existing methods ...
}
```

**Testing**:
- Verify thread ID is generated and stored
- Verify thread ID can be provided in constructor
- Verify checkpoint DB path is correct
- Verify thread ID persists in `run.json`

---

### Task 4: Update RuntimeContext Interface

**Priority**: High  
**Complexity**: Low  
**Estimated Time**: 10 minutes

**File**: `src/runtime/graph/runtime.ts`

**Changes**:
1. Import `BaseCheckpointSaver` type
2. Add optional `checkpointer` to `RuntimeContext`
3. Add optional `threadId` for resume scenarios

**Implementation**:
```typescript
import { WorkflowDefinition } from '../../schema/types';
import { createInitialState } from './state';
import { buildGraphFromWorkflow } from './buildGraph';
import { AgentRegistry } from '../agents/registry';
import { CacheStore } from '../store/cache-store';
import { RunStore } from '../store/run-store';
import { BaseCheckpointSaver } from '@langchain/langgraph';  // NEW

/**
 * Runtime context containing stores and configuration
 */
export interface RuntimeContext {
  agentRegistry: AgentRegistry;
  cacheStore: CacheStore;
  runStore: RunStore;
  checkpointer?: BaseCheckpointSaver;  // NEW: Optional checkpointer for resume
  threadId?: string;  // NEW: Thread ID for resume (if resuming existing run)
  verbose?: boolean;
}
```

**Testing**:
- Verify interface compiles
- Verify backward compatibility (checkpointer is optional)

---

### Task 5: Update WorkflowRuntime to Support Resume

**Priority**: High
**Complexity**: Medium
**Estimated Time**: 45 minutes

**File**: `src/runtime/graph/runtime.ts`

**Changes**:
1. Get or generate thread ID
2. Build config with thread ID
3. Pass checkpointer to `buildGraphFromWorkflow`
4. Handle resume vs new run logic
5. Use `null` for initial state when resuming

**Implementation**:
```typescript
export class WorkflowRuntime {
  private workflow: WorkflowDefinition;
  private ctx: RuntimeContext;

  constructor(workflow: WorkflowDefinition, ctx: RuntimeContext) {
    this.workflow = workflow;
    this.ctx = ctx;
  }

  async run(): Promise<void> {
    // Get thread ID (from context if resuming, or from run store if new)
    const threadId = this.ctx.threadId || this.ctx.runStore.getThreadId();
    const isResume = !!this.ctx.threadId;

    // Build config with thread ID for checkpointing
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    // Build the LangGraph from workflow definition with checkpointer
    const graph = buildGraphFromWorkflow(
      this.workflow,
      {
        agentRegistry: this.ctx.agentRegistry,
        cacheStore: this.ctx.cacheStore,
        runStore: this.ctx.runStore,
        verbose: this.ctx.verbose,
      },
      this.ctx.checkpointer  // Pass checkpointer (undefined if not provided)
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
      // RESUME: LangGraph will load state from checkpoint
      if (this.ctx.verbose) {
        const state = await graph.getState(config);
        console.log(`[Resume] Loading checkpoint: ${state.config.configurable.checkpoint_id}`);

        const completedNodes = Object.entries(state.values.statuses)
          .filter(([_, status]) => status === 'SUCCESS' || status === 'CACHED')
          .map(([id, _]) => id);

        if (completedNodes.length > 0) {
          console.log(`[Resume] Skipping completed nodes: ${completedNodes.join(', ')}`);
        }
      }

      // Set initialState to null - LangGraph will use checkpoint
      initialState = null;
    }

    try {
      // Execute the graph
      // If resuming, initialState is null and LangGraph loads from checkpoint
      // If new run, initialState contains the initial workflow state
      const finalState = await graph.invoke(initialState, config);

      // Check for failures
      if (finalState.failed) {
        await this.ctx.runStore.complete('failed');
        const failedNode = finalState.failed.nodeId;
        const error = finalState.failed.error;

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
```

**Testing**:
- Verify new runs work without checkpointer
- Verify new runs work with checkpointer
- Verify resume loads checkpoint correctly
- Verify resume skips completed nodes
- Verify verbose logging shows resume info

---

### Task 6: Update CLI Run Command

**Priority**: High
**Complexity**: Medium
**Estimated Time**: 1.5 hours

**File**: `src/cli/commands/run.ts`

**Changes**:
1. Import `SqliteSaver` from checkpoint-sqlite package
2. Detect `--resume` flag
3. Load existing run metadata if resuming
4. Initialize checkpointer with appropriate database path
5. Pass checkpointer and thread ID to runtime
6. Provide helpful error messages and resume instructions

**Implementation**:
```typescript
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import path from 'path';
import chalk from 'chalk';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';  // NEW
import { WorkflowDefinition } from '../../schema/types';
import { validateWorkflow } from '../../schema/validator';
import { WorkflowRuntime } from '../../runtime/graph/runtime';
import { AgentRegistry } from '../../runtime/agents/registry';
import { CacheStore } from '../../runtime/store/cache-store';
import { RunStore } from '../../runtime/store/run-store';

export interface RunOptions {
  concurrency?: number;
  out?: string;
  resume?: boolean;
  only?: string;
  verbose?: boolean;
}

export async function runCommand(workflowPath: string, options: RunOptions): Promise<void> {
  console.log(chalk.blue(`Loading workflow from ${workflowPath}...`));

  const content = await fs.readFile(workflowPath, 'utf8');
  const workflow = yaml.load(content) as WorkflowDefinition;

  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    console.error(chalk.red('Workflow validation failed:'));
    validation.errors?.forEach((err) => console.error(chalk.red(`  - ${err}`)));
    process.exit(1);
  }

  console.log(chalk.green(`Workflow validated: ${workflow.name}`));

  let runDir: string;
  let threadId: string | undefined;
  let checkpointer: SqliteSaver;
  let isResume = false;

  if (options.resume) {
    // ========== RESUME MODE ==========
    if (!options.out) {
      console.error(chalk.red('Error: --out directory must be specified when using --resume'));
      console.log(chalk.yellow('Example: dagrun run workflow.yaml --resume --out .runs/my-run'));
      process.exit(1);
    }

    runDir = options.out;

    // Check if run directory exists
    try {
      await fs.access(runDir);
    } catch {
      console.error(chalk.red(`Error: Run directory does not exist: ${runDir}`));
      console.log(chalk.yellow('Make sure you specified the correct --out directory'));
      process.exit(1);
    }

    // Load existing run metadata
    try {
      const metadata = await RunStore.load(runDir);
      threadId = metadata.threadId;
      isResume = true;

      console.log(chalk.yellow(`Resuming workflow: ${metadata.workflowName}`));
      console.log(chalk.blue(`Run directory: ${runDir}`));
      console.log(chalk.blue(`Thread ID: ${threadId}`));
      console.log(chalk.blue(`Original start: ${metadata.startTime}`));
    } catch (error) {
      console.error(chalk.red(`Error: Could not load run metadata from ${runDir}/run.json`));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }

    // Check if checkpoint database exists
    const checkpointDbPath = path.join(runDir, 'checkpoints.db');
    try {
      await fs.access(checkpointDbPath);
    } catch {
      console.error(chalk.red(`Error: Checkpoint database not found: ${checkpointDbPath}`));
      console.log(chalk.yellow('This run may not have checkpointing enabled'));
      process.exit(1);
    }

    // Initialize checkpointer with existing database
    checkpointer = SqliteSaver.fromConnString(checkpointDbPath);
    await checkpointer.setup();

  } else {
    // ========== NEW RUN MODE ==========
    runDir = options.out || path.join('.runs', new Date().toISOString().replace(/:/g, '-'));

    // Create run directory
    await fs.mkdir(runDir, { recursive: true });

    // Initialize checkpointer with new database
    const checkpointDbPath = path.join(runDir, 'checkpoints.db');
    checkpointer = SqliteSaver.fromConnString(checkpointDbPath);
    await checkpointer.setup();

    console.log(chalk.blue(`Run directory: ${runDir}`));
    console.log(chalk.blue(`Starting workflow execution...`));
  }

  const cacheDir = './cache';

  const agentRegistry = new AgentRegistry();
  const cacheStore = new CacheStore(cacheDir);
  const runStore = new RunStore(runDir, workflow.name, threadId);

  await cacheStore.init();
  if (!isResume) {
    await runStore.init();
  }

  console.log('');

  const runtime = new WorkflowRuntime(workflow, {
    agentRegistry,
    cacheStore,
    runStore,
    checkpointer,  // NEW: Pass checkpointer
    threadId: isResume ? threadId : undefined,  // NEW: Pass thread ID if resuming
    verbose: options.verbose,
  });

  try {
    await runtime.run();
    console.log('');
    console.log(chalk.green('✓ Workflow completed successfully!'));
    console.log(chalk.gray(`Run details: ${runDir}/run.json`));
    console.log(chalk.gray(`Checkpoints: ${runDir}/checkpoints.db`));
  } catch (error) {
    console.log('');
    console.error(chalk.red('✗ Workflow failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    console.log(chalk.gray(`Run details: ${runDir}/run.json`));
    console.log(chalk.gray(`Checkpoints: ${runDir}/checkpoints.db`));
    console.log('');
    console.log(chalk.yellow('To resume this workflow, run:'));
    console.log(chalk.cyan(`  dagrun run ${workflowPath} --resume --out ${runDir}`));
    process.exit(1);
  }
}
```

**Testing**:
- Verify new runs create checkpoint database
- Verify resume flag requires --out directory
- Verify resume loads existing run correctly
- Verify error messages are helpful
- Verify resume instructions are displayed on failure

---

### Task 7: Add Resume Integration Tests

**Priority**: High
**Complexity**: Medium
**Estimated Time**: 2 hours

**File**: `test/integration/resume.test.ts`

**Test Scenarios**:
1. Resume after node failure
2. Resume skips completed nodes
3. Resume with deterministic caching
4. Resume with dependency failures
5. Multiple resume attempts
6. Resume with verbose logging

**Implementation**:
```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { WorkflowDefinition } from '../../src/schema/types';
import { WorkflowRuntime } from '../../src/runtime/graph/runtime';
import { AgentRegistry } from '../../src/runtime/agents/registry';
import { CacheStore } from '../../src/runtime/store/cache-store';
import { RunStore } from '../../src/runtime/store/run-store';

describe('Resume Functionality', () => {
  const testRunsDir = path.join(__dirname, '../.test-runs');
  const testCacheDir = path.join(__dirname, '../.test-cache');

  beforeEach(async () => {
    await fs.mkdir(testRunsDir, { recursive: true });
    await fs.mkdir(testCacheDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testRunsDir, { recursive: true, force: true });
    await fs.rm(testCacheDir, { recursive: true, force: true });
  });

  it('should resume workflow after node failure', async () => {
    const runDir = path.join(testRunsDir, 'resume-after-failure');
    const checkpointDbPath = path.join(runDir, 'checkpoints.db');

    // Create workflow that fails at step2
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Resume Test',
      nodes: [
        {
          id: 'step1',
          kind: 'exec',
          name: 'First step',
          command: 'echo',
          args: ['step1 complete'],
          deterministic: true,
        },
        {
          id: 'step2',
          kind: 'exec',
          name: 'Failing step',
          command: 'false',  // This will fail
          deps: ['step1'],
        },
        {
          id: 'step3',
          kind: 'exec',
          name: 'Final step',
          command: 'echo',
          args: ['step3 complete'],
          deps: ['step2'],
        },
      ],
    };

    // ========== FIRST RUN (will fail) ==========
    const checkpointer1 = SqliteSaver.fromConnString(checkpointDbPath);
    await checkpointer1.setup();

    const runStore1 = new RunStore(runDir, 'Resume Test');
    await runStore1.init();
    const threadId = runStore1.getThreadId();

    const runtime1 = new WorkflowRuntime(workflow, {
      agentRegistry: new AgentRegistry(),
      cacheStore: new CacheStore(testCacheDir),
      runStore: runStore1,
      checkpointer: checkpointer1,
    });

    // Expect failure
    await expect(runtime1.run()).rejects.toThrow();

    // Verify step1 succeeded, step2 failed, step3 skipped
    const metadata1 = await RunStore.load(runDir);
    expect(metadata1.status).toBe('failed');
    expect(metadata1.nodes['step1'].status).toBe('SUCCESS');
    expect(metadata1.nodes['step2'].status).toBe('FAILED');
    expect(metadata1.nodes['step3'].status).toBe('SKIPPED');
    expect(metadata1.threadId).toBe(threadId);

    // ========== FIX WORKFLOW ==========
    workflow.nodes[1].command = 'echo';
    workflow.nodes[1].args = ['step2 fixed'];

    // ========== RESUME RUN (should succeed) ==========
    const checkpointer2 = SqliteSaver.fromConnString(checkpointDbPath);
    await checkpointer2.setup();

    const runStore2 = new RunStore(runDir, 'Resume Test', threadId);

    const runtime2 = new WorkflowRuntime(workflow, {
      agentRegistry: new AgentRegistry(),
      cacheStore: new CacheStore(testCacheDir),
      runStore: runStore2,
      checkpointer: checkpointer2,
      threadId,  // Resume with same thread ID
    });

    // Should succeed
    await runtime2.run();

    // Verify all steps succeeded
    const metadata2 = await RunStore.load(runDir);
    expect(metadata2.status).toBe('success');
    expect(metadata2.nodes['step1'].status).toBe('SUCCESS');
    expect(metadata2.nodes['step2'].status).toBe('SUCCESS');
    expect(metadata2.nodes['step3'].status).toBe('SUCCESS');
  });

  it('should skip completed nodes on resume', async () => {
    const runDir = path.join(testRunsDir, 'skip-completed');
    const checkpointDbPath = path.join(runDir, 'checkpoints.db');

    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Skip Test',
      nodes: [
        {
          id: 'step1',
          kind: 'exec',
          command: 'echo',
          args: ['step1'],
          deterministic: true,
        },
        {
          id: 'step2',
          kind: 'exec',
          command: 'false',
          deps: ['step1'],
        },
      ],
    };

    // First run
    const checkpointer1 = SqliteSaver.fromConnString(checkpointDbPath);
    await checkpointer1.setup();
    const runStore1 = new RunStore(runDir, 'Skip Test');
    await runStore1.init();
    const threadId = runStore1.getThreadId();

    const runtime1 = new WorkflowRuntime(workflow, {
      agentRegistry: new AgentRegistry(),
      cacheStore: new CacheStore(testCacheDir),
      runStore: runStore1,
      checkpointer: checkpointer1,
    });

    await expect(runtime1.run()).rejects.toThrow();

    const step1EndTime = (await RunStore.load(runDir)).nodes['step1'].endTime;

    // Fix and resume
    workflow.nodes[1].command = 'echo';
    workflow.nodes[1].args = ['step2'];

    const checkpointer2 = SqliteSaver.fromConnString(checkpointDbPath);
    await checkpointer2.setup();
    const runStore2 = new RunStore(runDir, 'Skip Test', threadId);

    const runtime2 = new WorkflowRuntime(workflow, {
      agentRegistry: new AgentRegistry(),
      cacheStore: new CacheStore(testCacheDir),
      runStore: runStore2,
      checkpointer: checkpointer2,
      threadId,
    });

    await runtime2.run();

    // Verify step1 was NOT re-executed (same end time)
    const metadata = await RunStore.load(runDir);
    expect(metadata.nodes['step1'].endTime).toBe(step1EndTime);
    expect(metadata.status).toBe('success');
  });

  it('should work with deterministic caching on resume', async () => {
    const runDir = path.join(testRunsDir, 'cache-resume');
    const checkpointDbPath = path.join(runDir, 'checkpoints.db');

    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Cache Resume Test',
      nodes: [
        {
          id: 'cached',
          kind: 'exec',
          command: 'echo',
          args: ['cached output'],
          deterministic: true,
        },
        {
          id: 'failing',
          kind: 'exec',
          command: 'false',
          deps: ['cached'],
        },
      ],
    };

    // First run
    const checkpointer1 = SqliteSaver.fromConnString(checkpointDbPath);
    await checkpointer1.setup();
    const runStore1 = new RunStore(runDir, 'Cache Resume Test');
    await runStore1.init();
    const threadId = runStore1.getThreadId();

    const runtime1 = new WorkflowRuntime(workflow, {
      agentRegistry: new AgentRegistry(),
      cacheStore: new CacheStore(testCacheDir),
      runStore: runStore1,
      checkpointer: checkpointer1,
    });

    await expect(runtime1.run()).rejects.toThrow();

    // Verify cached node has output
    const metadata1 = await RunStore.load(runDir);
    expect(metadata1.nodes['cached'].status).toBe('SUCCESS');
    expect(metadata1.nodes['cached'].output).toBeDefined();

    // Fix and resume
    workflow.nodes[1].command = 'echo';
    workflow.nodes[1].args = ['fixed'];

    const checkpointer2 = SqliteSaver.fromConnString(checkpointDbPath);
    await checkpointer2.setup();
    const runStore2 = new RunStore(runDir, 'Cache Resume Test', threadId);

    const runtime2 = new WorkflowRuntime(workflow, {
      agentRegistry: new AgentRegistry(),
      cacheStore: new CacheStore(testCacheDir),
      runStore: runStore2,
      checkpointer: checkpointer2,
      threadId,
    });

    await runtime2.run();

    // Verify success
    const metadata2 = await RunStore.load(runDir);
    expect(metadata2.status).toBe('success');
    expect(metadata2.nodes['cached'].status).toBe('SUCCESS');
    expect(metadata2.nodes['failing'].status).toBe('SUCCESS');
  });
});
```

**Testing**:
- Run all resume tests
- Verify tests pass consistently
- Verify checkpoint databases are created
- Verify cleanup works correctly

---

## 📊 Comparison: Custom vs LangGraph-Native Approach

| Aspect | Custom Approach | LangGraph-Native Approach |
|--------|----------------|---------------------------|
| **Lines of Code** | ~500 lines | ~50 lines |
| **Complexity** | High (state management, checkpoint logic) | Low (configuration only) |
| **Maintenance** | We own all the code | LangGraph team maintains it |
| **Features** | Basic resume only | Resume + time travel + history + streaming |
| **Testing Burden** | Extensive (all edge cases) | Minimal (LangGraph is tested) |
| **Bug Fixes** | We fix them | LangGraph team fixes them |
| **Future Features** | We build them | We get them automatically |
| **Implementation Time** | 8-12 hours | 5-6 hours |
| **Risk** | High (custom state management) | Low (battle-tested library) |
| **Flexibility** | Limited to our implementation | Full LangGraph feature set |

**Conclusion**: LangGraph-native approach is superior in every dimension.

---

## 🎁 Bonus Features (Free with LangGraph)

### 1. State Inspection

Get current state at any time:

```typescript
const graph = buildGraphFromWorkflow(workflow, ctx, checkpointer);
const state = await graph.getState({
  configurable: { thread_id: "run-123" }
});

console.log(state.values);      // Current state values
console.log(state.next);        // Next nodes to execute
console.log(state.tasks);       // Pending tasks
console.log(state.metadata);    // Checkpoint metadata
```

### 2. State History (Time Travel)

View all historical checkpoints:

```typescript
const graph = buildGraphFromWorkflow(workflow, ctx, checkpointer);

for await (const state of graph.getStateHistory({
  configurable: { thread_id: "run-123" }
})) {
  console.log(`Checkpoint: ${state.config.configurable.checkpoint_id}`);
  console.log(`Step: ${state.metadata.step}`);
  console.log(`State:`, state.values);
}
```

### 3. Resume from Specific Checkpoint

Resume from any historical checkpoint (not just the latest):

```typescript
await graph.invoke(null, {
  configurable: {
    thread_id: "run-123",
    checkpoint_id: "1ef663ba-28fe-6528-8002-5a559208592c"  // Specific checkpoint
  }
});
```

### 4. Human-in-the-Loop (Future Enhancement)

Pause execution for human approval:

```typescript
const graph = buildGraphFromWorkflow(workflow, ctx, checkpointer);

// Compile with interrupt points
const graphWithInterrupts = graph.compile({
  checkpointer,
  interruptBefore: ['critical_step'],  // Pause before this node
});

// Execute - will pause before 'critical_step'
await graphWithInterrupts.invoke(initialState, config);

// Human reviews, then resumes
await graphWithInterrupts.invoke(null, config);
```

### 5. Streaming Updates (Future Enhancement)

Get real-time progress updates:

```typescript
for await (const event of graph.stream(initialState, config)) {
  console.log(`Node: ${event.node}`);
  console.log(`Output:`, event.output);
}
```

### 6. State Modification (Future Enhancement)

Modify state before resuming:

```typescript
// Update state at current checkpoint
await graph.updateState(config, {
  values: { someVar: 'newValue' }
});

// Then resume with modified state
await graph.invoke(null, config);
```

---

## ✅ Acceptance Criteria

### Functional Requirements
- [ ] `graph.compile()` accepts optional checkpointer parameter
- [ ] `graph.invoke()` uses `thread_id` in config
- [ ] Thread ID is generated and stored in `run.json`
- [ ] Checkpoint database is created in run directory
- [ ] Resume skips completed nodes automatically
- [ ] Failed nodes are re-executed on resume
- [ ] `--resume` flag works correctly
- [ ] Resume requires `--out` directory
- [ ] Helpful error messages when resume fails
- [ ] Resume instructions displayed on workflow failure

### Non-Functional Requirements
- [ ] No breaking changes to existing workflows
- [ ] Backward compatible (checkpointer is optional)
- [ ] Performance: Resume adds <100ms overhead
- [ ] Clear and comprehensive documentation
- [ ] All existing tests still pass
- [ ] New resume tests pass consistently
- [ ] Code follows existing patterns and style

### User Experience
- [ ] Clear console output for resume operations
- [ ] Verbose mode shows checkpoint information
- [ ] Error messages are actionable
- [ ] Resume command is easy to use

---

## 🧪 Testing Strategy

### Unit Tests
- **checkpointer parameter**: Verify `buildGraphFromWorkflow` accepts checkpointer
- **thread ID generation**: Verify unique thread IDs are generated
- **thread ID persistence**: Verify thread ID is stored in `run.json`
- **config building**: Verify config includes thread_id

### Integration Tests
1. **Resume after node failure**
   - Run workflow that fails at node 2
   - Resume workflow with fixed node
   - Verify node 1 is skipped
   - Verify node 2 is re-executed
   - Verify workflow completes

2. **Resume skips completed nodes**
   - Run workflow that fails
   - Verify completed node timestamps
   - Resume workflow
   - Verify completed nodes have same timestamps (not re-executed)

3. **Resume with deterministic caching**
   - Run workflow with cached nodes
   - Fail at later node
   - Resume workflow
   - Verify cached nodes remain cached

4. **Resume with dependency failures**
   - Run workflow where node A fails
   - Verify node B (depends on A) is skipped
   - Resume with fixed node A
   - Verify node B now executes

5. **Multiple resume attempts**
   - Run workflow that fails
   - Resume and fail again
   - Resume and succeed
   - Verify all checkpoints are preserved

6. **Resume with verbose logging**
   - Resume with `--verbose` flag
   - Verify checkpoint information is displayed
   - Verify skipped nodes are logged

### Manual Testing
- Test resume with example workflows
- Test error messages and user guidance
- Test checkpoint database inspection with SQLite tools
- Test resume after manual interruption (Ctrl+C)

---

## 📈 Success Metrics

1. **Functionality**: All resume test scenarios pass (100%)
2. **Reliability**: Resume success rate > 99% in tests
3. **Performance**: Resume overhead < 100ms
4. **Usability**: Clear CLI messages and helpful errors
5. **Compatibility**: All existing tests pass (17/17)
6. **Code Quality**: Follows existing patterns, well-documented

---

## 🚀 Implementation Timeline

### Phase 1: Setup (30 minutes)
- Task 1: Install SQLite checkpointer package (5 min)
- Task 2: Update buildGraphFromWorkflow (15 min)
- Task 4: Update RuntimeContext interface (10 min)

### Phase 2: Core Implementation (1.5 hours)
- Task 3: Update RunStore for thread ID (20 min)
- Task 5: Update WorkflowRuntime (45 min)
- Task 6: Update CLI run command (1.5 hours)

### Phase 3: Testing & Documentation (3 hours)
- Task 7: Add resume integration tests (2 hours)
- Documentation updates (1 hour)

**Total Estimated Time**: 5-6 hours

---

## 📁 Files Modified/Created

### Modified Files
- `package.json` - Add `@langchain/langgraph-checkpoint-sqlite` dependency
- `src/runtime/graph/buildGraph.ts` - Accept optional checkpointer parameter
- `src/runtime/graph/runtime.ts` - Add RuntimeContext fields, implement resume logic
- `src/runtime/store/run-store.ts` - Add thread ID management
- `src/cli/commands/run.ts` - Implement resume detection and checkpointer initialization

### Created Files
- `test/integration/resume.test.ts` - Resume functionality tests
- `docs/resume-implementation-plan.md` - This document
- `docs/resume-guide.md` - User-facing resume documentation (future)

### File Structure After Implementation
```
.runs/
└── <run-id>/
    ├── run.json                   # Contains threadId and checkpointDbPath
    ├── checkpoints.db             # SQLite checkpoint database (NEW)
    └── artifacts/

src/
├── runtime/
│   ├── graph/
│   │   ├── buildGraph.ts          # MODIFIED: Accept checkpointer
│   │   ├── runtime.ts             # MODIFIED: Resume logic
│   │   ├── state.ts
│   │   └── nodes.ts
│   └── store/
│       ├── run-store.ts           # MODIFIED: Thread ID management
│       ├── cache-store.ts
│       └── log-store.ts
└── cli/
    └── commands/
        └── run.ts                 # MODIFIED: Resume detection

test/
└── integration/
    ├── simple-workflow.test.ts
    └── resume.test.ts             # NEW: Resume tests
```

---

## 🔍 Edge Cases & Considerations

### 1. Concurrent Resume Attempts
**Issue**: Multiple processes trying to resume same run
**Solution**: SQLite handles locking automatically. Document that concurrent resumes are not supported.

### 2. Workflow Definition Changes
**Issue**: Workflow YAML changes between original run and resume
**Solution**:
- Current: Allow resume (workflow is re-validated)
- Future: Add workflow hash to metadata, warn on mismatch
- Future: Add `--force-resume` flag to override

### 3. Checkpoint Database Corruption
**Issue**: SQLite database becomes corrupted
**Solution**:
- Catch SQLite errors gracefully
- Provide clear error message
- Suggest starting fresh run
- Document backup strategies

### 4. Partial Node Execution
**Issue**: Node interrupted mid-execution
**Solution**:
- LangGraph checkpoints AFTER node completion
- Interrupted nodes will be re-executed from start
- This is correct behavior (idempotent execution)

### 5. Cache Invalidation on Resume
**Issue**: Should deterministic cache be invalidated?
**Solution**:
- No - cache is based on input hash, not time
- Cache remains valid across resumes
- Users can manually clear cache if needed

### 6. Long-Running Workflows
**Issue**: Checkpoint database size growth
**Solution**:
- SQLite handles large databases efficiently
- Checkpoints are incremental (only state changes)
- Document expected growth (~1KB per checkpoint)
- Future: Add checkpoint cleanup/pruning

### 7. Missing Checkpoint Database
**Issue**: User deletes checkpoints.db but keeps run.json
**Solution**:
- Detect missing database
- Provide clear error message
- Suggest starting fresh run

### 8. Thread ID Collision
**Issue**: Extremely unlikely thread ID collision
**Solution**:
- Thread ID includes timestamp + random string
- Collision probability: ~1 in 10^15
- No special handling needed

---

## 🎯 Next Steps After Completion

Once resume functionality is complete, these features become trivial to add:

1. **Human-in-the-Loop** - Use `interruptBefore` in compile options
2. **Time Travel** - Already supported via `checkpoint_id` in config
3. **Workflow Debugging** - Use `getStateHistory()` to inspect execution
4. **State Inspection** - Use `getState()` to view current state
5. **Streaming Progress** - Use `graph.stream()` for real-time updates
6. **State Modification** - Use `updateState()` to modify before resume

---

## 📚 References

### LangGraph Documentation
- [Persistence Overview](https://langchain-ai.github.io/langgraphjs/concepts/persistence/)
- [Checkpointing How-To](https://langchain-ai.github.io/langgraphjs/how-tos/persistence/)
- [SQLite Checkpointer](https://langchain-ai.github.io/langgraphjs/reference/classes/checkpoint_sqlite.SqliteSaver.html)
- [State Management](https://langchain-ai.github.io/langgraphjs/concepts/low_level/#state)

### Package Documentation
- [@langchain/langgraph-checkpoint-sqlite NPM](https://www.npmjs.com/package/@langchain/langgraph-checkpoint-sqlite)
- [@langchain/langgraph NPM](https://www.npmjs.com/package/@langchain/langgraph)

### Related Concepts
- [Human-in-the-Loop](https://langchain-ai.github.io/langgraphjs/how-tos/human-in-the-loop/)
- [Time Travel](https://langchain-ai.github.io/langgraphjs/how-tos/time-travel/)
- [Streaming](https://langchain-ai.github.io/langgraphjs/how-tos/streaming/)

---

## 📝 Notes

### Why LangGraph-Native?
- **Less code**: 90% reduction in code to write
- **Better tested**: LangGraph team maintains checkpointing
- **More features**: Get time travel, history, streaming for free
- **Future-proof**: New LangGraph features work automatically
- **Lower risk**: Battle-tested library vs custom implementation

### Key Design Decisions
1. **SQLite for persistence**: Recommended by LangGraph, works locally
2. **Thread ID in run.json**: Enables resume without additional config
3. **Checkpoint DB in run directory**: Keeps everything together
4. **Optional checkpointer**: Maintains backward compatibility
5. **Null initial state on resume**: LangGraph convention for loading checkpoint

---

**Status**: Ready for Implementation
**Blocking**: None
**Dependencies**: Phase B.1 (LangGraph Integration) ✅ Complete
**Risk Level**: Low (using battle-tested LangGraph features)
**Confidence**: High (simple configuration, well-documented)


