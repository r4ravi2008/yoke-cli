import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { hashInputs } from '../util/hash';
import { NodeOutput } from '../graph/state';
import { ExecNode } from '../../schema/types';

export interface ExecContext {
  cacheGet: (key: string) => Promise<NodeOutput | null>;
  cachePut: (key: string, val: NodeOutput) => Promise<void>;
  log: (msg: string) => void;
}

export async function runExec(
  spec: ExecNode,
  ctx: ExecContext
): Promise<NodeOutput> {
  const key = hashInputs({
    kind: 'exec',
    command: spec.command,
    args: spec.args || [],
    cwd: spec.cwd || process.cwd(),
    env: spec.env || {},
    produces: spec.produces,
  });

  if (spec.deterministic !== false) {
    const hit = await ctx.cacheGet(key);
    if (hit) {
      ctx.log(`[Exec] Cache hit for ${spec.command}`);
      return { ...hit, hash: key, cached: true };
    }
  }

  const { command, args = [], cwd = process.cwd(), env = {} } = spec;
  
  ctx.log(`[Exec] Running: ${command} ${args.join(' ')}`);

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (d) => stdout.push(Buffer.from(d)));
  child.stderr.on('data', (d) => stderr.push(Buffer.from(d)));

  const exitCode = await new Promise<number>((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | null = null;
    
    if (spec.timeout && spec.timeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`exec timeout after ${spec.timeout}ms`));
      }, spec.timeout);
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve(code ?? -1);
    });
  });

  const stdoutStr = Buffer.concat(stdout).toString().trim();
  const stderrStr = Buffer.concat(stderr).toString().trim();

  ctx.log(`[Exec] Exit code: ${exitCode}`);
  if (stdoutStr) ctx.log(`[Exec] Stdout: ${stdoutStr.substring(0, 200)}`);
  if (stderrStr) ctx.log(`[Exec] Stderr: ${stderrStr.substring(0, 200)}`);

  if (exitCode !== 0) {
    throw new Error(
      `exec failed (${exitCode}): ${command} ${args.join(' ')}\n${stderrStr}`
    );
  }

  const artifacts: string[] = [];
  if (spec.produces?.files?.length) {
    for (const f of spec.produces.files) {
      const p = path.resolve(f);
      try {
        await fs.access(p);
        artifacts.push(p);
      } catch (error) {
        throw new Error(`Expected file ${f} was not produced`);
      }
    }
  }

  let result: unknown = { 
    stdout: stdoutStr,
    stderr: stderrStr,
    exitCode 
  };

  if (spec.produces?.json?.resultFromFile) {
    const p = path.resolve(spec.produces.json.resultFromFile);
    const text = await fs.readFile(p, 'utf8');
    result = JSON.parse(text);
  }

  const output: NodeOutput = {
    result,
    artifacts,
    hash: key,
    cached: false,
  };

  if (spec.deterministic !== false) {
    await ctx.cachePut(key, output);
  }

  return output;
}
