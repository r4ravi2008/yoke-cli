/**
 * Terminal UI for displaying workflow execution progress
 */

import chalk from 'chalk';
import { NodeStatus } from '../../runtime/graph/state';

export interface NodeProgress {
  id: string;
  name?: string;
  kind: string;
  status: NodeStatus;
  startTime?: Date;
  endTime?: Date;
  error?: string;
}

export interface ProgressDisplayOptions {
  verbose?: boolean;
  showTimestamps?: boolean;
}

export class ProgressDisplay {
  private nodes: Map<string, NodeProgress> = new Map();
  private options: ProgressDisplayOptions;
  private startTime: Date;
  private lastUpdateTime: number = 0;
  private updateThrottleMs: number = 100; // Throttle updates to avoid flickering

  constructor(options: ProgressDisplayOptions = {}) {
    this.options = options;
    this.startTime = new Date();
  }

  /**
   * Register a node for progress tracking
   */
  registerNode(id: string, name: string | undefined, kind: string): void {
    this.nodes.set(id, {
      id,
      name,
      kind,
      status: 'PENDING',
    });
  }

  /**
   * Update node status
   */
  updateNodeStatus(id: string, status: NodeStatus, error?: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    const now = new Date();
    
    if (status === 'RUNNING' && !node.startTime) {
      node.startTime = now;
    }
    
    if (['SUCCESS', 'FAILED', 'CACHED', 'SKIPPED'].includes(status) && !node.endTime) {
      node.endTime = now;
    }

    node.status = status;
    if (error) {
      node.error = error;
    }

    this.render();
  }

  /**
   * Render the progress display
   */
  private render(): void {
    // Throttle updates
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateThrottleMs) {
      return;
    }
    this.lastUpdateTime = now;

    if (!this.options.verbose) {
      this.renderCompact();
    } else {
      this.renderDetailed();
    }
  }

  /**
   * Render compact progress (single line updates)
   */
  private renderCompact(): void {
    const stats = this.getStats();
    const total = this.nodes.size;
    const completed = stats.success + stats.cached + stats.failed + stats.skipped;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    const statusParts: string[] = [];
    if (stats.running > 0) statusParts.push(chalk.blue(`${stats.running} running`));
    if (stats.success > 0) statusParts.push(chalk.green(`${stats.success} success`));
    if (stats.cached > 0) statusParts.push(chalk.cyan(`${stats.cached} cached`));
    if (stats.failed > 0) statusParts.push(chalk.red(`${stats.failed} failed`));
    if (stats.skipped > 0) statusParts.push(chalk.yellow(`${stats.skipped} skipped`));

    const statusStr = statusParts.join(', ');
    const progressBar = this.createProgressBar(percentage, 30);
    
    // Clear line and write progress
    process.stdout.write('\r\x1b[K');
    process.stdout.write(`${progressBar} ${percentage}% (${completed}/${total}) ${statusStr}`);
  }

  /**
   * Render detailed progress (multi-line with node details)
   */
  private renderDetailed(): void {
    const running = Array.from(this.nodes.values()).filter(n => n.status === 'RUNNING');
    
    if (running.length > 0) {
      console.log(chalk.bold('\nCurrently running:'));
      running.forEach(node => {
        const duration = node.startTime ? this.formatDuration(Date.now() - node.startTime.getTime()) : '';
        const displayName = node.name || node.id;
        console.log(`  ${chalk.blue('●')} ${displayName} (${node.kind}) ${chalk.gray(duration)}`);
      });
    }
  }

  /**
   * Create a progress bar string
   */
  private createProgressBar(percentage: number, width: number): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return chalk.cyan(bar);
  }

  /**
   * Get statistics about node statuses
   */
  private getStats(): Record<string, number> {
    const stats = {
      pending: 0,
      running: 0,
      success: 0,
      cached: 0,
      failed: 0,
      skipped: 0,
    };

    this.nodes.forEach(node => {
      const status = node.status.toLowerCase();
      if (status in stats) {
        stats[status as keyof typeof stats]++;
      }
    });

    return stats;
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Print final summary
   */
  printSummary(): void {
    const stats = this.getStats();
    const totalDuration = Date.now() - this.startTime.getTime();

    // Clear the progress line
    if (!this.options.verbose) {
      process.stdout.write('\r\x1b[K');
    }

    console.log('');
    console.log(chalk.bold('Workflow Summary:'));
    console.log(chalk.gray('─'.repeat(50)));

    if (stats.success > 0) {
      console.log(chalk.green(`  ✓ ${stats.success} node(s) completed successfully`));
    }
    if (stats.cached > 0) {
      console.log(chalk.cyan(`  ⚡ ${stats.cached} node(s) used cache`));
    }
    if (stats.failed > 0) {
      console.log(chalk.red(`  ✗ ${stats.failed} node(s) failed`));
    }
    if (stats.skipped > 0) {
      console.log(chalk.yellow(`  ⊘ ${stats.skipped} node(s) skipped`));
    }

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.gray(`  Total duration: ${this.formatDuration(totalDuration)}`));

    // Print failed nodes with errors
    if (stats.failed > 0) {
      console.log('');
      console.log(chalk.red.bold('Failed Nodes:'));
      this.nodes.forEach(node => {
        if (node.status === 'FAILED') {
          const displayName = node.name || node.id;
          console.log(chalk.red(`  ✗ ${displayName}`));
          if (node.error) {
            console.log(chalk.gray(`    ${node.error}`));
          }
        }
      });
    }
  }

  /**
   * Print node details table
   */
  printNodeDetails(): void {
    console.log('');
    console.log(chalk.bold('Node Details:'));
    console.log(chalk.gray('─'.repeat(80)));

    const nodes = Array.from(this.nodes.values());
    nodes.forEach(node => {
      const displayName = (node.name || node.id).padEnd(25);
      const kind = node.kind.padEnd(8);
      const status = this.formatStatus(node.status).padEnd(15);
      const duration = node.startTime && node.endTime
        ? this.formatDuration(node.endTime.getTime() - node.startTime.getTime()).padEnd(10)
        : ''.padEnd(10);

      console.log(`  ${displayName} ${kind} ${status} ${duration}`);
    });

    console.log(chalk.gray('─'.repeat(80)));
  }

  /**
   * Format status with color
   */
  private formatStatus(status: NodeStatus): string {
    switch (status) {
      case 'PENDING':
        return chalk.gray('PENDING');
      case 'RUNNING':
        return chalk.blue('RUNNING');
      case 'SUCCESS':
        return chalk.green('SUCCESS');
      case 'CACHED':
        return chalk.cyan('CACHED');
      case 'FAILED':
        return chalk.red('FAILED');
      case 'SKIPPED':
        return chalk.yellow('SKIPPED');
      default:
        return status;
    }
  }

  /**
   * Log a node event
   */
  logNodeEvent(nodeId: string, event: string, details?: string): void {
    if (!this.options.verbose) return;

    const node = this.nodes.get(nodeId);
    const displayName = node?.name || nodeId;
    const timestamp = this.options.showTimestamps
      ? chalk.gray(`[${new Date().toISOString()}] `)
      : '';

    console.log(`${timestamp}${chalk.bold(displayName)}: ${event}${details ? ` - ${details}` : ''}`);
  }
}

