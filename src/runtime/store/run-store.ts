import { promises as fs } from 'fs';
import path from 'path';
import { NodeOutput, NodeStatus } from '../graph/state';

export interface RunMetadata {
  workflowName: string;
  threadId: string;
  checkpointDbPath: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'success' | 'failed';
  nodes: Record<string, {
    status: NodeStatus;
    startTime?: string;
    endTime?: string;
    duration?: number;
    output?: NodeOutput;
    error?: string;
  }>;
}

export class RunStore {
  private runDir: string;
  private metadata: RunMetadata;

  constructor(runDir: string, workflowName: string, threadId?: string) {
    this.runDir = runDir;
    this.metadata = {
      workflowName,
      threadId: threadId || this.generateThreadId(),
      checkpointDbPath: path.join(runDir, 'checkpoints.db'),
      startTime: new Date().toISOString(),
      status: 'running',
      nodes: {},
    };
  }

  private generateThreadId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `run-${timestamp}-${random}`;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.runDir, { recursive: true });
    await fs.mkdir(path.join(this.runDir, 'artifacts'), { recursive: true });
    await this.save();
  }

  async setNodeStatus(nodeId: string, status: NodeStatus): Promise<void> {
    if (!this.metadata.nodes[nodeId]) {
      this.metadata.nodes[nodeId] = { status, startTime: new Date().toISOString() };
    } else {
      this.metadata.nodes[nodeId].status = status;
      if (status === 'SUCCESS' || status === 'FAILED' || status === 'CACHED') {
        this.metadata.nodes[nodeId].endTime = new Date().toISOString();
        if (this.metadata.nodes[nodeId].startTime) {
          const start = new Date(this.metadata.nodes[nodeId].startTime!).getTime();
          const end = new Date(this.metadata.nodes[nodeId].endTime!).getTime();
          this.metadata.nodes[nodeId].duration = end - start;
        }
      }
    }
    await this.save();
  }

  async setNodeOutput(nodeId: string, output: NodeOutput): Promise<void> {
    if (!this.metadata.nodes[nodeId]) {
      this.metadata.nodes[nodeId] = { status: 'SUCCESS' };
    }
    this.metadata.nodes[nodeId].output = output;
    await this.save();
  }

  async setNodeError(nodeId: string, error: string): Promise<void> {
    if (!this.metadata.nodes[nodeId]) {
      this.metadata.nodes[nodeId] = { status: 'FAILED' };
    }
    this.metadata.nodes[nodeId].error = error;
    this.metadata.nodes[nodeId].status = 'FAILED';
    await this.save();
  }

  async complete(status: 'success' | 'failed'): Promise<void> {
    this.metadata.endTime = new Date().toISOString();
    this.metadata.status = status;
    await this.save();
  }

  async save(): Promise<void> {
    // Ensure directory exists before saving
    await fs.mkdir(this.runDir, { recursive: true });
    const runFile = path.join(this.runDir, 'run.json');
    await fs.writeFile(runFile, JSON.stringify(this.metadata, null, 2));
  }

  async writeArtifact(relativePath: string, data: Buffer | string): Promise<string> {
    const artifactPath = path.join(this.runDir, 'artifacts', relativePath);
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, data);
    return artifactPath;
  }

  getRunDir(): string {
    return this.runDir;
  }

  getMetadata(): RunMetadata {
    return this.metadata;
  }

  getThreadId(): string {
    return this.metadata.threadId;
  }

  getCheckpointDbPath(): string {
    return this.metadata.checkpointDbPath;
  }

  static async load(runDir: string): Promise<RunMetadata> {
    const runFile = path.join(runDir, 'run.json');
    const content = await fs.readFile(runFile, 'utf8');
    return JSON.parse(content);
  }

  static async loadForResume(runDir: string): Promise<RunStore> {
    const metadata = await RunStore.load(runDir);
    const store = new RunStore(runDir, metadata.workflowName, metadata.threadId);
    store.metadata = metadata;
    // Ensure directory structure exists (in case it was deleted)
    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(path.join(runDir, 'artifacts'), { recursive: true });
    return store;
  }
}
