Overview

Goal: YAML-driven workflow runner that compiles a DAG to a LangGraph state machine and executes steps sequentially or in parallel.

Step types:

task (agent-driven), 2) map (fan-out), 3) reduce (fan-in), 4) exec (deterministic shell/command).

Determinism: exec steps (and any step flagged deterministic: true) use input hashing + output verification and a local content-addressable cache.

Data passing: outputs saved as structured JSON + artifacts; later steps can template prior outputs.

CLI: dagrun run workflow.yaml, with options for concurrency, resume, dry-run, and selective node execution.

Checkpointing: All workflow runs automatically save checkpoints to SQLite database for resume capability.

CLI UX

# Run a workflow (checkpoints saved automatically)

dagrun run ./workflow.yaml --concurrency 6 --out ./.runs/2025-10-22_15-03

# Resume a failed workflow

dagrun run ./workflow.yaml --resume --out ./.runs/2025-10-22_15-03

# Target a subset (future)

dagrun run ./workflow.yaml --only prep,fanout --since-cache

# Validate only

dagrun validate ./workflow.yaml

# Inspect last run

dagrun show --run ./runs/2025-10-22_15-03/run.json

# Dry-run (resolve templates, build DAG, but do not execute external effects)

dagrun plan ./workflow.yaml

YAML schema (v1)
version: 1
name: Example Workflow
concurrency: 6
vars:
repo_dir: ./repo

nodes:

- id: prep
  kind: exec
  name: Clone repo
  command: git
  args: ["clone", "https://github.com/org/repo.git", "{{ vars.repo_dir }}"]
  cwd: "."
  env: {}
  timeout: 600000
  retries: 2
  deterministic: true
  produces: # optional deterministic outputs check
  files: - path: "{{ vars.repo_dir }}/.git/HEAD"
  json: {} # for exec, leave empty (non-JSON)

- id: files
  kind: exec
  name: List top TS files
  deps: [prep]
  command: bash
  args:

  - -lc
  - |
    cd {{ vars.repo_dir }}
    git ls-files "\*.ts" | xargs wc -l | sort -nr | head -n 5 | awk '{print $2}' > top.txt
        jq -Rn '[inputs]' --slurpfile a top.txt '$a[0]' > top.json
    produces:
    files: ["{{ vars.repo_dir }}/top.json"]
    json:
    resultFromFile: "{{ vars.repo_dir }}/top.json" # loader hint
    timeout: 300000
    deterministic: true

- id: fanout
  kind: map
  name: Analyze files
  deps: [files]
  over: "{{ loads_file(vars.repo_dir ~ '/top.json') }}" # returns array
  map:
  kind: task
  agent: cursor
  prompt: |
  For file {{ item }}, summarize purpose, exported APIs, and risks.
  inputs:
  filepath: "{{ item }}"
  artifacts: ["analyses/{{ basename item }}.json"]
  timeout: 300000
  retries: 1

- id: combine
  kind: reduce
  name: Aggregate analyses
  deps: [fanout]
  reduce:
  kind: task
  agent: cloud_code
  prompt: |
  Combine {{ inputs.items|length }} analyses into a prioritized refactor plan.
  inputs:
  items: "{{ outputs.fanout.result }}"
  artifacts: ["refactor_plan.md"]
  timeout: 300000

Notes

Templating: Handlebars-style {{ ... }} plus a few helpers (basename, loads_file, join, json, etc.).

Determinism: exec steps are deterministic by default; any step can set deterministic: true to enable caching/verification.

Artifacts: file paths written by the step. produces.json.resultFromFile lets the runner load structured output deterministically.

Architecture
packages/
dagrun/
src/
cli/ # commander commands
schema/ # JSON Schema + AJV validator
templating/ # handlebars + helpers
runtime/
graph/ # build LangGraph & nodes
store/ # run store, cache, logs
agents/ # agent adapters (cursor, augie, cloud_code)
steps/ # exec, task, map, reduce implementations
io/ # artifact I/O, sandboxing
util/
index.ts
test/
e2e/ unit/

Key modules

schema/: AJV-compiled JSON Schema for fast validation + helpful errors.

templating/: Handlebars instance with helpers resolving vars, outputs, files, path ops, JSON encode/decode.

runtime/store/:

RunStore: persist run.json, node status, timings, outputs, thread ID for checkpointing.

CacheStore: content-addressable store keyed by input hash (inputs + prompt + env + command + deps digests).

