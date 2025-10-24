# DagRun - YAML-Driven Workflow DAG Runner

A powerful CLI tool for running YAML-defined workflow DAGs with LangGraph, featuring deterministic caching, parallel execution, and AI agent integration.

## Features

- 🔄 **LangGraph Integration** - Built on LangGraph StateGraph for robust workflow orchestration
- 📊 **DAG Execution** - Define complex workflows with dependencies and parallel execution
- 💾 **Deterministic Caching** - Content-addressable caching for reproducible builds
- 🤖 **AI Agent Support** - Integrate with Cursor, Augie, and CloudCode agents
- 🔁 **Map-Reduce** - Fan-out/fan-in patterns for parallel data processing
- 📝 **Templating** - Handlebars templates for dynamic workflows
- 🎨 **Visualization** - Generate Mermaid diagrams and ASCII art of your workflows
- ✅ **Type-Safe** - Full TypeScript implementation with schema validation

## Installation

```bash
npm install
npm run build
```

## Quick Start

### 1. Define a Workflow

Create a YAML file (e.g., `workflow.yaml`):

```yaml
version: 1
name: My Workflow

nodes:
  - id: step1
    kind: exec
    command: echo
    args: ["Hello, World!"]
    deterministic: true

  - id: step2
    kind: exec
    command: cat
    args: ["{{outputs.step1.result.stdout}}"]
    deps: [step1]
```

### 2. Run the Workflow

```bash
dagrun run workflow.yaml
```

### 3. Visualize the Workflow

```bash
dagrun visualize workflow.yaml --output workflow-graph.md
```

## Commands

### `run` - Execute a workflow

```bash
dagrun run <workflow.yaml> [options]

Options:
  -c, --concurrency <number>  Maximum concurrent nodes (default: 6)
  -o, --out <directory>       Output directory for run artifacts
  --resume                    Resume from previous run
  --only <nodes>              Run only specified nodes (comma-separated)
  -v, --verbose               Verbose logging
```

### `validate` - Validate a workflow

```bash
dagrun validate <workflow.yaml>
```

Checks the workflow YAML against the schema and reports any errors.

### `plan` - Show execution plan

```bash
dagrun plan <workflow.yaml>
```

Displays the execution plan showing which nodes will run in parallel and their dependencies.

### `visualize` - Generate workflow visualization

```bash
dagrun visualize <workflow.yaml> [options]

Options:
  -o, --output <file>         Output file path
  -f, --format <format>       Output format: mermaid, png, or ascii (default: mermaid)
```

Generates visual representations of your workflow:
- **Mermaid**: Diagrams for GitHub, VS Code, or documentation
- **ASCII**: Terminal-friendly text diagrams
- **PNG**: Image files (requires network access)

See [docs/visualize-command.md](docs/visualize-command.md) for details.

### `show` - Show run details

```bash
dagrun show --run <directory>
```

Displays details of a completed workflow run.

## Workflow Schema

### Node Types

#### `exec` - Execute a command

```yaml
- id: my_exec
  kind: exec
  command: echo
  args: ["Hello"]
  deterministic: true  # Enable caching
  timeout: 30000       # Timeout in ms
```

#### `task` - Run an AI agent task

```yaml
- id: my_task
  kind: task
  agent: cursor
  prompt: "Analyze this code"
  context:
    code: "{{outputs.previous_step.result}}"
```

#### `map` - Fan-out operation

```yaml
- id: process_files
  kind: map
  over: "{{outputs.list_files.result}}"
  exec:
    command: process
    args: ["{{item}}"]
  concurrency: 3
```

#### `reduce` - Fan-in operation

```yaml
- id: aggregate
  kind: reduce
  from: process_files
  exec:
    command: aggregate
    args: ["{{items}}"]
```

### Templating

Use Handlebars templates to reference outputs and variables:

```yaml
vars:
  name: "World"

nodes:
  - id: greet
    kind: exec
    command: echo
    args: ["Hello, {{vars.name}}!"]
  
  - id: show_result
    kind: exec
    command: echo
    args: ["Previous output: {{outputs.greet.result.stdout}}"]
    deps: [greet]
```

**Available Helpers:**
- `{{basename path}}` - Get filename from path
- `{{dirname path}}` - Get directory from path
- `{{join path1 path2}}` - Join paths
- `{{json obj}}` - Convert to JSON
- `{{loads_file path}}` - Load file contents

## Examples

See the `examples/` directory for complete workflow examples:

- **simple-workflow.yaml** - Basic two-step workflow
- **file-workflow.yaml** - File I/O with output passing
- **map-reduce-workflow.yaml** - Parallel processing with map-reduce

## Architecture

DagRun is built on **LangGraph StateGraph**, providing:

- **Router-based execution** - Intelligent dependency resolution
- **State management** - Proper state updates and merging
- **Parallel execution** - Automatic parallelization of independent nodes
- **Error handling** - Graceful failure with dependency skipping
- **Checkpointing** - Foundation for resume functionality (coming soon)

See [docs/langgraph-integration-summary.md](docs/langgraph-integration-summary.md) for implementation details.

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run with coverage
npm run test:coverage
```

**Test Coverage:** 17 tests passing (7 unit, 10 integration)

## Development

```bash
# Build
npm run build

# Run in development mode
npm run dev -- run examples/simple-workflow.yaml

# Watch mode
npm run test:watch
```

## Documentation

- [Implementation Plan](docs/implementation-plan.md) - Project roadmap and status
- [LangGraph Integration](docs/langgraph-integration-summary.md) - Architecture details
- [Visualize Command](docs/visualize-command.md) - Visualization guide

## Roadmap

### ✅ Completed
- [x] Phase 1: Foundations (CLI, schema, templating)
- [x] Phase 2: DAG + Parallelism
- [x] Phase 3: Agents + Map-Reduce
- [x] Phase B.1: LangGraph Integration
- [x] Test Infrastructure (Jest, 17 tests)
- [x] Graph Visualization

### 🚧 In Progress
- [ ] Phase B.2: Resume Functionality with Checkpointing
- [ ] Phase A.1: Retry and Backoff Logic

### 📋 Planned
- [ ] Global Concurrency Control
- [ ] Selective Node Execution (`--only` flag)
- [ ] Cache-based Skipping (`--since-cache` flag)
- [ ] TUI Progress Display
- [ ] JSONL Log Output

See [docs/implementation-plan.md](docs/implementation-plan.md) for details.

## License

MIT

## Contributing

Contributions are welcome! Please read the implementation plan and ensure tests pass before submitting PRs.

```bash
npm test
npm run build
```

