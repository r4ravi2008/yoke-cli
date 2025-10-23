import { promises as fs } from 'fs';
import path from 'path';
import { NodeOutput, NodeStatus } from '../graph/state';

export interface RunMetadata {
  workflowName: string;
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

  constructor(runDir: string, workflowName: string) {
    this.runDir = runDir;
    this.metadata = {
      workflowName,
      startTime: new Date().toISOString(),
      status: 'running',
      nodes: {},
    };
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

  static async load(runDir: string): Promise<RunMetadata> {
    const runFile = path.join(runDir, 'run.json');
    const content = await fs.readFile(runFile, 'utf8');
    return JSON.parse(content);
  }
}