Checkpointer: LangGraph SqliteSaver for automatic state persistence and resume. Stored in `<run-dir>/checkpoints.db`.

runtime/agents/: common Agent interface and adapters (Cursor CLI, Augie, Cloud Code). Each adapter runs the tool/CLI or API and returns { result, logs, createdArtifacts }.

runtime/steps/:

execStep: deterministic command runner (Node child_process), stdout capture, file hashing, exit code handling.

taskStep: agent-driven execution.

mapStep: evaluate over -> spawn N identical task bodies concurrently with per-item inputs.

reduceStep: aggregate array -> single result (often another task or exec).

runtime/graph/:

buildGraphFromYaml() → constructs LangGraph StateGraph, nodes, conditional edges, and entry/exit wiring based on deps.

State model (LangGraph)
// src/runtime/graph/state.ts
export type NodeStatus = 'PENDING' | 'RUNNING' | 'CACHED' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface NodeOutput {
result: unknown;
artifacts: string[];
logs?: string[];
hash?: string; // input hash used for cache
}

export interface RunState {
vars: Record<string, unknown>;
outputs: Record<string, NodeOutput>;
statuses: Record<string, NodeStatus>;
next: string[]; // nodes that are now eligible
failed?: { nodeId: string; error: string } | null;
}

LangGraph design

We compile the YAML DAG to a LangGraph StateGraph:

Nodes: each YAML node becomes a LangGraph node with a handler (execNode, taskNode, mapNode, reduceNode).

Edges: deps → edges. Nodes with no deps connect from START. Nodes with no dependents connect to END.

Parallelism: LangGraph will schedule independent nodes; each node handler avoids blocking and uses async concurrency (e.g., Promise.all in map).

Checkpoints/Resume: LangGraph provides built-in checkpointing for workflow persistence and resume capabilities.

## Checkpointing & Resume

DagRun leverages LangGraph's native checkpointing system for workflow persistence and resume functionality. This is a first-class feature that enables fault-tolerance, human-in-the-loop workflows, and time travel debugging.

### How It Works

1. **Checkpointer Setup**: Initialize a SqliteSaver checkpointer with a database path
   ```typescript
   import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

   const checkpointer = SqliteSaver.fromConnString('./run-dir/checkpoints.db');
   await checkpointer.setup();
   ```

2. **Graph Compilation**: Pass checkpointer to graph.compile()
   ```typescript
   const graph = buildGraphFromWorkflow(workflow, ctx, checkpointer);
   // Internally: graph.compile({ checkpointer })
   ```

3. **Execution with Thread ID**: Invoke graph with a unique thread_id
   ```typescript
   await graph.invoke(initialState, {
     configurable: { thread_id: 'run-abc123' }
   });
   ```

   LangGraph automatically:
   - Saves state after each super-step
   - Associates checkpoints with the thread_id
   - Persists to SQLite database

4. **Resume**: Re-invoke with same thread_id and null initial state
   ```typescript
   await graph.invoke(null, {  // null = load from checkpoint
     configurable: { thread_id: 'run-abc123' }
   });
   ```

   LangGraph automatically:
   - Loads last checkpoint for thread_id
   - Skips completed nodes
   - Continues from failure point
   - Saves new checkpoints as execution progresses

### Thread ID Strategy

- **Unique per run**: Each workflow run gets a unique thread_id (e.g., `run-1729701234-x7k9m2p`)
- **Stored in run.json**: Thread ID is persisted in run metadata for resume
- **Namespace**: Allows multiple runs to coexist in same checkpoint database
- **Immutable**: Thread ID never changes for a given run

### Checkpoint Storage

- **Location**: `<run-dir>/checkpoints.db` (SQLite database)
- **Format**: LangGraph's internal checkpoint format (serialized state)
- **Persistence**: Checkpoints remain after workflow completion for debugging/time-travel
- **Size**: ~1KB per checkpoint (incremental state changes only)

### Resume Workflow

```bash
# Initial run (fails at step 2)
dagrun run workflow.yaml --out .runs/my-run

# Resume from failure
dagrun run workflow.yaml --resume --out .runs/my-run
```

The resume process:
1. Loads run.json to get thread_id
2. Initializes checkpointer with existing checkpoints.db
3. Compiles graph with checkpointer
4. Invokes with thread_id and null state
5. LangGraph loads checkpoint and continues execution

