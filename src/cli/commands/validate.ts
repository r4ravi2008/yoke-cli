import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { WorkflowDefinition } from '../../schema/types';
import { validateWorkflow } from '../../schema/validator';

export async function validateCommand(workflowPath: string): Promise<void> {
  console.log(chalk.blue(`Validating workflow: ${workflowPath}...`));

  const content = await fs.readFile(workflowPath, 'utf8');
  const workflow = yaml.load(content) as WorkflowDefinition;

  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    console.error(chalk.red('✗ Workflow validation failed:'));
    validation.errors?.forEach((err) => console.error(chalk.red(`  - ${err}`)));
    process.exit(1);
  }

  console.log(chalk.green(`✓ Workflow is valid: ${workflow.name}`));
  console.log(chalk.gray(`  Nodes: ${workflow.nodes.length}`));
  console.log(chalk.gray(`  Version: ${workflow.version}`));
  
  workflow.nodes.forEach((node) => {
    const deps = node.deps ? ` (deps: ${node.deps.join(', ')})` : '';
    console.log(chalk.gray(`  - ${node.id} [${node.kind}]${deps}`));
  });
}
