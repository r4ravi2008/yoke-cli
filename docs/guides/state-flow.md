# Understanding Data Flow in DagRun

## Table of Contents

1. [Introduction](#introduction)
2. [Basic Concepts](#basic-concepts)
3. [Passing Data Between Nodes](#passing-data-between-nodes)
4. [Working with Variables](#working-with-variables)
5. [Fan-Out/Fan-In Patterns](#fan-outfan-in-patterns)
6. [Template Expressions](#template-expressions)
7. [Common Patterns](#common-patterns)
8. [Troubleshooting](#troubleshooting)

---

## Introduction

DagRun workflows are built around **data flow** - how information moves from one step to another. Understanding this flow is essential for building effective workflows.

### The Big Picture

```
workflow vars (input)
     ↓
  Node 1 → output stored
     ↓
  Node 2 → reads Node 1's output, produces own output
     ↓
  Node 3 → reads outputs from Node 1 and Node 2
     ↓
  Final result
```

Every node can:

- ✅ **Read** workflow variables
- ✅ **Read** outputs from nodes it depends on
- ✅ **Produce** output for downstream nodes

---

## Basic Concepts

### Workflow Variables (`vars`)

Variables are defined at the workflow level and available to all nodes:

```yaml
version: 1
name: My Workflow
vars:
  repo_url: "https://github.com/myorg/myrepo"
  output_dir: "./results"
  max_count: 10
```

Access them in any node using `{{ vars.variableName }}`:

```yaml
nodes:
  - id: clone
    kind: exec
    command: git
    args: ["clone", "{{ vars.repo_url }}"]
```

### Node Outputs (`outputs`)

Every node produces an output that downstream nodes can access:

```yaml
nodes:
  - id: step1
    kind: exec
    command: echo
    args: ["Hello World"]
    # Produces: { stdout: "Hello World", exitCode: 0 }

  - id: step2
    deps: [step1]
    kind: exec
    command: echo
    args: ["Previous output was: {{ outputs.step1.result.stdout }}"]
```

**Output Structure:**

```typescript
{
  result: { /* node's actual output */ },
  artifacts: [ /* files created */ ],
  cached: false  // whether from cache
}
```

### Dependencies (`deps`)

Dependencies control execution order and data availability:

```yaml
nodes:
  - id: prepare
    kind: exec
    # ...

  - id: process
    deps: [prepare] # Wait for 'prepare' to complete
    kind: exec
    # Can now access outputs.prepare.*
```

**Rule:** A node can only access outputs from nodes listed in its `deps`.

---

## Passing Data Between Nodes

### Example 1: Simple Linear Flow

```yaml
version: 1
name: Simple Data Passing
vars:
  message: "Hello from DagRun!"

nodes:
  - id: step1
    kind: exec
    name: Echo message
    command: echo
    args: ["{{ vars.message }}"]
    # Output: { stdout: "Hello from DagRun!", exitCode: 0 }

  - id: step2
    kind: exec
    name: Show step1 output
    deps: [step1]
    command: echo
    args: ["Previous step said:", "{{ outputs.step1.result.stdout }}"]
    # Output: { stdout: "Previous step said: Hello from DagRun!", exitCode: 0 }
```

**Flow:**

1. `step1` executes with `vars.message`
2. `step1` stores output in `outputs.step1`
3. `step2` reads `outputs.step1.result.stdout`

### Example 2: JSON Data Passing

```yaml
nodes:
  - id: create_data
    kind: exec
    name: Create JSON data
    command: bash
    args:
      - -c
      - |
        echo '{"count": 5, "items": ["a", "b", "c"]}' > data.json
    produces:
      files: ["data.json"]
      json:
        resultFromFile: "data.json"
    # Output: { count: 5, items: ["a", "b", "c"] }

  - id: use_data
    deps: [create_data]
    kind: exec
    command: bash
    args:
      - -c
      - |
        echo "Processing {{ outputs.create_data.result.count }} items"
        echo "First item: {{ outputs.create_data.result.items.[0] }}"
```

**Key Point:** When using `produces.json.resultFromFile`, the JSON content becomes the node's `result`.

### Example 3: Multi-Node Dependencies

```yaml
nodes:
  - id: fetch_users
    kind: exec
    # ... produces list of users

  - id: fetch_posts
    kind: exec
    # ... produces list of posts

  - id: combine
    deps: [fetch_users, fetch_posts]
    kind: exec
    command: bash
    args:
      - -c
      - |
        echo "Users: {{ json outputs.fetch_users.result }}"
        echo "Posts: {{ json outputs.fetch_posts.result }}"
```

**Flow:**

```
fetch_users ──┐
              ├─→ combine (waits for both)
fetch_posts ──┘
```

---

## Working with Variables

### Setting Variables

Variables are set in the workflow YAML:

```yaml
vars:
  # Strings
  project_name: "my-project"

  # Numbers
  timeout: 300
  max_retries: 3

  # Booleans
  debug_mode: true

  # Arrays
  file_extensions: [".ts", ".js", ".tsx"]

  # Objects
  config:
    host: "localhost"
    port: 8080
```

### Using Variables

Access with `{{ vars.name }}`:

```yaml
nodes:
  - id: example
    command: echo
    args: ["Project: {{ vars.project_name }}"]
```

### Nested Variables

Access nested properties with dot notation:

```yaml
nodes:
  - id: connect
    command: curl
    args: ["{{ vars.config.host }}:{{ vars.config.port }}"]
```

---

## Fan-Out/Fan-In Patterns

### Pattern: Parallel Processing

Process multiple items in parallel, then aggregate results.

#### Using Map/Reduce

```yaml
nodes:
  - id: create_list
    kind: exec
    command: bash
    args:
      - -c
      - echo '["file1.txt", "file2.txt", "file3.txt"]' > files.json
    produces:
      json:
        resultFromFile: "files.json"

  - id: process_files
    kind: map
    deps: [create_list]
    over: "{{ outputs.create_list.result }}"
    map:
      kind: exec
      command: wc
      args: ["-l", "{{ item }}"]
    # Produces array: ["10", "25", "15"]

  - id: aggregate
    kind: reduce
    deps: [process_files]
    reduce:
      kind: exec
      command: bash
      args:
        - -c
        - |
          echo "Results: {{ json outputs.process_files.result }}"
          echo "Total files processed: {{ outputs.process_files.result.length }}"
```

**Flow:**

```
create_list → [file1, file2, file3]
     ↓
process_files (map)
     ├─→ wc file1.txt → "10"
     ├─→ wc file2.txt → "25"  (in parallel)
     └─→ wc file3.txt → "15"
     ↓
Collected: ["10", "25", "15"]
     ↓
aggregate → Final report
```

#### Using Node-Level Parallelism

```yaml
nodes:
  - id: generate_data
    kind: exec
    # ... produces [1, 2, 3, 4, 5]

  # Both execute in parallel after generate_data
  - id: square_numbers
    kind: map
    deps: [generate_data]
    over: "{{ outputs.generate_data.result }}"
    map:
      kind: exec
      command: bash
      args: ["-c", "echo $(( {{ item }} * {{ item }} ))"]
    # Produces: [1, 4, 9, 16, 25]

  - id: cube_numbers
    kind: map
    deps: [generate_data]
    over: "{{ outputs.generate_data.result }}"
    map:
      kind: exec
      command: bash
      args: ["-c", "echo $(( {{ item }} * {{ item }} * {{ item }} ))"]
    # Produces: [1, 8, 27, 64, 125]

  # Waits for both branches
  - id: final_report
    deps: [square_numbers, cube_numbers]
    kind: exec
    command: bash
    args:
      - -c
      - |
        echo "Squares: {{ json outputs.square_numbers.result }}"
        echo "Cubes: {{ json outputs.cube_numbers.result }}"
```

**Flow:**

```
     generate_data
           ↓
    ┌──────┴──────┐
    ↓             ↓
square_numbers  cube_numbers  (parallel)
    │             │
    └──────┬──────┘
           ↓
    final_report  (fan-in)
```

### Pattern: Diamond DAG

```yaml
nodes:
  - id: start
    kind: exec
    # ...

  - id: branch1
    deps: [start]
    # ...

  - id: branch2
    deps: [start]
    # ...

  - id: merge
    deps: [branch1, branch2]
    # Can access outputs from both branches
    command: echo
    args:
      - "Branch 1: {{ outputs.branch1.result }}"
      - "Branch 2: {{ outputs.branch2.result }}"
```

**Flow:**

```
     start
    ↙     ↘
branch1   branch2
    ↘     ↙
     merge
```

---

## Template Expressions

### Basic Syntax

Templates use Handlebars-style `{{ }}` syntax:

```yaml
# Simple variable
{{ vars.name }}

# Nested property
{{ vars.config.host }}

# Node output
{{ outputs.step1.result.stdout }}

# Array index
{{ outputs.list_files.result.[0] }}
```

### Template Helpers

#### `json` - Stringify as JSON

```yaml
args: ["Data: {{ json outputs.step1.result }}"]
# Result: Data: {"key":"value"}
```

#### `basename` - Get filename

```yaml
# If item = "/path/to/file.txt"
{ { basename item } }
# Result: file.txt
```

#### `dirname` - Get directory

```yaml
# If item = "/path/to/file.txt"
{ { dirname item } }
# Result: /path/to
```

#### `join` - Join array

```yaml
# If outputs.list.result = ["a", "b", "c"]
{{ join outputs.list.result "," }}
# Result: a,b,c
```

#### `loads_file` - Load JSON file

```yaml
{ { loads_file "data.json" } }
# Loads and parses JSON file
```

### Complex Expressions

```yaml
nodes:
  - id: complex
    command: bash
    args:
      - -c
      - |
        # Multiple templates in one arg
        echo "Processing {{ basename item }} from {{ dirname item }}"

        # JSON stringification
        echo '{{ json outputs.data.result }}' > output.json

        # Array joining
        FILES="{{ join outputs.files.result " " }}"
        wc -l $FILES
```

---

## Common Patterns

### Pattern 1: Load → Process → Save

```yaml
nodes:
  - id: load_data
    kind: exec
    command: curl
    args: ["https://api.example.com/data"]
    produces:
      json:
        resultFromFile: "response.json"

  - id: process_data
    deps: [load_data]
    kind: task
    agent: cursor
    prompt: "Analyze this data: {{ json outputs.load_data.result }}"

  - id: save_results
    deps: [process_data]
    kind: exec
    command: bash
    args:
      - -c
      - echo '{{ json outputs.process_data.result }}' > results.json
```

### Pattern 2: Conditional Processing

While DagRun doesn't have native conditionals, you can use shell logic:

```yaml
nodes:
  - id: check_and_process
    kind: exec
    command: bash
    args:
      - -c
      - |
        COUNT={{ outputs.previous.result.count }}
        if [ $COUNT -gt 10 ]; then
          echo "Processing large dataset"
          # ... complex processing
        else
          echo "Processing small dataset"
          # ... simple processing
        fi
```

### Pattern 3: Batch Processing

```yaml
nodes:
  - id: list_items
    kind: exec
    # ... produces array of items

  - id: process_batch
    kind: map
    deps: [list_items]
    over: "{{ outputs.list_items.result }}"
    map:
      kind: task
      agent: cursor
      prompt: "Process item: {{ item }}"
      inputs:
        item: "{{ item }}"

  - id: summary
    kind: reduce
    deps: [process_batch]
    reduce:
      kind: task
      agent: cursor
      prompt: |
        Summarize these results:
        {{ json outputs.process_batch.result }}
```

### Pattern 4: Error Recovery

```yaml
nodes:
  - id: risky_operation
    kind: exec
    retries: 3
    timeout: 30000
    # ...

  - id: check_result
    deps: [risky_operation]
    kind: exec
    command: bash
    args:
      - -c
      - |
        # Check if previous step succeeded
        if [ "{{ outputs.risky_operation.result.exitCode }}" = "0" ]; then
          echo "Success! Proceeding..."
        else
          echo "Failed, but handling gracefully"
        fi
```

---

## Troubleshooting

### Issue: Template not resolving

**Symptom:** `{{ outputs.step1.result }}` appears literally in output

**Cause:** Node doesn't depend on `step1`

**Solution:**

```yaml
# Add dependency
- id: step2
  deps: [step1] # ← Add this
  command: echo
  args: ["{{ outputs.step1.result }}"]
```

### Issue: Cannot access nested property

**Symptom:** Error accessing `outputs.step1.result.data.field`

**Cause:** `result` might be a string, not an object

**Solution:**

```yaml
# Check what step1 actually produces
- id: debug
  deps: [step1]
  command: bash
  args:
    - -c
    - echo "Type: $(echo '{{ json outputs.step1.result }}' | jq type)"

# If it's a string containing JSON, parse it first
- id: parse
  deps: [step1]
  kind: exec
  command: bash
  args:
    - -c
    - echo '{{ outputs.step1.result }}' | jq . > parsed.json
  produces:
    json:
      resultFromFile: "parsed.json"
```

### Issue: Array index not working

**Symptom:** `{{ outputs.list.result.[0] }}` doesn't work

**Cause:** Handlebars array syntax

**Solution:**

```yaml
# Use Handlebars array syntax
{{ outputs.list.result.0 }}  # First item
{{ outputs.list.result.1 }}  # Second item

# Or use a helper
{{ json outputs.list.result }}  # Stringify entire array
```

### Issue: Node output is empty

**Symptom:** `outputs.step1.result` is empty or undefined

**Possible causes:**

1. **Node hasn't executed yet:**

   ```yaml
   # Wrong: missing dependency
   - id: step2
     command: echo
     args: ["{{ outputs.step1.result }}"]

   # Right: add dependency
   - id: step2
     deps: [step1] # ← Add this
     command: echo
     args: ["{{ outputs.step1.result }}"]
   ```

2. **Node failed:**
   Check run status:

   ```bash
   dagrun show --run .runs/my-run
   ```

3. **Wrong output format:**
   For exec nodes:
   - Default: `{ stdout: "...", exitCode: 0 }`
   - With `produces.json.resultFromFile`: parsed JSON object

### Issue: Map not iterating

**Symptom:** Map node doesn't process items

**Cause:** `over` expression doesn't resolve to array

**Solution:**

```yaml
# Debug what 'over' resolves to
- id: debug_over
  deps: [previous_step]
  command: bash
  args:
    - -c
    - |
      echo "Value: {{ json outputs.previous_step.result }}"
      echo "Type: $(echo '{{ json outputs.previous_step.result }}' | jq type)"

# Ensure previous step produces an array
- id: previous_step
  kind: exec
  command: bash
  args:
    - -c
    - echo '["item1", "item2", "item3"]' > list.json
  produces:
    json:
      resultFromFile: "list.json" # ← Returns array
```

### Issue: Template syntax error

**Symptom:** Workflow fails with template error

**Common mistakes:**

```yaml
# Wrong: missing closing braces
{{ vars.name }

# Wrong: wrong quotes
{{ outputs.step1.result.'field' }}

# Right:
{{ vars.name }}
{{ outputs.step1.result.field }}
```

---

## Best Practices

### 1. Use Descriptive Node IDs

```yaml
# Good
- id: fetch_user_data
- id: process_payments
- id: generate_report

# Bad
- id: step1
- id: node2
- id: temp
```

### 2. Validate Data Between Steps

```yaml
- id: validate_output
  deps: [previous_step]
  kind: exec
  command: bash
  args:
    - -c
    - |
      # Validate JSON structure
      echo '{{ json outputs.previous_step.result }}' | jq empty || exit 1
      echo "Validation passed"
```

### 3. Use Variables for Reusability

```yaml
# Good: centralized configuration
vars:
  api_url: "https://api.example.com"
  timeout: 30000

nodes:
  - id: call_api
    command: curl
    args: ["{{ vars.api_url }}/endpoint"]
    timeout: "{{ vars.timeout }}"

# Bad: hardcoded values
nodes:
  - id: call_api
    command: curl
    args: ["https://api.example.com/endpoint"]
    timeout: 30000
```

### 4. Use `produces` for Deterministic Outputs

```yaml
# Good: produces.json makes output deterministic
- id: generate_data
  command: bash
  args: ["-c", 'echo ''{"count":5}'' > data.json']
  produces:
    files: ["data.json"]
    json:
      resultFromFile: "data.json"
  deterministic: true # ← Can be cached

# Less ideal: only stdout (less structured)
- id: generate_data
  command: echo
  args: ['{"count":5}']
  # result.stdout contains JSON string
```

### 5. Document Complex Workflows

```yaml
nodes:
  - id: complex_processing
    name: "Process user data with ML model" # ← Descriptive name
    kind: task
    # ... rest of config
    # Description: This node processes user behavioral data
    # using our custom ML model to generate recommendations.
    # Input: outputs.fetch_users.result (array of user objects)
    # Output: { recommendations: [...], confidence: 0.95 }
```

---

## Next Steps

- **Architecture Deep Dive**: Read [LangGraph Integration](../architecture/langgraph-integration.md) for technical details
- **Examples**: Explore workflows in the `examples/` directory
- **API Reference**: See node type documentation
- **Advanced Patterns**: Learn about checkpointing and resume

---

**Document Status**: Complete  
**Last Updated**: 2025-10-23  
**Feedback**: Open an issue if you have questions or suggestions
