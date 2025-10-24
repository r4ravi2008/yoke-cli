import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { buildGraphFromWorkflow } from '../../src/runtime/graph/buildGraph';
import { WorkflowDefinition } from '../../src/schema/types';
import { AgentRegistry } from '../../src/runtime/agents/registry';
import { CacheStore } from '../../src/runtime/store/cache-store';
import { RunStore } from '../../src/runtime/store/run-store';
import { createInitialState } from '../../src/runtime/graph/state';
import path from 'path';
import { promises as fs } from 'fs';

describe('buildGraphFromWorkflow', () => {
  let testDir: string;
  let cacheDir: string;
  let runDir: string;
  let agentRegistry: AgentRegistry;
  let cacheStore: CacheStore;
  let runStore: RunStore;

  beforeEach(async () => {
    testDir = path.join(__dirname, '..', '..', '.test-runs', `test-${Date.now()}`);
    cacheDir = path.join(testDir, 'cache');
    runDir = path.join(testDir, 'run');
    
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(runDir, { recursive: true });

    agentRegistry = new AgentRegistry();
    cacheStore = new CacheStore(cacheDir);
    runStore = new RunStore(runDir, 'test');

    await cacheStore.init();
    await runStore.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should build a graph from a simple workflow', () => {
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Simple Test',
      nodes: [
        {
          id: 'node1',
          kind: 'exec',
          command: 'echo',
          args: ['test'],
        },
      ],
    };

    const graph = buildGraphFromWorkflow(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
  });

  it('should build a graph with multiple nodes', () => {
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Multi-Node Test',
      nodes: [
        {
          id: 'node1',
          kind: 'exec',
          command: 'echo',
          args: ['1'],
        },
        {
          id: 'node2',
          kind: 'exec',
          command: 'echo',
          args: ['2'],
          deps: ['node1'],
        },
        {
          id: 'node3',
          kind: 'exec',
          command: 'echo',
          args: ['3'],
          deps: ['node1'],
        },
      ],
    };

    const graph = buildGraphFromWorkflow(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    expect(graph).toBeDefined();
  });

  it('should execute a simple workflow through the graph', async () => {
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Execution Test',
      nodes: [
        {
          id: 'test_node',
          kind: 'exec',
          command: 'echo',
          args: ['hello'],
          deterministic: true,
        },
      ],
    };

    const graph = buildGraphFromWorkflow(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    const initialState = createInitialState();
    initialState.statuses = { test_node: 'PENDING' };

    const result = await graph.invoke(initialState);

    expect(result.statuses.test_node).toMatch(/SUCCESS|CACHED/);
    expect(result.outputs.test_node).toBeDefined();
    expect(result.outputs.test_node.result).toBeDefined();
  });

  it('should handle dependencies correctly', async () => {
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Dependency Test',
      nodes: [
        {
          id: 'first',
          kind: 'exec',
          command: 'echo',
          args: ['first'],
          deterministic: true,
        },
        {
          id: 'second',
          kind: 'exec',
          command: 'echo',
          args: ['second'],
          deps: ['first'],
          deterministic: true,
        },
      ],
    };

    const graph = buildGraphFromWorkflow(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    const initialState = createInitialState();
    initialState.statuses = { first: 'PENDING', second: 'PENDING' };

    const result = await graph.invoke(initialState);

    // Both nodes should complete successfully
    expect(result.statuses.first).toMatch(/SUCCESS|CACHED/);
    expect(result.statuses.second).toMatch(/SUCCESS|CACHED/);
  });

  it('should skip dependent nodes when a node fails', async () => {
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Failure Test',
      nodes: [
        {
          id: 'failing',
          kind: 'exec',
          command: 'false', // This command will fail
        },
        {
          id: 'dependent',
          kind: 'exec',
          command: 'echo',
          args: ['should not run'],
          deps: ['failing'],
        },
      ],
    };

    const graph = buildGraphFromWorkflow(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    const initialState = createInitialState();
    initialState.statuses = { failing: 'PENDING', dependent: 'PENDING' };

    const result = await graph.invoke(initialState);

    // Failing node should fail
    expect(result.statuses.failing).toBe('FAILED');
    
    // Dependent node should be skipped
    expect(result.statuses.dependent).toBe('SKIPPED');
  });

  it('should handle parallel execution', async () => {
    const workflow: WorkflowDefinition = {
      version: 1,
      name: 'Parallel Test',
      nodes: [
        {
          id: 'parallel1',
          kind: 'exec',
          command: 'echo',
          args: ['1'],
          deterministic: true,
        },
        {
          id: 'parallel2',
          kind: 'exec',
          command: 'echo',
          args: ['2'],
          deterministic: true,
        },
        {
          id: 'parallel3',
          kind: 'exec',
          command: 'echo',
          args: ['3'],
          deterministic: true,
        },
      ],
    };

    const graph = buildGraphFromWorkflow(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    const initialState = createInitialState();
    initialState.statuses = {
      parallel1: 'PENDING',
      parallel2: 'PENDING',
      parallel3: 'PENDING',
    };

    const result = await graph.invoke(initialState);

    // All nodes should complete successfully
    expect(result.statuses.parallel1).toMatch(/SUCCESS|CACHED/);
    expect(result.statuses.parallel2).toMatch(/SUCCESS|CACHED/);
    expect(result.statuses.parallel3).toMatch(/SUCCESS|CACHED/);
  });
});

