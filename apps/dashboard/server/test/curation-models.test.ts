import { describe, expect, it, vi } from 'vitest';
import { createModelManager, ownedModelNames, removeOwnedModels } from '../curation-models.js';
import { SETTINGS_DEFAULTS, sanitizeSettings, type AppSettings, type patchSettingsAsync } from '../settings.js';
function harness(initial: string[] = []) {
  let settings: AppSettings = structuredClone(SETTINGS_DEFAULTS);
  const present = new Set(initial);
  const transport = {
    available: vi.fn(async (model: string) => present.has(model)),
    pull: vi.fn(async (model: string) => { present.add(model); }),
    remove: vi.fn(async (model: string) => { present.delete(model); }),
  };
  let failFinal = false;
  const write: typeof patchSettingsAsync = async (patch) => {
    const value = typeof patch === 'function' ? patch(settings) : patch;
    if (failFinal && ('installedCurationModels' in value || 'installedCleanupModels' in value)) throw new Error('disk full');
    settings = { ...settings, ...sanitizeSettings(value) };
    return structuredClone(settings);
  };
  const deps = { transport, read: async () => structuredClone(settings), write };
  return { deps, transport, settings: () => settings, fail(value: boolean) { failFinal = value; } };
}
describe('curation model ownership', () => {
  it('model preparation records only installations made by CogniStore', async () => {
    const h = harness(['existing:3b']), manager = createModelManager(h.deps);
    expect(await manager.prepare('existing:3b')).toMatchObject({ installed: false });
    expect(h.settings().installedCurationModels).toEqual([]);
    await Promise.all([manager.prepare('qwen2.5:7b-instruct'), manager.prepare('qwen2.5:7b-instruct')]);
    expect(h.transport.pull).toHaveBeenCalledTimes(1);
    expect(h.settings().installedCurationModels).toEqual(['qwen2.5:7b-instruct']);
    await expect(manager.prepare('--invalid')).rejects.toThrow(/Invalid/);
    expect(h.transport.pull).toHaveBeenCalledTimes(1);
  });
  it('model switches preserve ownership and uninstall removes each owned model once', async () => {
    const h = harness(), manager = createModelManager(h.deps);
    await manager.prepare('first:3b');
    await manager.prepare('second:7b');
    await manager.prepare('first:3b', 'cleanup');
    expect(h.settings().installedCurationModels).toEqual(['first:3b', 'second:7b']);
    const settings = h.settings();
    settings.installedCleanupModels = ['first:3b', 'first:3b', '--invalid'];
    expect(await removeOwnedModels(settings, h.transport)).toEqual(['first:3b','second:7b']);
    expect(h.transport.remove).toHaveBeenCalledTimes(2);
  });
  it('pre-existing shared models survive preview and uninstall', async () => {
    const h = harness(['llama3.2:3b']), manager = createModelManager(h.deps);
    await manager.prepare('llama3.2:3b', 'cleanup');
    await manager.prepare('llama3.2:3b', 'curation');
    expect(await removeOwnedModels(h.settings(), h.transport)).toEqual([]);
    expect(h.transport.remove).not.toHaveBeenCalled();
    expect(await manager.prepare('qwen2.5:7b-instruct', 'cleanup', false)).toMatchObject({ available: false });
    expect(h.transport.pull).not.toHaveBeenCalled();
  });
  it('failed ownership persistence is recoverable without an untracked installation', async () => {
    const h = harness();
    h.fail(true);
    await expect(createModelManager(h.deps).prepare('recoverable:3b')).rejects.toThrow('disk full');
    expect(h.settings().pendingModelInstallations).toEqual(['recoverable:3b']);
    expect(ownedModelNames(h.settings())).toEqual(['recoverable:3b']);
    h.fail(false);
    // A new manager simulates process restart after the pull succeeded.
    await createModelManager(h.deps).prepare('recoverable:3b');
    expect(h.transport.pull).toHaveBeenCalledTimes(1);
    expect(h.settings().pendingModelInstallations).toEqual([]);
    expect(h.settings().installedCurationModels).toEqual(['recoverable:3b']);
    const failure = harness();
    failure.deps.write = async () => { throw new Error('intent write failed'); };
    await expect(createModelManager(failure.deps).prepare('never:3b')).rejects.toThrow(/intent/);
    expect(failure.transport.pull).not.toHaveBeenCalled();
  });
});

it('uninstall deduplicates default-tag aliases and preserves the embedding policy exclusion', async () => {
  const h = harness();
  const settings = h.settings();
  settings.installedCurationModels = ['shared', 'embedding:latest'];
  settings.installedCleanupModels = ['shared:latest', '--invalid'];
  expect(await removeOwnedModels(settings, h.transport, ['embedding:latest'])).toEqual(['shared:latest']);
  expect(h.transport.remove).toHaveBeenCalledTimes(1);
});
