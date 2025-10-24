import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import chalk from 'chalk';
import { WorkflowDefinition } from '../../schema/types';
import { validateWorkflow } from '../../schema/validator';
import { buildGraphFromWorkflow } from '../../runtime/graph/buildGraph';
import { AgentRegistry } from '../../runtime/agents/registry';
import { CacheStore } from '../../runtime/store/cache-store';
import { RunStore } from '../../runtime/store/run-store';

export interface VisualizeOptions {
  output?: string;
  format?: 'mermaid' | 'png' | 'ascii';
}

/**
 * Visualize command - generates a visual representation of the workflow graph
 * 
 * This command:
 * 1. Loads and validates the workflow YAML
 * 2. Builds the LangGraph StateGraph from the workflow
 * 3. Generates a visualization using LangGraph's built-in methods
 * 4. Outputs the visualization in the requested format
 */
export async function visualizeCommand(
  workflowPath: string,
  options: VisualizeOptions = {}
): Promise<void> {
  console.log(chalk.blue(`Visualizing workflow: ${workflowPath}...`));

  // Load and validate workflow
  const content = await fs.readFile(workflowPath, 'utf8');
  const workflow = yaml.load(content) as WorkflowDefinition;

  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    console.error(chalk.red('✗ Workflow validation failed:'));
    validation.errors?.forEach((err) => console.error(chalk.red(`  - ${err}`)));
    process.exit(1);
  }

  console.log(chalk.green(`✓ Workflow validated: ${workflow.name}`));

  // Create temporary stores (needed for graph building but not used)
  const tempDir = path.join(process.cwd(), '.tmp-visualize');
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const agentRegistry = new AgentRegistry();
    const cacheStore = new CacheStore(path.join(tempDir, 'cache'));
    const runStore = new RunStore(path.join(tempDir, 'run'), workflow.name);

    await cacheStore.init();
    await runStore.init();

    // Build the LangGraph
    console.log(chalk.blue('Building LangGraph...'));
    const graph = buildGraphFromWorkflow(workflow, {
      agentRegistry,
      cacheStore,
      runStore,
      verbose: false,
    });

    // Get the graph representation
    const graphRepresentation = graph.getGraph();

    // Determine output format
    const format = options.format || 'mermaid';

    if (format === 'ascii') {
      // ASCII representation
      console.log(chalk.bold('\nGraph Structure (ASCII):'));
      console.log(chalk.gray('─'.repeat(60)));

      // Generate custom ASCII representation
      const ascii = generateAsciiDiagram(workflow);
      console.log(ascii);

      console.log(chalk.gray('─'.repeat(60)));
    } else if (format === 'mermaid') {
      // Mermaid diagram (text)
      console.log(chalk.bold('\nMermaid Diagram:'));
      console.log(chalk.gray('─'.repeat(60)));
      
      // Generate Mermaid syntax
      const mermaid = generateMermaidDiagram(workflow);
      console.log(mermaid);
      
      console.log(chalk.gray('─'.repeat(60)));

      // Save to file if output specified
      if (options.output) {
        const outputPath = options.output.endsWith('.md') 
          ? options.output 
          : `${options.output}.md`;
        
        const markdownContent = `# ${workflow.name} - Workflow Graph\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`;
        await fs.writeFile(outputPath, markdownContent, 'utf8');
        console.log(chalk.green(`\n✓ Mermaid diagram saved to: ${outputPath}`));
        console.log(chalk.gray(`  You can view this in GitHub, VS Code, or any Mermaid-compatible viewer`));
      }
    } else if (format === 'png') {
      // PNG image (requires mermaid-cli or similar)
      if (!options.output) {
        console.error(chalk.red('✗ PNG format requires --output option'));
        process.exit(1);
      }

      try {
        // Try to use LangGraph's built-in PNG generation
        const representation = graph.getGraph();
        const pngData = await representation.drawMermaidPng();
        const arrayBuffer = await pngData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const outputPath = options.output.endsWith('.png') 
          ? options.output 
          : `${options.output}.png`;
        
        await fs.writeFile(outputPath, buffer);
        console.log(chalk.green(`\n✓ Graph visualization saved to: ${outputPath}`));
      } catch (error) {
        console.error(chalk.red('✗ Failed to generate PNG:'));
        console.error(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
        console.log(chalk.yellow('\n  Tip: Use --format mermaid to generate a text diagram instead'));
        process.exit(1);
      }
    }

    // Print summary
    console.log(chalk.bold('\nWorkflow Summary:'));
    console.log(chalk.gray(`  Name: ${workflow.name}`));
    console.log(chalk.gray(`  Nodes: ${workflow.nodes.length}`));
    console.log(chalk.gray(`  Version: ${workflow.version}`));

  } finally {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Generate a Mermaid diagram from a workflow definition
 */
function generateMermaidDiagram(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  
  lines.push('graph TD');
  lines.push('  START([START])');
  
  // Add nodes
  workflow.nodes.forEach((node) => {
    const label = node.name || node.id;
    const shape = getNodeShape(node.kind);
    lines.push(`  ${node.id}${shape[0]}${label}<br/><i>${node.kind}</i>${shape[1]}`);
  });
  
  lines.push('  END([END])');
  
  // Add edges based on dependencies
  const nodesWithDeps = new Set<string>();
  const nodesWithDependents = new Set<string>();
  
  workflow.nodes.forEach((node) => {
    const deps = node.deps || [];
    
    if (deps.length === 0) {
      // No dependencies: connect from START
      lines.push(`  START --> ${node.id}`);
    } else {
      // Has dependencies: connect from each dependency
      deps.forEach((depId) => {
        lines.push(`  ${depId} --> ${node.id}`);
        nodesWithDependents.add(depId);
      });
      nodesWithDeps.add(node.id);
    }
  });
  
  // Connect nodes with no dependents to END
  workflow.nodes.forEach((node) => {
    if (!nodesWithDependents.has(node.id)) {
      lines.push(`  ${node.id} --> END`);
    }
  });
  
  // Add styling
  lines.push('');
  lines.push('  classDef execNode fill:#e1f5ff,stroke:#01579b,stroke-width:2px');
  lines.push('  classDef taskNode fill:#f3e5f5,stroke:#4a148c,stroke-width:2px');
  lines.push('  classDef mapNode fill:#fff3e0,stroke:#e65100,stroke-width:2px');
  lines.push('  classDef reduceNode fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px');
  
  // Apply styles
  const nodesByKind: Record<string, string[]> = {
    exec: [],
    task: [],
    map: [],
    reduce: [],
  };
  
  workflow.nodes.forEach((node) => {
    if (nodesByKind[node.kind]) {
      nodesByKind[node.kind].push(node.id);
    }
  });
  
  if (nodesByKind.exec.length > 0) {
    lines.push(`  class ${nodesByKind.exec.join(',')} execNode`);
  }
  if (nodesByKind.task.length > 0) {
    lines.push(`  class ${nodesByKind.task.join(',')} taskNode`);
  }
  if (nodesByKind.map.length > 0) {
    lines.push(`  class ${nodesByKind.map.join(',')} mapNode`);
  }
  if (nodesByKind.reduce.length > 0) {
    lines.push(`  class ${nodesByKind.reduce.join(',')} reduceNode`);
  }
  
  return lines.join('\n');
}

/**
 * Get the Mermaid shape syntax for a node kind
 */
function getNodeShape(kind: string): [string, string] {
  switch (kind) {
    case 'exec':
      return ['[', ']'];  // Rectangle
    case 'task':
      return ['[[', ']]'];  // Subroutine shape
    case 'map':
      return ['{{', '}}'];  // Hexagon
    case 'reduce':
      return ['([', '])'];  // Stadium shape
    default:
      return ['[', ']'];
  }
}

/**
 * Generate an ASCII diagram from a workflow definition
 */
function generateAsciiDiagram(workflow: WorkflowDefinition): string {
  const lines: string[] = [];

  // Build dependency map
  const nodeDeps = new Map<string, string[]>();
  const nodeDependents = new Map<string, string[]>();

  workflow.nodes.forEach((node) => {
    nodeDeps.set(node.id, node.deps || []);
    nodeDependents.set(node.id, []);
  });

  workflow.nodes.forEach((node) => {
    (node.deps || []).forEach((depId) => {
      const dependents = nodeDependents.get(depId) || [];
      dependents.push(node.id);
      nodeDependents.set(depId, dependents);
    });
  });

  // Calculate execution levels
  const levels: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < workflow.nodes.length) {
    const currentLevel: string[] = [];

    for (const node of workflow.nodes) {
      if (processed.has(node.id)) continue;

      const deps = nodeDeps.get(node.id) || [];
      const allDepsProcessed = deps.every((dep) => processed.has(dep));

      if (allDepsProcessed) {
        currentLevel.push(node.id);
      }
    }

    if (currentLevel.length === 0) break;

    levels.push(currentLevel);
    currentLevel.forEach((id) => processed.add(id));
  }

  // Generate ASCII art
  lines.push('  ┌─────────┐');
  lines.push('  │  START  │');
  lines.push('  └────┬────┘');
  lines.push('       │');

  levels.forEach((level, levelIndex) => {
    if (level.length === 1) {
      // Single node
      const nodeId = level[0];
      const node = workflow.nodes.find((n) => n.id === nodeId)!;
      const label = node.name || nodeId;
      const kindLabel = `[${node.kind}]`;

      lines.push('       ▼');
      lines.push('  ┌─────────────────┐');
      lines.push(`  │ ${label.padEnd(15)} │`);
      lines.push(`  │ ${kindLabel.padEnd(15)} │`);
      lines.push('  └────────┬────────┘');

      if (levelIndex < levels.length - 1) {
        lines.push('           │');
      }
    } else {
      // Multiple parallel nodes
      lines.push('       ▼');
      lines.push('  ┌────┴────┐');

      level.forEach((nodeId, idx) => {
        const node = workflow.nodes.find((n) => n.id === nodeId)!;
        const label = node.name || nodeId;
        const kindLabel = `[${node.kind}]`;

        const prefix = idx === 0 ? '  │' : '   ';
        lines.push(`${prefix} ┌─────────────────┐`);
        lines.push(`${prefix} │ ${label.padEnd(15)} │`);
        lines.push(`${prefix} │ ${kindLabel.padEnd(15)} │`);
        lines.push(`${prefix} └────────┬────────┘`);
      });

      if (levelIndex < levels.length - 1) {
        lines.push('  └────┬────┘');
        lines.push('       │');
      }
    }
  });

  lines.push('       ▼');
  lines.push('  ┌─────────┐');
  lines.push('  │   END   │');
  lines.push('  └─────────┘');

  return lines.join('\n');
}

