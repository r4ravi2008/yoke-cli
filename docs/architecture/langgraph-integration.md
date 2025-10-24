# LangGraph Integration Architecture

**Last Updated**: 2025-10-23  
**Status**: ✅ Implemented (Phase B.1)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Components](#architecture-components)
3. [State Management](#state-management)
4. [Graph Construction](#graph-construction)
5. [Data Flow Between Nodes](#data-flow-between-nodes)
6. [Fan-Out/Fan-In Patterns](#fan-outfan-in-patterns)
7. [Template Resolution](#template-resolution)
8. [Execution Flow](#execution-flow)
9. [Error Handling](#error-handling)
10. [Implementation Details](#implementation-details)

---

## Overview

DagRun uses **LangGraph** (from `@langchain/langgraph` v0.2.0) to orchestrate YAML-defined workflow DAGs. The integration follows LangGraph's state machine pattern with a custom router-based execution model that handles dependency resolution and parallel execution.

### Why LangGraph?

1. **Declarative State Machine**: Provides a clean abstraction for DAG execution
2. **Built-in Checkpointing**: Native support for workflow persistence and resume
3. **State Reducers**: Automatic state merging across parallel paths
4. **Debugging Support**: Built-in state inspection and time-travel capabilities
5. **Production Ready**: Battle-tested framework from LangChain ecosystem

### Key Design Principles

- **Router-Based Execution**: A central router node determines which nodes are ready to execute based on dependencies
- **State Immutability**: State updates are merged, never mutated directly
- **Dependency-Driven**: Node execution order is determined by declared dependencies (`deps`)
- **Parallel-Safe**: Multiple nodes can execute in parallel without state conflicts

---

## Architecture Components

### File Structure

```
src/runtime/graph/
├── state.ts         # State definition with LangGraph Annotation
├── buildGraph.ts    # Graph construction from workflow YAML
├── nodes.ts         # Node handler functions
└── runtime.ts       # Workflow execution orchestration
```

### Component Responsibilities

| Component | Responsibility | Key APIs |
|-----------|---------------|----------|
| `state.ts` | Define state structure and reducers | `RunStateAnnotation`, `createInitialState()` |
| `buildGraph.ts` | Compile YAML workflow to LangGraph StateGraph | `buildGraphFromWorkflow()` |
| `nodes.ts` | Create node handlers for each node type | `createNodeHandler()` |
| `runtime.ts` | Orchestrate workflow execution | `WorkflowRuntime.run()` |

---

## State Management

### State Structure

The workflow state is defined using LangGraph's `Annotation` pattern:

```typescript
export const RunStateAnnotation = Annotation.Root({
  // Workflow variables (from YAML vars section)
  vars: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  // Node outputs indexed by node ID
  outputs: Annotation<Record<string, NodeOutput>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  // Node statuses indexed by node ID
  statuses: Annotation<Record<string, NodeStatus>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  // List of node IDs that are ready to execute
  next: Annotation<string[]>({
    reducer: (left, right) => right, // Replace with new value
    default: () => [],
  }),

  // Error information if a node failed
  failed: Annotation<{nodeId: string; error: string} | null>({
    reducer: (left, right) => right, // Replace with new value
    default: () => null,
  }),
});
```

### State Fields

#### 1. `vars` (Workflow Variables)
- **Type**: `Record<string, unknown>`
- **Source**: YAML `vars` section
- **Reducer**: Merge (spread operator)
- **Usage**: Accessed via `{{ vars.variableName }}` in templates
- **Example**:
  ```yaml
  vars:
    repo_dir: ./my-repo
    timeout: 300
  ```

#### 2. `outputs` (Node Results)
- **Type**: `Record<string, NodeOutput>`
- **Source**: Return value from each node handler
- **Reducer**: Merge by node ID
- **Structure**:
  ```typescript
  interface NodeOutput {
    result: unknown;      // Node's output data
    artifacts: string[];  // Paths to created files
    logs?: string[];      // Execution logs
    hash?: string;        // Cache key
    cached?: boolean;     // Whether from cache
  }
  ```
- **Usage**: Accessed via `{{ outputs.nodeId.result }}` in templates

#### 3. `statuses` (Execution Status)
- **Type**: `Record<string, NodeStatus>`
- **Possible Values**: `PENDING | RUNNING | CACHED | SUCCESS | FAILED | SKIPPED`
- **Reducer**: Merge by node ID
- **Purpose**: Track execution state of each node

#### 4. `next` (Ready Queue)
- **Type**: `string[]`
- **Source**: Router node's dependency analysis
- **Reducer**: Replace (not merge)
- **Purpose**: List of node IDs ready to execute

#### 5. `failed` (Error Information)
- **Type**: `{ nodeId: string; error: string } | null`
- **Source**: Node handler exceptions
- **Reducer**: Replace (not merge)
- **Purpose**: Store failure information for error reporting

### State Reducers

Reducers control how state updates from different nodes are merged:

| Field | Reducer Type | Behavior |
|-------|-------------|----------|
| `vars` | **Merge** | Shallow merge objects |
| `outputs` | **Merge** | Add new outputs without overwriting |
| `statuses` | **Merge** | Update specific node statuses |
| `next` | **Replace** | Set new list of ready nodes |
| `failed` | **Replace** | Set or clear failure information |

**Why different reducers?**
- **Merge**: Allows parallel nodes to update different keys without conflicts
- **Replace**: Router needs full control over execution flow

---

## Graph Construction

### Build Process

The `buildGraphFromWorkflow()` function converts a YAML workflow into a LangGraph StateGraph:

```typescript
export function buildGraphFromWorkflow(
  workflow: WorkflowDefinition,
  ctx: NodeContext
) {
  // 1. Create the state graph
  const graph = new StateGraph(RunStateAnnotation);

  // 2. Add all workflow nodes
  for (const node of workflow.nodes) {
    const handler = createNodeHandler(node, ctx);
    graph.addNode(node.id, handler);
  }

  // 3. Add router node
  graph.addNode('router', async (state: RunState) => {
    // Dependency resolution logic
    // Returns { next: [...], statuses: {...} }
  });

  // 4. Connect START to router
  graph.addEdge(START, 'router' as any);

  // 5. Add conditional edges from router
  graph.addConditionalEdges('router', (state: RunState) => {
    // Return next node to execute or END
  });

  // 6. Connect all nodes back to router
  for (const node of workflow.nodes) {
    graph.addEdge(node.id as any, 'router' as any);
  }

  // 7. Compile and return
  return graph.compile();
}
```

### Graph Structure

```
┌─────────┐
│  START  │
└────┬────┘
     │
     ▼
┌─────────┐
│ router  │◀──┐
└────┬────┘   │
     │        │
     ├────────┼─→ node1 ──┐
     │        │            │
     ├────────┼─→ node2 ──┤
     │        │            ├─→ (all loop back)
     ├────────┼─→ node3 ──┤
     │        │            │
     └────────┼─→ nodeN ──┘
              │
              ▼
         ┌────────┐
         │  END   │
         └────────┘
```

### Router Node Logic

The router node is the heart of dependency resolution:

```typescript
graph.addNode('router', async (state: RunState): Promise<Partial<RunState>> => {
  const ready: string[] = [];
  const completed = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();

  // 1. Categorize nodes by status
  for (const [nodeId, status] of Object.entries(state.statuses)) {
    if (status === 'SUCCESS' || status === 'CACHED') {
      completed.add(nodeId);
    } else if (status === 'FAILED') {
      failed.add(nodeId);
    } else if (status === 'SKIPPED') {
      skipped.add(nodeId);
    }
  }

  // 2. Find nodes that are ready to execute
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

  // 3. Return state update
  return {
    next: ready,
    statuses: statusUpdates,
  };
});
```

**Router Responsibilities:**
1. **Categorize nodes** by their current status
2. **Check dependencies** for each pending node
3. **Mark as SKIPPED** if dependencies failed
4. **Mark as ready** if dependencies completed
5. **Detect deadlocks** (pending nodes with no ready dependencies)

### Conditional Edges

The conditional edges determine which node executes next:

```typescript
graph.addConditionalEdges(
  'router' as any,
  (state: RunState) => {
    // Check if workflow is complete
    const allNodes = workflow.nodes.map((n) => n.id);
    const processedNodes = Object.entries(state.statuses).filter(
      ([_, status]) => status !== 'PENDING' && status !== 'RUNNING'
    );

    if (processedNodes.length === allNodes.length) {
      return END;  // All nodes processed
    }

    if (state.next.length === 0) {
      // Check for deadlock
      const pendingNodes = allNodes.filter(
        (id) => !state.statuses[id] || state.statuses[id] === 'PENDING'
      );

      if (pendingNodes.length > 0) {
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
```

**Decision Logic:**
1. If all nodes are processed → **END**
2. If no nodes are ready but some are pending → **DEADLOCK ERROR**
3. If nodes are ready → **Execute first ready node**

---

## Data Flow Between Nodes

### Overview

Data flows through the LangGraph state using three mechanisms:

1. **State Updates**: Nodes return partial state updates that are merged
2. **Template Resolution**: Nodes access data via Handlebars templates
3. **Output Storage**: Each node's result is stored in `state.outputs[nodeId]`

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────┐
│              LangGraph State                        │
├─────────────────────────────────────────────────────┤
│  vars: { message: "Hello" }                         │
│  outputs: {                                         │
│    step1: {                                         │
│      result: { stdout: "Hello", exitCode: 0 },     │
│      artifacts: []                                  │
│    },                                               │
│    step2: {                                         │
│      result: { stdout: "Previous: Hello" },        │
│      artifacts: []                                  │
│    }                                                │
│  }                                                  │
│  statuses: { step1: "SUCCESS", step2: "SUCCESS" }  │
└─────────────────────────────────────────────────────┘
           ▲                           │
           │ Return partial           │ Pass full state
           │ state update             │ to next node
           │                           ▼
    ┌──────────────┐          ┌──────────────┐
    │   Node 1     │  deps    │   Node 2     │
    │  (step1)     │─────────▶│  (step2)     │
    └──────────────┘          └──────────────┘
    Produces output           Consumes via template:
    { stdout: "Hello" }       {{ outputs.step1.result.stdout }}
```

### Node Output Production

Each node handler returns a **partial state update**:

```typescript
export function createNodeHandler(
  node: NodeDefinition,
  ctx: NodeContext
): (state: RunState) => Promise<Partial<RunState>> {
  return async (state: RunState): Promise<Partial<RunState>> => {
    try {
      // Execute node logic (exec, task, map, reduce)
      let output: NodeOutput = await executeNode(node, state, ctx);

      // Determine status
      const status = output.cached ? 'CACHED' : 'SUCCESS';
      
      // Save to store
      await ctx.runStore.setNodeOutput(nodeId, output);
      await ctx.runStore.setNodeStatus(nodeId, status);

      // Return state update (merged by LangGraph)
      return {
        outputs: { [nodeId]: output },
        statuses: { [nodeId]: status },
      };
    } catch (error) {
      // Handle errors
      return {
        statuses: { [nodeId]: 'FAILED' },
        failed: { nodeId, error: errorMsg },
      };
    }
  };
}
```

**Key Points:**
- Returns **partial state** (only updated fields)
- LangGraph **merges** this with existing state using reducers
- Multiple nodes can update state **in parallel** without conflicts

### Output Structure

```typescript
interface NodeOutput {
  result: unknown;      // The actual output data
  artifacts: string[];  // Files created by this node
  logs?: string[];      // Execution logs
  hash?: string;        // Cache key (for deterministic nodes)
  cached?: boolean;     // Whether loaded from cache
}
```

#### Exec Node Output

```typescript
// Example: echo "Hello" command
{
  result: {
    stdout: "Hello\n",
    stderr: "",
    exitCode: 0
  },
  artifacts: [],
  hash: "abc123...",
  cached: false
}

// Example: Produces JSON file
{
  result: {
    count: 5,
    items: ["apple", "banana", "cherry"]
  },
  artifacts: ["/path/to/output.json"],
  hash: "def456...",
  cached: false
}
```

#### Task Node Output

```typescript
// Example: Agent task
{
  result: {
    analysis: "This function handles user authentication...",
    recommendations: ["Add error handling", "Improve logging"]
  },
  artifacts: ["/path/to/analysis.json"],
  logs: ["Agent started", "Analyzed 150 lines of code"],
  hash: "ghi789...",
  cached: false
}
```

#### Map Node Output

```typescript
// Example: Process 3 files
{
  result: [
    "Result from item 1",
    "Result from item 2",
    "Result from item 3"
  ],
  artifacts: [],
  logs: ["Processed 3 items"],
  cached: false
}
```

---

## Fan-Out/Fan-In Patterns

Fan-out/fan-in occurs at **two levels** in DagRun:

1. **Node-Level Parallelism**: Multiple independent nodes execute after a shared dependency
2. **Map-Level Parallelism**: A single map node processes multiple items in parallel

### Node-Level Fan-Out/Fan-In

#### Pattern

```yaml
nodes:
  - id: generate_data
    kind: exec
    # ... generates [1,2,3,4,5]

  # FAN-OUT: Both depend on generate_data
  - id: square_numbers
    kind: map
    deps: [generate_data]
    # ... squares each number

  - id: cube_numbers
    kind: map
    deps: [generate_data]
    # ... cubes each number

  # FAN-IN: Depends on both branches
  - id: final_report
    kind: exec
    deps: [square_numbers, cube_numbers]
    # ... combines results
```

#### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    INITIAL STATE (t=0)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  vars: { numbers_file: "numbers.json" }                                │
│  outputs: {}                                                            │
│  statuses: { all nodes: PENDING }                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│              AFTER generate_data (t=1)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  outputs: {                                                             │
│    generate_data: { result: [1, 2, 3, 4, 5], ... }                    │
│  }                                                                      │
│  statuses: { generate_data: SUCCESS }                                  │
│  next: ["square_numbers", "cube_numbers"]  ← BOTH READY!              │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
                      ╔═════════════╩═════════════╗
                      ║   FAN-OUT (Node Level)    ║
                      ╚═════════════╤═════════════╝
                ┌──────────────────┴──────────────────┐
                ↓                                      ↓
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  square_numbers (MAP)      ┃        ┃  cube_numbers (MAP)        ┃
┃  over: [1,2,3,4,5]         ┃        ┃  over: [1,2,3,4,5]         ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛        ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
        │                                      │
        │ FAN-OUT (Map Level)                  │ FAN-OUT (Map Level)
        │ 5 items in parallel                  │ 5 items in parallel
        ↓                                      ↓
   ┌─────────┐                            ┌─────────┐
   │ item=1  │ ─┐                         │ item=1  │ ─┐
   │ 1*1=1   │  │                         │ 1³=1    │  │
   └─────────┘  │                         └─────────┘  │
   ┌─────────┐  │                         ┌─────────┐  │
   │ item=2  │  │                         │ item=2  │  │
   │ 2*2=4   │  ├─ Promise.all            │ 2³=8    │  ├─ Promise.all
   └─────────┘  │  (p-limit=5)            └─────────┘  │  (p-limit=5)
   ┌─────────┐  │                         ┌─────────┐  │
   │ item=3  │  │                         │ item=3  │  │
   │ 3*3=9   │  │                         │ 3³=27   │  │
   └─────────┘  │                         └─────────┘  │
   ┌─────────┐  │                         ┌─────────┐  │
   │ item=4  │  │                         │ item=4  │  │
   │ 4*4=16  │  │                         │ 4³=64   │  │
   └─────────┘  │                         └─────────┘  │
   ┌─────────┐  │                         ┌─────────┐  │
   │ item=5  │  │                         │ item=5  │  │
   │ 5*5=25  │ ─┘                         │ 5³=125  │ ─┘
   └─────────┘                            └─────────┘
        │                                      │
        │ FAN-IN (Collect)                     │ FAN-IN (Collect)
        ↓                                      ↓
   [1,4,9,16,25]                          [1,8,27,64,125]
        │                                      │
        └──────────────────┬───────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│           AFTER square_numbers & cube_numbers (t=2)                     │
├─────────────────────────────────────────────────────────────────────────┤
│  outputs: {                                                             │
│    generate_data: { result: [1,2,3,4,5] },                            │
│    square_numbers: { result: [1,4,9,16,25] },                         │
│    cube_numbers: { result: [1,8,27,64,125] }                          │
│  }                                                                      │
│  next: ["final_report"]  ← Single node ready                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
                      ╔═════════════╩═════════════╗
                      ║   FAN-IN (Final)          ║
                      ╚═════════════╤═════════════╝
                                    ↓
                        ┌──────────────────────┐
                        │   final_report       │
                        │   deps: [square_     │
                        │         numbers,     │
                        │         cube_numbers]│
                        │                      │
                        │  Accesses:           │
│                        │  - outputs.square_   │
                        │    numbers.result    │
                        │  - outputs.cube_     │
                        │    numbers.result    │
                        └──────────────────────┘
```

### Map-Level Parallelism

Map nodes use `Promise.all` with `p-limit` for concurrency control:

```typescript
export async function runMap(
  spec: MapNode,
  ctx: MapContext
): Promise<NodeOutput> {
  // Resolve 'over' expression to array
  const items = resolveArray(spec.over, ctx);

  // Create concurrency limiter (default 5)
  const limit = pLimit(5);

  // Process items in parallel
  const results = await Promise.all(
    items.map((item, index) =>
      limit(async () => {
        // Create template engine with 'item' in context
        const itemEngine = createTemplateEngine({
          vars: ctx.vars,
          outputs: ctx.outputs,
          item,  // Current item
        });

        // Resolve and execute map body
        const resolved = itemEngine.renderObject(spec.map);
        const output = await executeMapBody(resolved, ctx);

        return output.result;
      })
    )
  );

  // Return aggregated results
  return {
    result: results,  // Array of all results
    artifacts: [],
    cached: false
  };
}
```

**Key Features:**
- **Parallel execution** via `Promise.all`
- **Concurrency control** via `p-limit(5)`
- **Item context** available as `{{ item }}`
- **Result aggregation** into array

### State Isolation in Parallel Paths

Parallel branches don't conflict because:

1. **Different output keys**: Each node writes to `outputs[nodeId]`
2. **Merge reducers**: State updates are merged, not replaced
3. **Immutable reads**: Nodes only read from state, never mutate

```javascript
// State after parallel execution
{
  outputs: {
    square_numbers: { result: [1,4,9,16,25] },  // Left branch
    cube_numbers: { result: [1,8,27,64,125] }   // Right branch
  }
}
// No conflicts - different keys!
```

---

## Template Resolution

### Template Engine

DagRun uses **Handlebars** for template resolution:

```typescript
export function createTemplateEngine(context: {
  vars: Record<string, unknown>;
  outputs: Record<string, unknown>;
  item?: unknown;  // For map nodes
}) {
  const handlebars = Handlebars.create();

  // Register helpers
  handlebars.registerHelper('basename', (filepath: string) => path.basename(filepath));
  handlebars.registerHelper('dirname', (filepath: string) => path.dirname(filepath));
  handlebars.registerHelper('join', (arr: unknown[], sep = ',') => arr.join(sep));
  handlebars.registerHelper('json', (obj: unknown) => JSON.stringify(obj));
  handlebars.registerHelper('loads_file', (filepath: string) => {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  });

  return {
    render: (template: string) => handlebars.compile(template)(context),
    renderObject: <T>(obj: T) => renderRecursive(obj, context, handlebars)
  };
}
```

### Template Syntax

#### Accessing Variables

```yaml
# YAML
vars:
  repo_dir: ./my-repo
  timeout: 300

nodes:
  - id: clone
    command: git
    args: ["clone", "https://...", "{{ vars.repo_dir }}"]
```

**Resolution:**
```javascript
// Context: { vars: { repo_dir: './my-repo' } }
"{{ vars.repo_dir }}"  →  "./my-repo"
```

#### Accessing Node Outputs

```yaml
nodes:
  - id: step1
    kind: exec
    command: echo
    args: ["Hello"]

  - id: step2
    deps: [step1]
    command: echo
    args: ["Output was: {{ outputs.step1.result.stdout }}"]
```

**Resolution:**
```javascript
// Context: { outputs: { step1: { result: { stdout: "Hello\n" } } } }
"{{ outputs.step1.result.stdout }}"  →  "Hello\n"
```

#### Accessing Map Items

```yaml
nodes:
  - id: process_files
    kind: map
    over: "{{ outputs.list_files.result }}"
    map:
      kind: exec
      command: wc
      args: ["-l", "{{ item }}"]
```

**Resolution:**
```javascript
// Context: { item: "file1.txt" }
"{{ item }}"  →  "file1.txt"
```

### Template Helpers

| Helper | Usage | Example |
|--------|-------|---------|
| `basename` | Get filename | `{{ basename item }}` → `file.txt` |
| `dirname` | Get directory | `{{ dirname item }}` → `/path/to` |
| `join` | Join array | `{{ join items "," }}` → `a,b,c` |
| `json` | JSON stringify | `{{ json outputs.step1.result }}` → `{"key":"val"}` |
| `loads_file` | Load JSON file | `{{ loads_file "data.json" }}` → object |

### Resolution Timing

Templates are resolved **before node execution**:

```typescript
// In createNodeHandler()
const templateEngine = createTemplateEngine({
  vars: state.vars,
  outputs: state.outputs,
});

// Resolve all templates in node definition
const resolvedNode = templateEngine.renderObject(node);

// Now execute with resolved values
await executeNode(resolvedNode, ctx);
```

**Why?**
- **Type safety**: After resolution, node has concrete values
- **Error handling**: Template errors caught before execution
- **Debugging**: Can log resolved values

---

## Execution Flow

### Complete Workflow Execution

```
1. LOAD WORKFLOW
   ↓
2. VALIDATE SCHEMA
   ↓
3. CREATE INITIAL STATE
   └─> vars: { from YAML }
   └─> outputs: {}
   └─> statuses: { all: PENDING }
   ↓
4. BUILD LANGGRAPH
   └─> Add nodes (one per workflow node)
   └─> Add router node
   └─> Connect edges
   └─> Compile graph
   ↓
5. INVOKE GRAPH
   ↓
┌─────────────────────┐
│  EXECUTION LOOP     │
├─────────────────────┤
│  ┌──────────────┐   │
│  │   ROUTER     │   │
│  │  - Check     │   │
│  │    deps      │   │
│  │  - Find      │   │
│  │    ready     │   │
│  │    nodes     │   │
│  └──────┬───────┘   │
│         │           │
│         ▼           │
│  ┌──────────────┐   │
│  │ EXECUTE NODE │   │
│  │  - Resolve   │   │
│  │    templates │   │
│  │  - Run step  │   │
│  │  - Update    │   │
│  │    state     │   │
│  └──────┬───────┘   │
│         │           │
│         ▼           │
│  ┌──────────────┐   │
│  │   ROUTER     │   │
│  │  (repeat)    │   │
│  └──────────────┘   │
│         │           │
│         ▼           │
│   All nodes done?   │
│    Yes → END        │
│    No → Continue    │
└─────────────────────┘
   ↓
6. FINAL STATE
   └─> outputs: { all node results }
   └─> statuses: { all SUCCESS/FAILED/CACHED }
   ↓
7. RETURN RESULT
```

### Execution Example

Given this workflow:

```yaml
nodes:
  - id: step1
    kind: exec
    command: echo
    args: ["Hello"]

  - id: step2
    deps: [step1]
    kind: exec
    command: echo
    args: ["{{ outputs.step1.result.stdout }}"]

  - id: step3
    deps: [step1]
    kind: exec
    command: echo
    args: ["World"]

  - id: step4
    deps: [step2, step3]
    kind: exec
    command: echo
    args: ["Done"]
```

**Execution Timeline:**

| Time | Action | State Updates |
|------|--------|---------------|
| t=0 | Initialize | statuses: all PENDING |
| t=1 | Router | next: [step1] |
| t=2 | Execute step1 | outputs: {step1: {...}}, statuses: {step1: SUCCESS} |
| t=3 | Router | next: [step2, step3] (both ready!) |
| t=4 | Execute step2 | outputs: {step1, step2}, statuses: {step1: SUCCESS, step2: SUCCESS} |
| t=5 | Execute step3 | outputs: {step1, step2, step3}, statuses: {..., step3: SUCCESS} |
| t=6 | Router | next: [step4] |
| t=7 | Execute step4 | outputs: {all}, statuses: {all: SUCCESS} |
| t=8 | Router | All done → END |

**Note:** Currently executes nodes sequentially (one from `next` array), but architecture supports parallel execution.

---

## Error Handling

### Node Failure

When a node fails:

```typescript
try {
  const output = await executeNode(node, state, ctx);
  return {
    outputs: { [nodeId]: output },
    statuses: { [nodeId]: 'SUCCESS' },
  };
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  
  // Save error to store
  await ctx.runStore.setNodeError(nodeId, errorMsg);
  await ctx.runStore.setNodeStatus(nodeId, 'FAILED');

  // Return failure state
  return {
    statuses: { [nodeId]: 'FAILED' },
    failed: { nodeId, error: errorMsg },
  };
}
```

### Dependency Skipping

Router automatically skips dependent nodes:

```typescript
// In router node
const deps = node.deps || [];
const anyDepFailed = deps.some((dep) => 
  failed.has(dep) || skipped.has(dep)
);

if (anyDepFailed) {
  // Mark as skipped if any dependency failed
  statusUpdates[nodeId] = 'SKIPPED';
  await ctx.runStore.setNodeStatus(nodeId, 'SKIPPED');
}
```

**Example:**
```
step1 → FAILED
  ↓
step2 (deps: [step1]) → SKIPPED (automatically)
  ↓
step3 (deps: [step2]) → SKIPPED (automatically)
```

### Deadlock Detection

Router detects deadlocks:

```typescript
if (state.next.length === 0) {
  // No nodes ready
  const pendingNodes = allNodes.filter(
    (id) => state.statuses[id] === 'PENDING'
  );

  if (pendingNodes.length > 0) {
    // Deadlock: nodes pending but none ready
    throw new Error(
      `Workflow deadlock detected. Nodes still pending but none are ready: ${pendingNodes.join(', ')}`
    );
  }
}
```

**Causes:**
- Circular dependencies (should be caught by validation)
- Missing dependencies (typo in `deps`)
- Logic error in custom router logic

### Error Reporting

Final error check in runtime:

```typescript
// Check for failures
if (finalState.failed) {
  await ctx.runStore.complete('failed');
  const skippedCount = Object.values(finalState.statuses).filter(
    (s) => s === 'SKIPPED'
  ).length;
  throw new Error(
    `Workflow failed: ${finalState.failed.nodeId} failed: ${finalState.failed.error} (${skippedCount} skipped)`
  );
}
```

---

## Implementation Details

### Key Files

#### `src/runtime/graph/state.ts`

Defines state structure using LangGraph Annotations.

**Key Functions:**
- `RunStateAnnotation` - State definition with reducers
- `createInitialState()` - Initialize state from vars

#### `src/runtime/graph/buildGraph.ts`

Compiles YAML workflow to LangGraph StateGraph.

**Key Functions:**
- `buildGraphFromWorkflow()` - Main graph builder
- Router node handler (inline)
- Conditional edge function (inline)

#### `src/runtime/graph/nodes.ts`

Creates node handler functions.

**Key Functions:**
- `createNodeHandler()` - Returns handler for any node type
- Handles exec, task, map, reduce nodes
- Template resolution
- Error handling

#### `src/runtime/graph/runtime.ts`

Orchestrates workflow execution.

**Key Functions:**
- `WorkflowRuntime.run()` - Main execution method
- Initializes state
- Builds graph
- Invokes graph
- Handles results

### Integration Points

#### With Step Implementations

Node handlers delegate to step implementations:

```typescript
if (node.kind === 'exec') {
  output = await runExec(resolvedNode, ctx);
} else if (node.kind === 'task') {
  output = await runTask(agent, resolvedNode, ctx);
} else if (node.kind === 'map') {
  output = await runMap(node, ctx);
} else if (node.kind === 'reduce') {
  output = await runReduce(node, ctx);
}
```

#### With Stores

All operations persist to stores:

```typescript
// Before execution
await ctx.runStore.setNodeStatus(nodeId, 'RUNNING');

// After success
await ctx.runStore.setNodeOutput(nodeId, output);
await ctx.runStore.setNodeStatus(nodeId, status);

// After failure
await ctx.runStore.setNodeError(nodeId, errorMsg);
await ctx.runStore.setNodeStatus(nodeId, 'FAILED');
```

#### With Templating

Templates resolved before execution:

```typescript
const templateEngine = createTemplateEngine({
  vars: state.vars,
  outputs: state.outputs,
});

const resolvedNode = templateEngine.renderObject(node);
```

### Performance Considerations

1. **State Size**: State grows with number of nodes and output size
   - Mitigation: Only store necessary data in outputs
   - Future: Implement output pruning for large workflows

2. **Template Resolution**: Happens for every node execution
   - Mitigation: Handlebars compilation is cached
   - Future: Pre-compile templates during graph building

3. **Router Complexity**: O(N) where N = number of nodes
   - Mitigation: Set operations for fast lookups
   - Future: Index dependencies for O(1) lookups

4. **Map Parallelism**: Limited to 5 concurrent items by default
   - Configuration: Can be adjusted per-map or globally
   - Future: Dynamic concurrency based on system resources

---

## See Also

- [Design Document](./design.md) - Original design specification
- [State Flow Guide](../guides/state-flow.md) - User-focused guide on data flow
- [Resume Implementation](../planning/resume-implementation-plan.md) - Checkpointing details
- [Testing Strategy](../planning/implementation-plan.md) - Test coverage

---

**Document Status**: Complete  
**Last Review**: 2025-10-23  
**Next Review**: After Phase B.2 (Resume) completion