### State Inspection (Bonus Features)

LangGraph provides additional capabilities beyond basic resume:

**Get Current State**:
```typescript
const state = await graph.getState({ configurable: { thread_id } });
console.log(state.values);    // Current state
console.log(state.next);      // Next nodes to execute
console.log(state.tasks);     // Pending tasks
```

**View State History**:
```typescript
for await (const state of graph.getStateHistory({ configurable: { thread_id } })) {
  console.log(state.values);  // Historical checkpoints
}
```

**Resume from Specific Checkpoint** (Time Travel):
```typescript
await graph.invoke(null, {
  configurable: {
    thread_id: 'run-abc123',
    checkpoint_id: '1ef663ba-28fe-6528-8002-5a559208592c'
  }
});
```

### Implementation Details

See [`docs/resume-implementation-plan.md`](./resume-implementation-plan.md) for complete implementation details.

Deterministic steps

Deterministic inputs: serialize { kind, command/agent, args, env, cwd, prompt, inputs, depsDigests } and hash (SHA-256).

Cache hit: if CacheStore has a record for hash, return cached { result, artifacts } and mark status CACHED.

Verification: if produces.files declared, verify they exist (and optionally hash) post-run; if resultFromFile declared, parse it to result.

Purity guard: when --since-cache is used, skip steps whose deps’ digests didn’t change.

Implementation plan (phased)

Phase 1 — Foundations (week 1)

Project skeleton, CLI (commander), AJV validation, templating helpers.

RunStore, CacheStore (filesystem), logging, error types.

exec step end-to-end (deterministic, caching, verification).

Minimal graph build; run linear workflows.

Phase 2 — DAG + parallelism (week 2)

Full deps compilation to LangGraph; START/END wiring.

Parallel eligible nodes; global --concurrency with a token-bucket limiter.

Basic retries/backoff, timeouts, graceful cancel.

Phase 3 — Agents + fan-out/fan-in (week 3)

Agent interface + Cursor/Augie/Cloud Code adapters.

task step; map and reduce steps (fan-out/fan-in).

Artifact management; run manifest (run.json) + JSONL log.

Phase 4 — Ops polish (week 4)

Resume with checkpointer (SQLite) - ✅ **IMPLEMENTED** using LangGraph's native SqliteSaver.

TUI progress, dagrun show, plan, validate.

Unit + e2e tests; example workflows; README.

Core types & code sketches

These are production-ready patterns with trimmed details for brevity.

1. Agent interfaces
   // src/runtime/agents/types.ts
   export interface AgentContext {
   prompt: string;
   inputs: Record<string, unknown>;
   env: Record<string, string>;
   cwd: string;
   writeArtifact: (relPath: string, data: Buffer | string) => Promise<string>;
   timeoutMs: number;
   log: (msg: string) => void;
   }

export interface AgentResult {
result: unknown;
logs?: string[];
createdArtifacts?: string[];
}

export interface Agent {
name: string;
run(ctx: AgentContext): Promise<AgentResult>;
}

2. Exec (deterministic) step
   // src/runtime/steps/exec.ts
   import { spawn } from "child_process";
   import { createHash } from "crypto";
   import { promises as fs } from "fs";
   import path from "path";

export interface ExecSpec {
command: string;
args?: string[];
cwd?: string;
env?: Record<string, string>;
timeout?: number;
produces?: {
files?: string[];
json?: { resultFromFile?: string };
};
deterministic?: boolean;
}

export function hashInputs(payload: unknown) {
const h = createHash("sha256");
h.update(JSON.stringify(payload));
return h.digest("hex");
}

