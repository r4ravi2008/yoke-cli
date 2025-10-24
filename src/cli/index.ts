#!/usr/bin/env node

import { Command } from 'commander';
import { runCommand } from './commands/run';
import { validateCommand } from './commands/validate';
import { planCommand } from './commands/plan';
import { showCommand } from './commands/show';
import { visualizeCommand } from './commands/visualize';

const program = new Command();

program
  .name('dagrun')
  .description('CLI for running YAML-defined workflow DAGs with LangGraph')
  .version('1.0.0');

program
  .command('run')
  .description('Run a workflow')
  .argument('<workflow>', 'Path to workflow YAML file')
  .option('-c, --concurrency <number>', 'Maximum concurrent nodes', '6')
  .option('-o, --out <directory>', 'Output directory for run artifacts')
  .option('--resume', 'Resume from previous run')
  .option('--only <nodes>', 'Run only specified nodes (comma-separated)')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (workflow, options) => {
    try {
      await runCommand(workflow, {
        concurrency: parseInt(options.concurrency),
        out: options.out,
        resume: options.resume,
        only: options.only,
        verbose: options.verbose,
      });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate a workflow YAML file')
  .argument('<workflow>', 'Path to workflow YAML file')
  .action(async (workflow) => {
    try {
      await validateCommand(workflow);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('plan')
  .description('Show execution plan for a workflow')
  .argument('<workflow>', 'Path to workflow YAML file')
  .action(async (workflow) => {
    try {
      await planCommand(workflow);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('show')
  .description('Show details of a workflow run')
  .option('--run <directory>', 'Path to run directory')
  .action(async (options) => {
    try {
      await showCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('visualize')
  .description('Visualize the workflow graph structure')
  .argument('<workflow>', 'Path to workflow YAML file')
  .option('-o, --output <file>', 'Output file path (for mermaid or png formats)')
  .option('-f, --format <format>', 'Output format: mermaid, png, or ascii', 'mermaid')
  .action(async (workflow, options) => {
    try {
      await visualizeCommand(workflow, {
        output: options.output,
        format: options.format,
      });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
