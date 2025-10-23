import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import path from 'path';
import chalk from 'chalk';
import { WorkflowDefinition } from '../../schema/types';
import { validateWorkflow } from '../../schema/validator';
import { WorkflowRuntime } from '../../runtime/graph/runtime';
import { AgentRegistry } from '../../runtime/agents/registry';
import { CacheStore } from '../../runtime/store/cache-store';
import { RunStore } from '../../runtime/store/run-store';

export interface RunOptions {
  concurrency?: number;
  out?: string;
  resume?: boolean;
  only?: string;
  verbose?: boolean;
}

export async function runCommand(workflowPath: string, options: RunOptions): Promise<void> {
  console.log(chalk.blue(`Loading workflow from ${workflowPath}...`));

  const content = await fs.readFile(workflowPath, 'utf8');
  const workflow = yaml.load(content) as WorkflowDefinition;

  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    console.error(chalk.red('Workflow validation failed:'));
    validation.errors?.forEach((err) => console.error(chalk.red(`  - ${err}`)));
    process.exit(1);
  }

  console.log(chalk.green(`Workflow validated: ${workflow.name}`));

  const runDir = options.out || path.join('.runs', new Date().toISOString().replace(/:/g, '-'));
  const cacheDir = './cache';

  const agentRegistry = new AgentRegistry();
  const cacheStore = new CacheStore(cacheDir);
  const runStore = new RunStore(runDir, workflow.name);

  await cacheStore.init();
  await runStore.init();

  console.log(chalk.blue(`Run directory: ${runDir}`));
  console.log(chalk.blue(`Starting workflow execution...`));
  console.log('');

  const runtime = new WorkflowRuntime(workflow, {
    agentRegistry,
    cacheStore,
    runStore,
    verbose: options.verbose,
  });

  try {
    await runtime.run();
    console.log('');
    console.log(chalk.green('✓ Workflow completed successfully!'));
    console.log(chalk.gray(`Run details: ${runDir}/run.json`));
  } catch (error) {
    console.log('');
    console.error(chalk.red('✗ Workflow failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    console.log(chalk.gray(`Run details: ${runDir}/run.json`));
    process.exit(1);
  }
}
