import { Agent } from './types';
import { CursorAgent } from './cursor';
import { AugieAgent } from './augie';
import { CloudCodeAgent } from './cloud-code';

export class AgentRegistry {
  private agents: Map<string, Agent> = new Map();

  constructor() {
    this.register(new CursorAgent());
    this.register(new AugieAgent());
    this.register(new CloudCodeAgent());
  }

  register(agent: Agent): void {
    this.agents.set(agent.name, agent);
  }

  get(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  list(): string[] {
    return Array.from(this.agents.keys());
  }
}
