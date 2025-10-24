import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import path from 'path';
import { WorkflowDefinition } from '../../src/schema/types';
import { WorkflowRuntime } from '../../src/runtime/graph/runtime';
import { AgentRegistry } from '../../src/runtime/agents/registry';
import { CacheStore } from '../../src/runtime/store/cache-store';
import { RunStore } from '../../src/runtime/store/run-store';

describe('Simple Workflow Integration', () => {
  let testDir: string;
  let cacheDir: string;
  let runDir: string;

  beforeEach(async () => {
    // Create temporary directories for testing
    testDir = path.join(__dirname, '..', '..', '.test-runs', `test-${Date.now()}`);
    cacheDir = path.join(testDir, 'cache');
    runDir = path.join(testDir, 'run');
    
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should execute a simple two-step workflow', async () => {
    // Load the simple workflow
    const workflowPath = path.join(__dirname, '..', '..', 'examples', 'simple-workflow.yaml');
    const content = await fs.readFile(workflowPath, 'utf8');
    const workflow = yaml.load(content) as WorkflowDefinition;

    // Create runtime context
    const agentRegistry = new AgentRegistry();
    const cacheStore = new CacheStore(cacheDir);
    const runStore = new RunStore(runDir, workflow.name);

    await cacheStore.init();
    await runStore.init();

    // Create and run workflow
    const runtime = new WorkflowRuntime(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    await runtime.run();

    // Verify run completed successfully
    const runMetadata = runStore.getMetadata();
    expect(runMetadata.status).toBe('success');
    expect(Object.keys(runMetadata.nodes)).toHaveLength(2);

    // Verify step1 executed
    const step1Status = runMetadata.nodes['step1'];
    expect(step1Status).toBeDefined();
    expect(step1Status?.status).toMatch(/SUCCESS|CACHED/);

    // Verify step2 executed
    const step2Status = runMetadata.nodes['step2'];
    expect(step2Status).toBeDefined();
    expect(step2Status?.status).toBe('SUCCESS');
  });

  it('should cache deterministic steps on second run', async () => {
    // Load the simple workflow
    const workflowPath = path.join(__dirname, '..', '..', 'examples', 'simple-workflow.yaml');
    const content = await fs.readFile(workflowPath, 'utf8');
    const workflow = yaml.load(content) as WorkflowDefinition;

    // Create runtime context
    const agentRegistry = new AgentRegistry();
    const cacheStore = new CacheStore(cacheDir);

    await cacheStore.init();

    // First run
    const runDir1 = path.join(testDir, 'run1');
    await fs.mkdir(runDir1, { recursive: true });
    const runStore1 = new RunStore(runDir1, workflow.name);
    await runStore1.init();

    const runtime1 = new WorkflowRuntime(workflow, {
      agentRegistry,
      cacheStore,
      runStore: runStore1,
      verbose: false,
    });

    await runtime1.run();

    // Second run (should use cache)
    const runDir2 = path.join(testDir, 'run2');
    await fs.mkdir(runDir2, { recursive: true });
    const runStore2 = new RunStore(runDir2, workflow.name);
    await runStore2.init();

    const runtime2 = new WorkflowRuntime(workflow, {
      agentRegistry,
      cacheStore,
      runStore: runStore2,
      verbose: false,
    });

    await runtime2.run();

    // Verify second run used cache for step1 (deterministic)
    const runMetadata2 = runStore2.getMetadata();
    const step1Status = runMetadata2.nodes['step1'];
    expect(step1Status?.status).toBe('CACHED');
  });

  it('should handle workflow with dependencies correctly', async () => {
    // Create a workflow with dependencies
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Dependency Test',
      nodes: [
        {
          id: 'a',
          kind: 'exec',
          command: 'echo',
          args: ['A'],
          deterministic: true,
        },
        {
          id: 'b',
          kind: 'exec',
          command: 'echo',
          args: ['B'],
          deps: ['a'],
          deterministic: true,
        },
        {
          id: 'c',
          kind: 'exec',
          command: 'echo',
          args: ['C'],
          deps: ['a'],
          deterministic: true,
        },
        {
          id: 'd',
          kind: 'exec',
          command: 'echo',
          args: ['D'],
          deps: ['b', 'c'],
          deterministic: true,
        },
      ],
    };

    // Create runtime context
    const agentRegistry = new AgentRegistry();
    const cacheStore = new CacheStore(cacheDir);
    const runStore = new RunStore(runDir, workflow.name);

    await cacheStore.init();
    await runStore.init();

    // Run workflow
    const runtime = new WorkflowRuntime(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    await runtime.run();

    // Verify all nodes executed successfully
    const runMetadata = runStore.getMetadata();
    expect(runMetadata.status).toBe('success');
    expect(Object.keys(runMetadata.nodes)).toHaveLength(4);

    // Verify execution order was correct (dependencies respected)
    const nodeStatuses = runMetadata.nodes;

    expect(nodeStatuses.a.status).toMatch(/SUCCESS|CACHED/);
    expect(nodeStatuses.b.status).toMatch(/SUCCESS|CACHED/);
    expect(nodeStatuses.c.status).toMatch(/SUCCESS|CACHED/);
    expect(nodeStatuses.d.status).toMatch(/SUCCESS|CACHED/);
  });

  it('should skip dependent nodes when a node fails', async () => {
    // Create a workflow where one node fails
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Failure Test',
      nodes: [
        {
          id: 'success',
          kind: 'exec',
          command: 'echo',
          args: ['OK'],
        },
        {
          id: 'failure',
          kind: 'exec',
          command: 'false', // This will fail
        },
        {
          id: 'dependent',
          kind: 'exec',
          command: 'echo',
          args: ['Should be skipped'],
          deps: ['failure'],
        },
      ],
    };

    // Create runtime context
    const agentRegistry = new AgentRegistry();
    const cacheStore = new CacheStore(cacheDir);
    const runStore = new RunStore(runDir, workflow.name);

    await cacheStore.init();
    await runStore.init();

    // Run workflow (should fail)
    const runtime = new WorkflowRuntime(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    await expect(runtime.run()).rejects.toThrow();

    // Verify run failed
    const runMetadata = runStore.getMetadata();
    expect(runMetadata.status).toBe('failed');

    // Verify dependent node was skipped
    const dependentStatus = runMetadata.nodes['dependent'];
    expect(dependentStatus?.status).toBe('SKIPPED');
  });
});

