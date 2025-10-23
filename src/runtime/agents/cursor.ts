import { Agent, AgentContext, AgentResult } from './types';

export class CursorAgent implements Agent {
  name = 'cursor';

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { prompt, inputs, log } = ctx;
    
    log(`[Cursor Agent] Running with prompt: ${prompt.substring(0, 100)}...`);
    log(`[Cursor Agent] Inputs: ${JSON.stringify(inputs)}`);

    const result = {
      agent: 'cursor',
      prompt,
      inputs,
      response: 'This is a stub implementation of the Cursor agent. Integrate with actual Cursor CLI or API.',
    };

    return {
      result,
      logs: ['Cursor agent executed (stub)'],
      createdArtifacts: [],
    };
  }
}
