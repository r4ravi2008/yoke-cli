import { promises as fs } from 'fs';
import * as yaml from 'yaml';
import chalk from 'chalk';
import { WorkflowDefinition } from '../../schema/types';
import { validateWorkflow } from '../../schema/validator';

export async function planCommand(workflowPath: string): Promise<void> {
  console.log(chalk.blue(`Planning workflow: ${workflowPath}...`));

  const content = await fs.readFile(workflowPath, 'utf8');
  const workflow = yaml.load(content) as WorkflowDefinition;

  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    console.error(chalk.red('✗ Workflow validation failed:'));
    validation.errors?.forEach((err) => console.error(chalk.red(`  - ${err}`)));
    process.exit(1);
  }

  console.log(chalk.green(`\nWorkflow: ${workflow.name}`));
  console.log(chalk.gray(`Version: ${workflow.version}\n`));

  console.log(chalk.bold('Execution Plan:'));
  
  const nodeDeps = new Map<string, string[]>();
  workflow.nodes.forEach((node) => {
    nodeDeps.set(node.id, node.deps || []);
  });

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

  levels.forEach((level, i) => {
    console.log(chalk.cyan(`\nLevel ${i + 1}:`));
    level.forEach((nodeId) => {
      const node = workflow.nodes.find((n) => n.id === nodeId)!;
      const deps = node.deps ? ` <- [${node.deps.join(', ')}]` : '';
      console.log(`  ${chalk.yellow(node.id)} (${node.kind})${deps}`);
      if (node.name) console.log(chalk.gray(`    ${node.name}`));
    });
  });

  console.log(chalk.gray(`\nTotal nodes: ${workflow.nodes.length}`));
  console.log(chalk.gray(`Execution levels: ${levels.length}`));
}
