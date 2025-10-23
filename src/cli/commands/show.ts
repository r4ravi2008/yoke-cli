import { promises as fs } from 'fs';
import chalk from 'chalk';
import { RunStore } from '../../runtime/store/run-store';

export interface ShowOptions {
  run?: string;
}

export async function showCommand(options: ShowOptions): Promise<void> {
  const runDir = options.run || '.runs/latest';
  
  console.log(chalk.blue(`Loading run from ${runDir}...`));

  const metadata = await RunStore.load(runDir);

  console.log(chalk.green(`\nWorkflow: ${metadata.workflowName}`));
  console.log(chalk.gray(`Status: ${metadata.status}`));
  console.log(chalk.gray(`Started: ${metadata.startTime}`));
  if (metadata.endTime) {
    console.log(chalk.gray(`Ended: ${metadata.endTime}`));
    const duration = new Date(metadata.endTime).getTime() - new Date(metadata.startTime).getTime();
    console.log(chalk.gray(`Duration: ${Math.round(duration / 1000)}s`));
  }

  console.log(chalk.bold('\nNodes:'));
  
  Object.entries(metadata.nodes).forEach(([nodeId, nodeData]) => {
    const statusColor = 
      nodeData.status === 'SUCCESS' || nodeData.status === 'CACHED' ? chalk.green :
      nodeData.status === 'FAILED' ? chalk.red :
      nodeData.status === 'SKIPPED' ? chalk.gray :
      chalk.yellow;

    console.log(`  ${statusColor(nodeData.status.padEnd(10))} ${nodeId}`);
    
    if (nodeData.duration) {
      console.log(chalk.gray(`    Duration: ${nodeData.duration}ms`));
    }
    
    if (nodeData.output) {
      console.log(chalk.gray(`    Result: ${JSON.stringify(nodeData.output.result).substring(0, 100)}...`));
      if (nodeData.output.artifacts && nodeData.output.artifacts.length > 0) {
        console.log(chalk.gray(`    Artifacts: ${nodeData.output.artifacts.join(', ')}`));
      }
    }
    
    if (nodeData.error) {
      console.log(chalk.red(`    Error: ${nodeData.error}`));
    }
  });
}
