import { createHash } from 'crypto';

export function hashInputs(payload: unknown): string {
  const h = createHash('sha256');
  h.update(JSON.stringify(payload, null, 0));
  return h.digest('hex');
}

export async function hashFile(filepath: string): Promise<string> {
  const fs = await import('fs/promises');
  const content = await fs.readFile(filepath);
  const h = createHash('sha256');
  h.update(content);
  return h.digest('hex');
}
