import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import path from 'path';
import chalk from 'chalk';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
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

  let runDir: string;
  let threadId: string | undefined;
  let checkpointer: SqliteSaver;
  let isResume = false;

  if (options.resume) {
    // ========== RESUME MODE ==========
    if (!options.out) {
      console.error(chalk.red('Error: --out directory must be specified when using --resume'));
      console.log(chalk.yellow('Example: yoke run workflow.yaml --resume --out .runs/my-run'));
      process.exit(1);
    }

    runDir = options.out;

    // Check if run directory exists
    try {
      await fs.access(runDir);
    } catch {
      console.error(chalk.red(`Error: Run directory does not exist: ${runDir}`));
      console.log(chalk.yellow('Make sure you specified the correct --out directory'));
      process.exit(1);
    }

    // Load existing run metadata
    try {
      const metadata = await RunStore.load(runDir);
      threadId = metadata.threadId;
      isResume = true;

      console.log(chalk.yellow(`Resuming workflow: ${metadata.workflowName}`));
      console.log(chalk.blue(`Run directory: ${runDir}`));
      console.log(chalk.blue(`Thread ID: ${threadId}`));
      console.log(chalk.blue(`Original start: ${metadata.startTime}`));
    } catch (error) {
      console.error(chalk.red(`Error: Could not load run metadata from ${runDir}/run.json`));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }

    // Check if checkpoint database exists
    const checkpointDbPath = path.join(runDir, 'checkpoints.db');
    try {
      await fs.access(checkpointDbPath);
    } catch {
      console.error(chalk.red(`Error: Checkpoint database not found: ${checkpointDbPath}`));
      console.log(chalk.yellow('This run may not have checkpointing enabled'));
      process.exit(1);
    }

    // Initialize checkpointer with existing database
    checkpointer = SqliteSaver.fromConnString(checkpointDbPath);

  } else {
    // ========== NEW RUN MODE ==========
    runDir = options.out || path.join('.runs', new Date().toISOString().replace(/:/g, '-'));

    // Create run directory
    await fs.mkdir(runDir, { recursive: true });

    // Initialize checkpointer with new database
    const checkpointDbPath = path.join(runDir, 'checkpoints.db');
    checkpointer = SqliteSaver.fromConnString(checkpointDbPath);

    console.log(chalk.blue(`Run directory: ${runDir}`));
    console.log(chalk.blue(`Starting workflow execution...`));
  }

  const cacheDir = './cache';

  const agentRegistry = new AgentRegistry();
  const cacheStore = new CacheStore(cacheDir);

  let runStore: RunStore;
  if (isResume) {
    runStore = await RunStore.loadForResume(runDir);
  } else {
    runStore = new RunStore(runDir, workflow.name);
    await runStore.init();
  }

  await cacheStore.init();

  console.log('');

  const runtime = new WorkflowRuntime(workflow, {
    agentRegistry,
    cacheStore,
    runStore,
    checkpointer,
    threadId: isResume ? threadId : undefined,
    verbose: options.verbose,
  });

  try {
    await runtime.run();
    console.log('');
    console.log(chalk.green('✓ Workflow completed successfully!'));
    console.log(chalk.gray(`Run details: ${runDir}/run.json`));
    console.log(chalk.gray(`Checkpoints: ${runDir}/checkpoints.db`));
  } catch (error) {
    console.log('');
    console.error(chalk.red('✗ Workflow failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    console.log(chalk.gray(`Run details: ${runDir}/run.json`));
    console.log(chalk.gray(`Checkpoints: ${runDir}/checkpoints.db`));
    console.log('');
    console.log(chalk.yellow('To resume this workflow, run:'));
    console.log(chalk.cyan(`  yoke run ${workflowPath} --resume --out ${runDir}`));
    process.exit(1);
  }
}
