import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import '../../../../apps/dashboard/src/i18n/index.js';
import { api, type SetupStatus } from '../../../../apps/dashboard/src/api/client.js';
import { AgentReadinessSection } from '../../../../apps/dashboard/src/pages/SettingsPage.js';
import { StatusBadge } from '../../../../apps/dashboard/src/settings/SettingsLayout.js';
import { settingsCopy } from '../../../../apps/dashboard/src/i18n/settings-v261.js';

const copy = settingsCopy.en;

const setup: SetupStatus = {
  nodeReady: true,
  sdkReady: false,
  configsReady: true,
  databaseReady: false,
  ollamaInstalled: true,
  ollamaRunning: false,
  modelAvailable: true,
  allReady: false,
};

const checks = [
  ['nodeReady', copy.nodeRuntime],
  ['sdkReady', copy.sdk],
  ['configsReady', copy.agentConfiguration],
  ['databaseReady', copy.databaseSetup],
  ['ollamaInstalled', copy.ollamaInstalled],
  ['ollamaRunning', copy.ollamaReachable],
  ['modelAvailable', copy.embeddingModel],
] as const;

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

function mountReadiness() {
  return render(createElement(MemoryRouter, null, createElement(AgentReadinessSection)));
}

describe('settings status for 2.6.1', () => {
  it.each([
    ['ok', 'text-success', 'Ready', 'lucide-circle-check'],
    ['error', 'text-destructive', 'Not ready', 'lucide-circle-x'],
    ['unknown', 'text-muted-foreground', 'Unknown', 'lucide-circle-dashed'],
  ] as const)('renders an accessible %s badge', (status, color, label, iconClass) => {
    const { container } = render(createElement(StatusBadge, { status, label }));
    const badge = screen.getByText(label);
    expect(badge.tagName).toBe('SPAN');
    expect(badge.classList.contains(color)).toBe(true);
    expect(badge.classList.contains('inline-flex')).toBe(true);
    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('aria-hidden')).toBe('true');
    expect(icons[0].classList.contains('size-4')).toBe(true);
    expect(icons[0].classList.contains(iconClass)).toBe(true);
  });

  it('renders one readiness row per API check with its matching badge', async () => {
    vi.spyOn(api, 'getSetupStatus').mockResolvedValue(setup);
    mountReadiness();

    await waitFor(() => expect(screen.getAllByText(copy.ready)).toHaveLength(4));
    const card = screen.getByRole('region', { name: copy.readiness });
    expect(within(card).getAllByText(copy.notReady)).toHaveLength(3);
    expect(within(card).getByText(copy.readinessDesc)).toBeTruthy();

    for (const [key, label] of checks) {
      const labelElement = within(card).getByText(label);
      const row = labelElement.parentElement?.parentElement;
      expect(row).toBeTruthy();
      expect(within(row!).getByText(setup[key] ? copy.ready : copy.notReady)).toBeTruthy();
      expect(row!.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    }

    expect(card.querySelector('dl')).toBeNull();
    expect(within(card).getByRole('link', { name: copy.advancedSettings }).getAttribute('href'))
      .toBe('/settings/advanced');
    expect(api.getSetupStatus).toHaveBeenCalledTimes(1);
  });

  it('refreshes readiness through the existing API action', async () => {
    const getStatus = vi.spyOn(api, 'getSetupStatus')
      .mockResolvedValueOnce(setup)
      .mockResolvedValueOnce({
        ...setup,
        sdkReady: true,
        databaseReady: true,
        ollamaRunning: true,
        allReady: true,
      });
    mountReadiness();

    await waitFor(() => expect(screen.getAllByText(copy.notReady)).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: copy.refreshReadiness }));
    await waitFor(() => expect(screen.getAllByText(copy.ready)).toHaveLength(7));
    expect(screen.queryByText(copy.notReady)).toBeNull();
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('announces readiness loading and failure without marking checks ready', async () => {
    let rejectStatus!: (reason: Error) => void;
    vi.spyOn(api, 'getSetupStatus').mockImplementation(() => new Promise<SetupStatus>((_resolve, reject) => {
      rejectStatus = reject;
    }));
    mountReadiness();

    expect(screen.getByRole('status').textContent).toBe(copy.loadingReadiness);
    expect(screen.getAllByText(copy.unknown)).toHaveLength(7);
    rejectStatus(new Error('offline'));

    expect((await screen.findByRole('alert')).textContent).toBe(copy.readinessFailed);
    expect(screen.getAllByText(copy.unknown)).toHaveLength(7);
    expect(screen.queryByText(copy.ready)).toBeNull();
    expect(screen.getByRole('button', { name: copy.refreshReadiness })).toBeTruthy();
  });
});
