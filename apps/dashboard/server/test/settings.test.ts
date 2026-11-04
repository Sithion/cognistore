import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalHome = process.env.HOME;
const originalCognistoreHome = process.env.COGNISTORE_HOME;
let testHome: string | undefined;

async function loadSettings() {
  vi.resetModules();
  testHome = mkdtempSync(join(tmpdir(), 'cognistore-dashboard-settings-'));
  process.env.HOME = testHome;
  // settings.ts prefers COGNISTORE_HOME over HOME; never let it reach a real install.
  delete process.env.COGNISTORE_HOME;
  return import('../settings.js');
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalCognistoreHome === undefined) delete process.env.COGNISTORE_HOME;
  else process.env.COGNISTORE_HOME = originalCognistoreHome;
  if (testHome) rmSync(testHome, { recursive: true, force: true });
  testHome = undefined;
  vi.resetModules();
});

describe('settings defaults and persistence', () => {
  it('returns defaults when the settings file does not exist', async () => {
    const settings = await loadSettings();
    expect(settings.readSettings()).toEqual(settings.SETTINGS_DEFAULTS);
    expect(settings.INSTALL_DIR).toBe(join(testHome!, '.cognistore'));
  });

  it('writes a patch and reads the merged settings back', async () => {
    const settings = await loadSettings();
    const result = settings.writeSettings({ autoUpdate: true, dateRangePreset: '1m', cleanupIntervalDays: 21 });
    expect(result.autoUpdate).toBe(true);
    expect(result.cleanupIntervalDays).toBe(21);
    expect(settings.readSettings()).toEqual(result);
  });

  it('returns defaults when persisted JSON is malformed', async () => {
    const settings = await loadSettings();
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(settings.INSTALL_DIR, { recursive: true });
    writeFileSync(settings.SETTINGS_FILE, '{invalid json');
    expect(settings.readSettings()).toEqual(settings.SETTINGS_DEFAULTS);
  });
});

describe('sanitizeSettings', () => {
  it('curation defaults to suggest and clamps every budget and retention setting', async () => {
    const { sanitizeSettings, SETTINGS_DEFAULTS } = await loadSettings();
    expect(SETTINGS_DEFAULTS.curationAutonomy).toBe('suggest');
    expect(sanitizeSettings({ curationBudgetMs:0,curationMaxClusters:9999,curationMaxItems:0,curationTrashRetentionDays:99999,curationClusterThreshold:0,curationDeprecatedUnreadDays:1,curationIdleMinutes:9999,curationMinIntervalHours:1 } as any)).toMatchObject({
      curationBudgetMs:1000,curationMaxClusters:500,curationMaxItems:1,curationTrashRetentionDays:3650,curationClusterThreshold:0.8,curationDeprecatedUnreadDays:30,curationIdleMinutes:1440,curationMinIntervalHours:24,
    });
  });

  it('curation model ownership is validated and cannot be forged by public patches', async () => {
    const settings=await loadSettings();
    settings.writeSettings({installedCurationModels:['llama3.2:3b','--bad','llama3.2:3b'] as any});
    expect(settings.readSettings().installedCurationModels).toEqual([]);
    await settings.patchSettingsAsync({installedCurationModels:['llama3.2:3b','--bad','llama3.2:3b'] as any},{manageInstalledModels:true});
    expect(settings.readSettings().installedCurationModels).toEqual(['llama3.2:3b']);
  });

  it('async settings patches serialize without losing unrelated values', async () => {
    const settings=await loadSettings();
    await Promise.all([settings.patchSettingsAsync({curationIdleMinutes:30}),settings.patchSettingsAsync({autoUpdate:true})]);
    expect(settings.readSettings()).toMatchObject({curationIdleMinutes:30,autoUpdate:true});
  });

  it('drops invalid enum members and deduplicates created config files', async () => {
    const { sanitizeSettings } = await loadSettings();
    expect(sanitizeSettings({ createdConfigFiles: ['claude-settings', 'bogus', 'claude-settings', 'opencode-config'] as any }).createdConfigFiles)
      .toEqual(['claude-settings', 'opencode-config']);
    expect(sanitizeSettings({ createdConfigFiles: 'claude-settings' as any }).createdConfigFiles).toEqual([]);
  });

  it('strictly coerces security flags and bounds cleanup values', async () => {
    const { sanitizeSettings, SETTINGS_DEFAULTS } = await loadSettings();
    const clean = sanitizeSettings({
      allowStdioProviders: 'yes' as any,
      allowInsecureProviderUrls: true,
      installedOllama: 1 as any,
      cleanupEnabled: '' as any,
      cleanupIntervalDays: 0,
      cleanupUnreadDays: 99999,
      cleanupDupThreshold: 0.5,
      cleanupLlmModel: '--flag;rm',
      lastCleanupReportAt: 'not a date',
    });
    expect(clean).toMatchObject({
      allowStdioProviders: false,
      allowInsecureProviderUrls: true,
      installedOllama: false,
      cleanupEnabled: false,
      cleanupIntervalDays: 1,
      cleanupUnreadDays: 3650,
      cleanupDupThreshold: 0.8,
      cleanupLlmModel: SETTINGS_DEFAULTS.cleanupLlmModel,
      lastCleanupReportAt: null,
    });
  });

  it('rounds integer settings, clamps the upper bounds, and preserves unknown keys', async () => {
    const { sanitizeSettings } = await loadSettings();
    expect(sanitizeSettings({ cleanupIntervalDays: 2.6, cleanupUnreadDays: 20, cleanupDupThreshold: 2, extraPreference: 'kept' } as any))
      .toMatchObject({ cleanupIntervalDays: 3, cleanupUnreadDays: 30, cleanupDupThreshold: 1, extraPreference: 'kept' });
  });

  it('validates model references and normalizes invalid cleanup timestamps', async () => {
    const { isValidOllamaModelName, sanitizeSettings, SETTINGS_DEFAULTS } = await loadSettings();
    expect(isValidOllamaModelName('llama3.2:3b')).toBe(true);
    expect(isValidOllamaModelName('-bad')).toBe(false);
    expect(isValidOllamaModelName('x'.repeat(101))).toBe(false);
    expect(sanitizeSettings({ cleanupLlmModel: '', lastCleanupReportAt: 12 as any })).toMatchObject({
      cleanupLlmModel: SETTINGS_DEFAULTS.cleanupLlmModel,
      lastCleanupReportAt: null,
    });
  });
});