export async function runExec(spec: ExecSpec, ctx: {
vars: Record<string, unknown>;
resolved: ExecSpec; // already templated
cacheGet: (key: string) => Promise<null | { result: unknown; artifacts: string[] }>;
cachePut: (key: string, val: { result: unknown; artifacts: string[] }) => Promise<void>;
outDir: string;
log: (m: string) => void;
}) {
const key = hashInputs({
kind: "exec",
command: spec.command,
args: spec.args,
cwd: spec.cwd,
env: spec.env,
produces: spec.produces,
});

if (spec.deterministic) {
const hit = await ctx.cacheGet(key);
if (hit) return { ...hit, hash: key, cached: true as const };
}

const { command, args = [], cwd = process.cwd(), env = {} } = ctx.resolved;
const child = spawn(command, args, {
cwd,
env: { ...process.env, ...env },
stdio: ["ignore", "pipe", "pipe"],
shell: false,
});

const stdout: Buffer[] = [];
const stderr: Buffer[] = [];
child.stdout.on("data", (d) => stdout.push(Buffer.from(d)));
child.stderr.on("data", (d) => stderr.push(Buffer.from(d)));

const exitCode = await new Promise<number>((res, rej) => {
let timeoutId: NodeJS.Timeout | null = null;
if (spec.timeout && spec.timeout > 0) {
timeoutId = setTimeout(() => {
child.kill("SIGKILL");
rej(new Error(`exec timeout after ${spec.timeout}ms`));
}, spec.timeout);
}
child.on("error", rej);
child.on("close", (code) => {
if (timeoutId) clearTimeout(timeoutId);
res(code ?? -1);
});
});

if (exitCode !== 0) {
throw new Error(`exec failed (${exitCode}): ${command} ${args.join(" ")}\n${Buffer.concat(stderr).toString()}`);
}

// Determine outputs
const artifacts: string[] = [];
if (spec.produces?.files?.length) {
for (const f of spec.produces.files) {
const p = path.resolve(f);
await fs.access(p); // verify existence
artifacts.push(p);
}
}

let result: unknown = { stdout: Buffer.concat(stdout).toString().trim() };
if (spec.produces?.json?.resultFromFile) {
const p = path.resolve(spec.produces.json.resultFromFile);
const text = await fs.readFile(p, "utf8");
result = JSON.parse(text);
}

if (spec.deterministic) {
await ctx.cachePut(key, { result, artifacts });
}
return { result, artifacts, hash: key, cached: false as const };
}

3. Task (agent) step
   // src/runtime/steps/task.ts
   import type { Agent } from "../agents/types";

export async function runTask(
agent: Agent,
spec: {
prompt: string;
inputs: Record<string, unknown>;
env?: Record<string, string>;
artifacts?: string[];
cwd?: string;
timeout?: number;
deterministic?: boolean;
cacheKey?: string; // optional for deterministic agent runs
},
ctx: {
cacheGet: (key: string) => Promise<null | { result: unknown; artifacts: string[] }>;
cachePut: (key: string, val: { result: unknown; artifacts: string[] }) => Promise<void>;
writeArtifact: (rel: string, data: Buffer | string) => Promise<string>;
log: (m: string) => void;
}
) {
if (spec.deterministic && spec.cacheKey) {
const hit = await ctx.cacheGet(spec.cacheKey);
if (hit) return { ...hit, hash: spec.cacheKey, cached: true as const };
}

const res = await agent.run({
prompt: spec.prompt,
inputs: spec.inputs,
env: spec.env ?? {},
cwd: spec.cwd ?? process.cwd(),
timeoutMs: spec.timeout ?? 300000,
writeArtifact: ctx.writeArtifact,
log: ctx.log,
});

const artifacts = res.createdArtifacts ?? [];
if (spec.deterministic && spec.cacheKey) {
await ctx.cachePut(spec.cacheKey, { result: res.result, artifacts });
}
return { result: res.result, artifacts, hash: spec.cacheKey, cached: false as const };
}

4. Map/Reduce nodes

Map: resolve over → array; for each item, expand the step body (task/exec) and run under Promise.all with a per-map concurrency limit; collect array of results.

Reduce: single task/exec that consumes the collected array.

(Implementation fits in ~60–80 LOC leveraging runTask/runExec + a limiter like p-limit.)

5. Build the LangGraph
   // src/runtime/graph/buildGraph.ts
   import { StateGraph, START, END } from "@langchain/langgraph";
   import type { RunState } from "./state";
   import { execNode, taskNode, mapNode, reduceNode } from "./nodes";

export function buildGraphFromYaml(model: ParsedWorkflow) {
const g = new StateGraph<RunState>({
channels: {
vars: null,
outputs: null,
statuses: null,
next: null,
failed: null,
},
});

// Add nodes
for (const n of model.nodes) {
const handler =
n.kind === "exec" ? execNode(n) :
n.kind === "task" ? taskNode(n) :
n.kind === "map" ? mapNode(n) :
n.kind === "reduce" ? reduceNode(n) :
(() => { throw new Error(`Unknown kind ${n.kind}`) })();

    g.addNode(n.id, handler);

}

// Add edges
const byId = new Map(model.nodes.map(n => [n.id, n]));
for (const n of model.nodes) {
if (!n.deps || n.deps.length === 0) g.addEdge(START, n.id);
for (const d of (n.deps ?? [])) g.addEdge(d, n.id);
}

// Any sinks → END
const dependents = new Map<string, number>();
model.nodes.forEach(n => n.deps?.forEach(d => dependents.set(d, (dependents.get(d) ?? 0) + 1)));
model.nodes.filter(n => !dependents.has(n.id)).forEach(n => g.addEdge(n.id, END));

return g.compile({ checkpointer: model.options.checkpointer });
}

