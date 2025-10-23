# DagRun - YAML-Driven Workflow DAG Runner

## Overview

DagRun is a TypeScript CLI application that executes YAML-defined workflow DAGs (Directed Acyclic Graphs). It features:

- **Modular "Lego Block" Architecture**: Each step is a self-contained unit that can pass outputs (text, JSON, files) to downstream steps
- **Deterministic Caching**: SHA-256 input hashing with filesystem-based content-addressable caching for reproducible builds
- **Flexible Step Types**: Support for shell commands (`exec`) and AI agents (`task`)
- **Output Passing**: Seamless data flow between nodes using Handlebars templating
- **Agent Integration**: Built-in support for Cursor, Augie, and CloudCode agents (stub implementations)

## Project Structure

```
dagrun/
├── src/
│   ├── cli/              # CLI commands (run, validate, plan, show)
│   ├── schema/           # YAML schema validation with AJV
│   ├── templating/       # Handlebars engine with custom helpers
│   └── runtime/
│       ├── graph/        # Workflow runtime and state management
│       ├── store/        # RunStore (outputs) and CacheStore (deterministic caching)
│       ├── agents/       # Agent interface and implementations
│       └── steps/        # Step executors (exec, task)
├── examples/             # Example workflows
└── dist/                 # Compiled JavaScript (after build)
```

## Installation

```bash
npm install
npm run build
```

## Usage

### Run a Workflow

```bash
node dist/cli/index.js run examples/simple-workflow.yaml --verbose
```

Options:
- `-c, --concurrency <number>`: Maximum concurrent nodes (default: 6)
- `-o, --out <directory>`: Output directory for run artifacts
- `-v, --verbose`: Enable verbose logging

### Validate a Workflow

```bash
node dist/cli/index.js validate examples/file-workflow.yaml
```

### Show Execution Plan

```bash
node dist/cli/index.js plan examples/file-workflow.yaml
```

### Show Run Details

```bash
node dist/cli/index.js show --run .runs/2025-10-23T07-11-54.932Z
```

## Workflow YAML Format

```yaml
version: 1
name: Example Workflow
concurrency: 6
vars:
  message: "Hello from dagrun!"

nodes:
  - id: step1
    kind: exec
    name: Echo message
    command: echo
    args: ["{{ vars.message }}"]
    deterministic: true

  - id: step2
    kind: exec
    name: Show step1 output
    deps: [step1]
    command: echo
    args: ["Previous output:", "{{ outputs.step1.result.stdout }}"]
```

## Node Types

### `exec` - Shell Command Execution

Execute shell commands and capture stdout/stderr as outputs.

```yaml
- id: my_command
  kind: exec
  command: bash
  args: ["-c", "ls -la"]
  deterministic: true  # Enable caching
  produces:
    files: ["output.json"]
    json:
      resultFromFile: "output.json"
```

### `task` - Agent Execution

Run AI agents with prompts and inputs.

```yaml
- id: analyze
  kind: task
  agent: cursor
  prompt: "Analyze this data: {{ json outputs.previous.result }}"
  inputs:
    data: "{{ outputs.previous.result }}"
  deterministic: false
```

## Output Passing

Outputs from one node become inputs to downstream nodes via Handlebars templating:

- `{{ vars.variable_name }}` - Access workflow variables
- `{{ outputs.node_id.result }}` - Access node output
- `{{ json object }}` - Convert object to JSON string
- `{{ basename path }}` - Get basename of file path

### Available Helpers

- `basename`: Extract filename from path
- `dirname`: Extract directory from path
- `json`: Convert object to JSON
- `join`: Join array elements
- `loads_file`: Load and parse JSON file

## Deterministic Caching

Steps with `deterministic: true` are cached based on:
- Command/agent name
- Arguments and inputs
- Environment variables
- Dependency outputs (via hash chaining)

Cache hits skip execution and return cached outputs, making workflows faster and reproducible.

## Run Artifacts

Each workflow run creates:
- `run.json`: Complete run metadata, node statuses, outputs, timings
- `artifacts/`: Directory for files created during execution

## Example Workflows

### Simple Workflow
Demonstrates basic output passing between exec steps.

```bash
node dist/cli/index.js run examples/simple-workflow.yaml --verbose
```

### File Workflow
Creates JSON files, passes structured data between nodes, and integrates with agents.

```bash
node dist/cli/index.js run examples/file-workflow.yaml --verbose
```

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Development mode (auto-compile)
npm run dev -- run examples/simple-workflow.yaml
```

## Recent Changes

- **2025-10-23**: Initial implementation
  - Core workflow runtime with sequential execution
  - Exec and task step types
  - Deterministic caching with SHA-256 hashing
  - **Fixed:** Object passing - structured outputs (JSON, objects) now pass correctly between nodes
  - **Fixed:** Deadlock detection - runtime detects and reports circular dependencies
  - **Fixed:** Skipped node handling - nodes with failed dependencies are properly marked as SKIPPED
  - Output passing via Handlebars templating with smart type preservation
  - CLI commands: run, validate, plan, show
  - Agent registry with stub implementations
  - RunStore and CacheStore for persistence

## Future Enhancements

- Parallel node execution with concurrency limits
- Map (fan-out) and reduce (fan-in) step types
- SQLite-based checkpointing for resume capability
- Retry logic with exponential backoff
- TUI progress display with real-time updates
