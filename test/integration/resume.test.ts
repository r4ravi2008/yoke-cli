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
  let testDir: string;
  let testRunsDir: string;
  let testCacheDir: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, '..', '..', '.test-runs', `test-${Date.now()}`);
    testRunsDir = path.join(testDir, 'runs');
    testCacheDir = path.join(testDir, 'cache');

    await fs.mkdir(testRunsDir, { recursive: true });
    await fs.mkdir(testCacheDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should resume workflow after node failure', async () => {
    const runDir = path.join(testRunsDir, 'resume-after-failure');
    await fs.mkdir(runDir, { recursive: true });
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
    (workflow.nodes[1] as any).command = 'echo';
    (workflow.nodes[1] as any).args = ['step2 fixed'];

    // ========== RESUME RUN (should succeed) ==========
    const checkpointer2 = SqliteSaver.fromConnString(checkpointDbPath);

    const runStore2 = await RunStore.loadForResume(runDir);

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
    await fs.mkdir(runDir, { recursive: true });
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
    (workflow.nodes[1] as any).command = 'echo';
    (workflow.nodes[1] as any).args = ['step2'];

    const checkpointer2 = SqliteSaver.fromConnString(checkpointDbPath);
    const runStore2 = await RunStore.loadForResume(runDir);

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
    await fs.mkdir(runDir, { recursive: true });
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
    (workflow.nodes[1] as any).command = 'echo';
    (workflow.nodes[1] as any).args = ['fixed'];

    const checkpointer2 = SqliteSaver.fromConnString(checkpointDbPath);
    const runStore2 = await RunStore.loadForResume(runDir);

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

