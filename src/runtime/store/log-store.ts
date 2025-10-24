/**
 * JSONL log store for append-only structured logging
 */

import { promises as fs } from 'fs';
import path from 'path';
import { LogEntry } from '../util/logger';

export interface WorkflowLogEntry extends LogEntry {
  runId?: string;
  workflowName?: string;
}

export interface NodeEventLogEntry {
  timestamp: string;
  runId?: string;
  workflowName?: string;
  eventType: 'node_started' | 'node_completed' | 'node_failed' | 'node_cached' | 'node_skipped';
  nodeId: string;
  nodeName?: string;
  nodeKind?: string;
  duration?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type LogStoreEntry = WorkflowLogEntry | NodeEventLogEntry;

export class LogStore {
  private logFilePath: string;
  private writeStream?: fs.FileHandle;
  private runId?: string;
  private workflowName?: string;

  constructor(runDir: string, runId?: string, workflowName?: string) {
    this.logFilePath = path.join(runDir, 'workflow.log.jsonl');
    this.runId = runId;
    this.workflowName = workflowName;
  }

  async init(): Promise<void> {
    // Ensure the directory exists
    await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
    
    // Open file for appending
    this.writeStream = await fs.open(this.logFilePath, 'a');
    
    // Write initial log entry
    await this.writeEntry({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Workflow execution started',
      runId: this.runId,
      workflowName: this.workflowName,
    });
  }

  async close(): Promise<void> {
    if (this.writeStream) {
      await this.writeStream.close();
      this.writeStream = undefined;
    }
  }

  /**
   * Write a log entry to the JSONL file
   */
  async writeEntry(entry: LogStoreEntry): Promise<void> {
    if (!this.writeStream) {
      throw new Error('LogStore not initialized. Call init() first.');
    }

    const line = JSON.stringify(entry) + '\n';
    await this.writeStream.write(line, 0, 'utf-8');
  }

  /**
   * Write a structured log entry
   */
  async writeLog(entry: LogEntry): Promise<void> {
    await this.writeEntry({
      ...entry,
      runId: this.runId,
      workflowName: this.workflowName,
    });
  }

  /**
   * Write a node event
   */
  async writeNodeEvent(event: Omit<NodeEventLogEntry, 'timestamp' | 'runId' | 'workflowName'>): Promise<void> {
    await this.writeEntry({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      workflowName: this.workflowName,
      ...event,
    });
  }

  /**
   * Read all log entries from the file
   */
  static async readLogs(logFilePath: string): Promise<LogStoreEntry[]> {
    try {
      const content = await fs.readFile(logFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      return lines
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Read logs from a run directory
   */
  static async readRunLogs(runDir: string): Promise<LogStoreEntry[]> {
    const logFilePath = path.join(runDir, 'workflow.log.jsonl');
    return LogStore.readLogs(logFilePath);
  }

  /**
   * Filter logs by level
   */
  static filterByLevel(logs: LogStoreEntry[], level: string): LogStoreEntry[] {
    return logs.filter(entry => 'level' in entry && entry.level === level);
  }

  /**
   * Filter logs by node ID
   */
  static filterByNode(logs: LogStoreEntry[], nodeId: string): LogStoreEntry[] {
    return logs.filter(entry => 
      ('nodeId' in entry && entry.nodeId === nodeId)
    );
  }

  /**
   * Get node events only
   */
  static getNodeEvents(logs: LogStoreEntry[]): NodeEventLogEntry[] {
    return logs.filter(entry => 'eventType' in entry) as NodeEventLogEntry[];
  }

  /**
   * Get workflow logs only
   */
  static getWorkflowLogs(logs: LogStoreEntry[]): WorkflowLogEntry[] {
    return logs.filter(entry => 'level' in entry) as WorkflowLogEntry[];
  }
}

