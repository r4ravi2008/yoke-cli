import { promises as fs } from 'fs';
import path from 'path';
import { NodeOutput } from '../graph/state';

export class CacheStore {
  private cacheDir: string;

  constructor(cacheDir: string = './cache') {
    this.cacheDir = cacheDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  async get(key: string): Promise<NodeOutput | null> {
    const cachePath = path.join(this.cacheDir, `${key}.json`);
    try {
      const content = await fs.readFile(cachePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async put(key: string, value: NodeOutput): Promise<void> {
    const cachePath = path.join(this.cacheDir, `${key}.json`);
    await fs.writeFile(cachePath, JSON.stringify(value, null, 2));
  }

  async has(key: string): Promise<boolean> {
    const cachePath = path.join(this.cacheDir, `${key}.json`);
    try {
      await fs.access(cachePath);
      return true;
    } catch {
      return false;
    }
  }
}
