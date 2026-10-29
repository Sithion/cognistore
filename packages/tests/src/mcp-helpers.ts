import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The bundled MCP server, as npm ships it. Tests talk to the bundle, never to src/. */
export const MCP_ENTRY = resolve(__dirname, '../../../apps/mcp-server/dist/index.js');

export type McpLaunch = { command: string; args: string[] };

/** Launch spec for a local bundle (defaults to this checkout's). */
export const bundleLaunch = (entry = MCP_ENTRY): McpLaunch => ({ command: process.execPath, args: [entry] });

/**
 * Connect an MCP client over stdio. StdioClientTransport does NOT inherit
 * process.env, so the caller's overrides are merged onto it here.
 */
export async function connectMcp(launch: McpLaunch, env: NodeJS.ProcessEnv): Promise<Client> {
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'cognistore-tests', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/** Call a tool and parse its first text block as JSON (falls back to the raw text). */
export async function callJson(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; body: unknown }> {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
  const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* plain-text response */ }
  return { isError: res.isError === true, body };
}
