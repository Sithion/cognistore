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
