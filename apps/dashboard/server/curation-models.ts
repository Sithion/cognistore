import {
  isValidOllamaModelName, patchSettingsAsync, readSettingsAsync, type AppSettings,
} from './settings.js';

export const RECOMMENDED_CURATION_MODEL = 'qwen2.5:7b-instruct';
const recommendation = 'Use qwen2.5:7b-instruct with sufficient RAM; retain an installed llama3.2:3b fallback.';
export interface ModelTransport {
  available(model: string): Promise<boolean>;
  pull(model: string): Promise<void>;
  remove(model: string): Promise<void>;
}
export function ollamaModels(host = process.env.OLLAMA_HOST ?? 'http://localhost:11434'): ModelTransport {
  const request = async (path: string, body?: unknown, timeout = 30_000) => {
    const response = await fetch(`${host}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`Ollama unavailable (${response.status})`);
    return response;
  };
  return {
    async available(model) {
      const data = await (await request('/api/tags')).json() as { models?: { name: string }[] };
      if (!Array.isArray(data.models)) throw new Error('Invalid Ollama model inventory');
      return data.models.some(m => m.name === model || m.name === `${model}:latest`);
    },
    async pull(model) {
      if (!isValidOllamaModelName(model)) throw new Error('Invalid model name');
      const data = await (await request('/api/pull', { name: model, stream: false }, 30 * 60_000)).json() as { error?: string; status?: string };
      if (data.error || data.status !== 'success') throw new Error('Ollama model installation failed');
    },
    async remove(model) {
      if (!isValidOllamaModelName(model)) throw new Error('Invalid model name');
      const response = await fetch(`${host}/api/delete`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }), signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok && response.status !== 404) throw new Error(`Ollama removal failed (${response.status})`);
    },
  };
}

export function canonicalModelName(model: string): string {
  if (!isValidOllamaModelName(model)) throw Object.assign(new Error('Invalid model name'), { statusCode: 400 });
  return model.includes(':') ? model : `${model}:latest`;
}

type Owner = 'curation' | 'cleanup';
type SettingsWriter = typeof patchSettingsAsync;
/** One queue covers both preview and explicit preparation, including model switches. */
export function createModelManager(deps: {
  transport: ModelTransport;
  read?: () => Promise<AppSettings>;
  write?: SettingsWriter;
}) {
  const read = deps.read ?? readSettingsAsync, write = deps.write ?? patchSettingsAsync;
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  const prepare = (model: string, owner: Owner = 'curation', allowPull = true) => {
    if (disposed) return Promise.reject(Object.assign(new Error('Model preparation is shutting down'), { statusCode: 503 }));
    const operation = async () => {
      model = canonicalModelName(model);
      const key = owner === 'curation' ? 'installedCurationModels' : 'installedCleanupModels';
      const settings = await read();
      const pending = settings.pendingModelInstallations.includes(model);
      const available = await deps.transport.available(model);
      if (!available && !allowPull) return { model, available: false, installed: false, recommendedModel: RECOMMENDED_CURATION_MODEL, recommendation };
      if (!available || pending) {
        // Durable intent precedes the external side effect. After a crash or a
        // failed final write, the next prepare can reconcile an existing pull.
        if (!pending) await write(current => ({ pendingModelInstallations: [...current.pendingModelInstallations, model] }), { manageInstalledModels: true });
        if (!available) await deps.transport.pull(model);
        await write(current => ({
          [key]: [...current[key], model],
          pendingModelInstallations: current.pendingModelInstallations.filter(name => name !== model),
        }), { manageInstalledModels: true });
      }
      return { model, available: true, installed: !available || pending, recommendedModel: RECOMMENDED_CURATION_MODEL, recommendation };
    };
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };
  return { prepare, async settled() { await queue; }, async dispose() { disposed = true; await queue; } };
}

/** Include recoverable pulls, never selections or legacy unrecorded models. */
export function ownedModelNames(settings: AppSettings): string[] {
  return [...new Set([
    ...settings.installedCleanupModels, ...settings.installedCurationModels, ...settings.pendingModelInstallations,
  ].filter(isValidOllamaModelName).map(canonicalModelName))];
}
export async function removeOwnedModels(settings: AppSettings, transport: ModelTransport, exclude: string[] = []): Promise<string[]> {
  const removed: string[] = [];
  for (const name of ownedModelNames(settings)) {
    if (exclude.includes(name)) continue;
    await transport.remove(name);
    removed.push(name);
  }
  return removed;
}
export const modelManager = createModelManager({ transport: ollamaModels() });
