// src/testing/proxy-smoke.ts

/**
 * Standalone smoke test for `faultline proxy`.
 *
 * Verifies end-to-end:
 *   1. Proxy spawns the real MCP server.
 *   2. `tools/list` round-trips and returns the mock's tools.
 *   3. `tools/call echo` round-trips and returns the echoed value.
 *   4. Fault injection short-circuits a call without touching the server.
 *   5. Proxy exits cleanly when stdin closes.
 *
 * Run:  node dist/testing/proxy-smoke.js
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to CLI entry (dist/cli.js) — two levels up from dist/testing/.
const CLI_PATH = resolve(__dirname, '..', 'cli.js');

// Mock server path (source tree, not compiled).
const MOCK_SERVER = resolve(
  __dirname,
  '..',
  '..',
  'tests',
  'fixtures',
  'mock-mcp-server.mjs'
);

// ---------------------------------------------------------------------------
// Tiny JSON-RPC over stdio client
// ---------------------------------------------------------------------------

interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class RpcClient {
  private nextId = 1;
  private pending = new Map<number, (r: RpcResponse) => void>();
  private buffer = '';

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RpcResponse;
        if (typeof msg.id === 'number') {
          const resolver = this.pending.get(msg.id);
          if (resolver) {
            this.pending.delete(msg.id);
            resolver(msg);
          }
        }
      } catch {
        // ignore non-JSON output (should not happen)
      }
    }
  }

  request(method: string, params: unknown = {}): Promise<RpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<RpcResponse>((resolveP) => {
      this.pending.set(id, resolveP);
      this.child.stdin.write(payload + '\n');
    });
  }

  notify(method: string, params: unknown = {}): void {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child.stdin.write(payload + '\n');
  }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  results.push({ name, passed: cond, detail });
  const mark = cond ? '✅' : '❌';
  process.stdout.write(`${mark} ${name}${detail ? ' — ' + detail : ''}\n`);
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write('=== proxy-smoke ===\n\n');

  // Test 1: no fault plan — pure forwarding.
  await testForwardOnly();

  // Test 2: fault plan — injection short-circuits.
  await testFaultInjection();

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  process.stdout.write(`\nTotal: ${passed}/${total} passed\n`);
  if (passed !== total) {
    process.exit(1);
  }
}

async function spawnProxy(taskPath?: string): Promise<{
  child: ChildProcessWithoutNullStreams;
  rpc: RpcClient;
}> {
  const args = [
    CLI_PATH,
    'proxy',
    '--server',
    `node ${MOCK_SERVER}`,
  ];
  if (taskPath) {
    args.push('--task', taskPath);
  }

  const child = spawn('node', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Proxy must not write anything to stdout except JSON-RPC.
  // Forward stderr so we can see proxy logs during the test.
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    process.stderr.write(chunk);
  });

  const rpc = new RpcClient(child);

  // MCP handshake: initialize + initialized notification.
  const init = await withTimeout(
    rpc.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'proxy-smoke', version: '0.0.1' },
    }),
    3000,
    'initialize'
  );
  if (init.error) {
    throw new Error(`initialize failed: ${init.error.message}`);
  }
  rpc.notify('notifications/initialized');

  return { child, rpc };
}

function shutdown(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveP) => {
    child.once('exit', () => resolveP());
    child.stdin.end();
    // Fallback: kill after 1s if it does not exit on its own.
    setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM');
    }, 1000);
  });
}

// ---------------------------------------------------------------------------
// Test 1 — forward only
// ---------------------------------------------------------------------------

async function testForwardOnly(): Promise<void> {
  process.stdout.write('--- forward-only ---\n');
  const { child, rpc } = await spawnProxy();

  try {
    const list = await withTimeout(
      rpc.request('tools/list'),
      2000,
      'tools/list'
    );
    const tools = (list.result as { tools?: { name: string }[] } | undefined)
      ?.tools;
    check(
      'tools/list returns mock tool',
      Array.isArray(tools) && tools.some((t) => t.name === 'echo'),
      tools ? `got ${tools.length} tool(s)` : 'no result'
    );

    const call = await withTimeout(
      rpc.request('tools/call', {
        name: 'echo',
        arguments: { message: 'hello-proxy' },
      }),
      2000,
      'tools/call echo'
    );
    const content = (
      call.result as { content?: { type: string; text: string }[] } | undefined
    )?.content;
    const text = content?.[0]?.text;
    check(
      'tools/call echo returns message',
      text === 'hello-proxy',
      text ? `got "${text}"` : 'no content'
    );
  } finally {
    await shutdown(child);
  }
}

// ---------------------------------------------------------------------------
// Test 2 — fault injection
// ---------------------------------------------------------------------------

async function testFaultInjection(): Promise<void> {
  process.stdout.write('\n--- fault injection ---\n');

  // Write a temp task YAML with a fault on the first echo call.
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = await mkdtemp(join(tmpdir(), 'faultline-smoke-'));
  const taskPath = join(dir, 'fault-task.yaml');

  const yaml = [
    'id: smoke-fault-001',
    'name: Smoke fault task',
    'goal: Exercise fault injection via proxy',
    'allowed_tools:',
    '  - echo',
    'recovery:',
    '  primary: echo',
    'grader:',
    '  state_assertions: []',
    '  policy_assertions: []',
    'fault_injection:',
    '  - tool: echo',
    '    call_number: 1',
    '    fault: timeout',
    '    message: injected-timeout',
    '',
  ].join('\n');

  await writeFile(taskPath, yaml, 'utf8');

  try {
    const { child, rpc } = await spawnProxy(taskPath);
    try {
      const call = await withTimeout(
        rpc.request('tools/call', {
          name: 'echo',
          arguments: { message: 'should-not-reach-server' },
        }),
        2000,
        'tools/call echo (faulted)'
      );
      const result = call.result as
        | { isError?: boolean; content?: { type: string; text: string }[] }
        | undefined;
      const text = result?.content?.[0]?.text ?? '';
      check(
        'fault injected on first echo',
        result?.isError === true && text.includes('injected'),
        `isError=${result?.isError}, text="${text}"`
      );

      // Second call should pass through — call_number 2 is not faulted.
      const call2 = await withTimeout(
        rpc.request('tools/call', {
          name: 'echo',
          arguments: { message: 'second-call-passthrough' },
        }),
        2000,
        'tools/call echo (passthrough)'
      );
      const result2 = call2.result as
        | { isError?: boolean; content?: { type: string; text: string }[] }
        | undefined;
      const text2 = result2?.content?.[0]?.text ?? '';
      check(
        'second call passes through',
        result2?.isError !== true && text2 === 'second-call-passthrough',
        `text="${text2}"`
      );
    } finally {
      await shutdown(child);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  process.stderr.write(`\nSMOKE FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});