6. Node handlers (example: exec)
   // src/runtime/graph/nodes.ts
   import type { RunState } from "./state";
   import { runExec } from "../steps/exec";
   import { render } from "../../templating/render";
   import { withRetries } from "../util/retry";

export const execNode = (node: ExecYamlNode) => async (state: RunState): Promise<RunState> => {
const resolved = {
...node,
command: render(node.command, state),
args: (node.args ?? []).map(a => render(a, state)),
cwd: render(node.cwd ?? ".", state),
// env values templated too
};

const start = Date.now();
try {
const { result, artifacts, hash, cached } = await withRetries(node.retries ?? 0, node.retry_backoff ?? 500)(
() => runExec(node, {
vars: state.vars,
resolved,
cacheGet: (k) => state.cache?.get(k) ?? Promise.resolve(null), // wrapper to actual cache store
cachePut: (k, v) => state.cache?.put(k, v) ?? Promise.resolve(),
outDir: state.runOutDir,
log: (m) => state.logger(node.id, m),
})
);

    state.outputs[node.id] = { result, artifacts, hash, logs: [], };
    state.statuses[node.id] = cached ? "CACHED" : "SUCCESS";

} catch (e: any) {
state.statuses[node.id] = "FAILED";
state.failed = { nodeId: node.id, error: String(e.message ?? e) };
throw e;
}
state.metrics?.push({ nodeId: node.id, ms: Date.now() - start });
return state;
};

(Handlers for taskNode, mapNode, and reduceNode follow the same pattern, delegating to runTask and coordinating arrays.)

CLI wiring
// src/cli/run.ts
import { Command } from "commander";
import { loadWorkflow } from "../schema/load";
import { buildGraphFromYaml } from "../runtime/graph/buildGraph";
import { createRunContext } from "../runtime/store/runContext";

export const runCmd = new Command("run")
.argument("<file>", "workflow YAML")
.option("--concurrency <n>", "global max concurrency", "6")
.option("--out <dir>", "output dir", "./.runs/last")
.option("--resume", "resume from checkpoint", false)
.option("--only <ids>", "comma-separated node ids to run")
.option("--since-cache", "skip if cache unchanged", false)
.action(async (file, opts) => {
const wf = await loadWorkflow(file); // validate + parse + defaulting
const ctx = await createRunContext({ outDir: opts.out, concurrency: +opts.concurrency, resume: opts.resume, sinceCache: opts.sinceCache });
const app = buildGraphFromYaml(wf.withOptions({ checkpointer: ctx.checkpointer }));
const initial = ctx.initialState(wf);
const finalState = await app.invoke(initial);
await ctx.finish(finalState);
console.log(`Run complete: ${opts.out}`);
});

Testing strategy

Unit: templating helpers, hashing/caching, exec success/failure/timeout, retry/backoff.

Integration: run a 4-node DAG (exec → map(task×N) → reduce(task)) with controlled fixtures.

Deterministic e2e: run twice with same inputs, assert second run hits cache on exec and any deterministic: true tasks.

Example: tiny deterministic workflow
version: 1
name: Deterministic Demo
nodes:

- id: echo
  kind: exec
  command: bash
  args: ["-lc", "echo '{\"hello\":\"world\"}' > out.json"]
  produces:
  files: ["./out.json"]
  json: { resultFromFile: "./out.json" }
  deterministic: true

- id: print
  kind: exec
  deps: [echo]
  command: bash
  args: ["-lc", "cat out.json"]
  deterministic: true

Run twice; expect echo and print to be marked CACHED on the second run.

Why LangGraph here?

It gives you a declarative, debuggable state machine with checkpointers, making resume/retry robust.

It’s simple to compile deps → edges and keep node code focused on work, not orchestration.

You can replace map/reduce with subgraphs later without changing the high-level model.
