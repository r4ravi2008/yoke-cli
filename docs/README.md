# DagRun Documentation

Welcome to the DagRun documentation! DagRun is a YAML-driven workflow orchestration tool built on LangGraph.

## 📚 Documentation Structure

### 🏗️ Architecture
Technical documentation about system design and implementation:

- **[Design Document](architecture/design.md)** - Original design specification and high-level architecture
- **[LangGraph Integration](architecture/langgraph-integration.md)** - Detailed guide on how DagRun uses LangGraph for workflow orchestration

### 📖 User Guides
Practical guides for workflow authors:

- **[Data Flow Guide](guides/state-flow.md)** - Understanding how data flows between nodes in workflows
- **[Visualize Command](guides/visualize-command.md)** - How to visualize your workflow graphs

### 📋 Planning & Tracking
Project planning and implementation tracking:

- **[Implementation Plan](planning/implementation-plan.md)** - Overall implementation tracking and roadmap
- **[Resume Implementation Plan](planning/resume-implementation-plan.md)** - Detailed plan for checkpoint/resume functionality
- **[Phase B2 Status](planning/PHASE_B2_READY_FOR_IMPLEMENTATION.md)** - Resume feature readiness
- **[Documentation Updates](planning/DOCUMENTATION_UPDATE_SUMMARY.md)** - Summary of documentation changes

### 📊 Workflow Visualizations
Example workflow diagrams:

- [Simple Workflow](visualizations/simple-workflow.md)
- [File Workflow](visualizations/file-workflow.md)
- [Map-Reduce Workflow](visualizations/map-reduce-workflow.md)

## 🚀 Quick Start

### Installation

```bash
npm install
npm run build
```

### Run a Workflow

```bash
dagrun run examples/simple-workflow.yaml
```

### Visualize a Workflow

```bash
dagrun visualize examples/simple-workflow.yaml
```

### Validate a Workflow

```bash
dagrun validate examples/simple-workflow.yaml
```

## 📝 Writing Workflows

### Basic Structure

```yaml
version: 1
name: My Workflow
vars:
  message: "Hello World"

nodes:
  - id: step1
    kind: exec
    command: echo
    args: ["{{ vars.message }}"]

  - id: step2
    deps: [step1]
    kind: exec
    command: echo
    args: ["Previous output: {{ outputs.step1.result.stdout }}"]
```

### Node Types

- **`exec`** - Execute shell commands
- **`task`** - Run agent tasks (AI/automation)
- **`map`** - Process array items in parallel
- **`reduce`** - Aggregate results from map operations

## 🔍 Key Concepts

### Dependencies
Control execution order with `deps`:
```yaml
nodes:
  - id: prepare
    kind: exec
    # ...

  - id: process
    deps: [prepare]  # Waits for 'prepare'
    kind: exec
    # ...
```

### Data Flow
Access previous node outputs:
```yaml
nodes:
  - id: step2
    deps: [step1]
    command: echo
    args: ["{{ outputs.step1.result.stdout }}"]
```

### Variables
Define reusable values:
```yaml
vars:
  api_url: "https://api.example.com"
  timeout: 30000

nodes:
  - id: call_api
    command: curl
    args: ["{{ vars.api_url }}/endpoint"]
```

## 🎯 Use Cases

- **Data Pipelines** - ETL workflows with parallel processing
- **CI/CD** - Build, test, and deployment automation
- **ML Workflows** - Data preparation, training, evaluation
- **Code Analysis** - Parallel file analysis with AI agents
- **Report Generation** - Fetch data, process, generate reports

## 🧩 Features

- ✅ **Declarative YAML** - Define workflows as code
- ✅ **Dependency Management** - Automatic execution ordering
- ✅ **Parallel Execution** - Map/reduce patterns for fan-out/fan-in
- ✅ **Deterministic Caching** - Skip re-running unchanged steps
- ✅ **LangGraph Integration** - Built on production-ready state machine
- ✅ **Template Engine** - Dynamic values with Handlebars
- ✅ **Visualization** - Generate workflow diagrams
- ✅ **Error Handling** - Automatic dependent node skipping on failures
- 🔄 **Resume Support** - (Coming soon) Resume from checkpoints

## 📚 Learn More

### For Users
- Start with the [Data Flow Guide](guides/state-flow.md) to understand workflow basics
- Read the [Visualize Command Guide](guides/visualize-command.md) to learn about graph visualization
- Explore example workflows in the `examples/` directory

### For Developers
- Read the [LangGraph Integration Guide](architecture/langgraph-integration.md) for technical details
- Check the [Design Document](architecture/design.md) for overall architecture
- Review the [Implementation Plan](planning/implementation-plan.md) for current status and roadmap

## 🤝 Contributing

(Coming soon - contribution guidelines)

## 📄 License

MIT

---

**Project Status**: Active Development  
**Current Phase**: Phase B (LangGraph Integration) - Complete ✅  
**Next Phase**: Resume Functionality (Checkpointing)

**Last Updated**: 2025-10-23
