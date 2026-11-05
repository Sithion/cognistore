import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import '../../../../apps/dashboard/src/i18n/index.js';
import { App } from '../../../../apps/dashboard/src/App.js';
import { api, ApiError } from '../../../../apps/dashboard/src/api/client.js';
import { DataManagementSection } from '../../../../apps/dashboard/src/pages/SettingsPage.js';
import { ProvidersSection } from '../../../../apps/dashboard/src/components/ProvidersSection.js';
import { Toaster } from '../../../../apps/dashboard/src/components/ui/sonner.js';

beforeEach(async () => {
  vi.stubGlobal('__APP_VERSION__', '2.6.1-test');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network request'); }));
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  await i18n.changeLanguage('en');
  window.history.replaceState(null, '', '/');
  vi.spyOn(api, 'getSetupStatus').mockResolvedValue({ allReady: true } as any);
  vi.spyOn(api, 'checkUpgrade').mockResolvedValue({
    needsUpgrade: false, fromVersion: null, toVersion: '2.6.1', isFirstInstall: false,
  });
  vi.spyOn(api, 'getCurationOverview').mockResolvedValue({ pending: 0 } as any);
  vi.spyOn(api, 'getSettings').mockResolvedValue({} as any);
  vi.spyOn(api, 'listScopes').mockResolvedValue([]);
  vi.spyOn(api, 'listProviders').mockResolvedValue({ providers: [] } as any);
  vi.spyOn(api, 'listRecent').mockResolvedValue([]);
  vi.spyOn(api, 'listPlans').mockResolvedValue([]);
  vi.spyOn(api, 'getStats').mockResolvedValue({ byScope: [] } as any);
  vi.spyOn(api, 'getKnowledgePlans').mockResolvedValue([]);
});

afterEach(() => { vi.unstubAllGlobals(); });

function mountApp(path: string, withToasts = false) {
  window.history.replaceState(null, '', path);
  return render(createElement('div', null,
    createElement(App),
    withToasts ? createElement(Toaster) : null));
}

const currentUrl = () => window.location.pathname + window.location.search;

describe('unknown routes', () => {
  it.each(['/not-a-real-route', '/nope/xyz'])('renders a useful fallback at %s', async path => {
    mountApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(screen.getByText('The page you requested does not exist.')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Back to knowledge' }));
    await waitFor(() => expect(currentUrl()).toBe('/knowledge'));
  });
});

describe('missing details', () => {
  it.each([
    ['/knowledge/missing', 'knowledge', '/knowledge', 'Knowledge entry not found.'],
    ['/knowledge?edit=missing', 'knowledge', '/knowledge', 'Knowledge entry not found.'],
    ['/plans/missing', 'plan', '/plans', 'Plan not found.'],
    ['/plans?select=missing', 'plan', '/plans', 'Plan not found.'],
  ])('reports a 404 and replaces %s with its list', async (path, kind, list, message) => {
    if (kind === 'knowledge') vi.spyOn(api, 'getById').mockRejectedValue(new ApiError('missing', 404));
    else vi.spyOn(api, 'getPlan').mockRejectedValue(new ApiError('missing', 404));
    const historyLength = window.history.length;
    mountApp(path, true);
    await waitFor(() => expect(currentUrl()).toBe(list));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(window.history.length).toBe(historyLength);
  });

  it.each([
    ['/knowledge/missing?edit=missing', 'knowledge'],
    ['/plans/missing?select=missing', 'plan'],
  ])('does not redirect a server failure at %s', async (path, kind) => {
    const detail = kind === 'knowledge'
      ? vi.spyOn(api, 'getById').mockRejectedValue(new ApiError('server failure', 500))
      : vi.spyOn(api, 'getPlan').mockRejectedValue(new ApiError('server failure', 500));
    mountApp(path);
    await waitFor(() => expect(detail).toHaveBeenCalledWith('missing'));
    await act(async () => { await Promise.resolve(); });
    expect(currentUrl()).toBe(path);
  });
});

describe('data management dialogs', () => {
  it('exposes the export dialog, traps focus, and closes with Escape', async () => {
    render(createElement(DataManagementSection));
    const trigger = screen.getByRole('button', { name: i18n.t('settings.exportBtn') });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: i18n.t('settings.exportModalTitle') });
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    trigger.focus();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('exposes the import dialog and closes with Escape', async () => {
    let picker: HTMLInputElement | undefined;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') picker = this;
    });
    vi.spyOn(api, 'parseExportFile').mockResolvedValue({
      knowledgeCount: 1, plansCount: 0, knowledge: [], plans: [],
    });
    render(createElement(DataManagementSection));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.importBtn') }));
    expect(picker).toBeTruthy();
    fireEvent.change(picker!, {
      target: { files: [new File(['{"knowledge":[]}'], 'backup.json', { type: 'application/json' })] },
    });
    const dialog = await screen.findByRole('dialog', { name: i18n.t('settings.importModalTitle') });
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[1].disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

it('starts a remote provider draft and preserves labeled stdio inputs', async () => {
  const view = render(createElement(ProvidersSection));
  fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
  expect(screen.getByPlaceholderText(i18n.t('providers.urlPlaceholder'))).toBeTruthy();
  expect(screen.queryByPlaceholderText(i18n.t('providers.commandPlaceholder'))).toBeNull();
  for (const input of Array.from(view.container.querySelectorAll('input[placeholder]'))) {
    expect(input.getAttribute('aria-label')).toBe(input.getAttribute('placeholder'));
  }
  fireEvent.click(screen.getByRole('button', { name: i18n.t('actions.cancel') }));
  fireEvent.click(screen.getByRole('button', { name: `+ ${i18n.t('providers.addStdio')}` }));
  expect(screen.getByPlaceholderText(i18n.t('providers.commandPlaceholder'))).toBeTruthy();
  for (const input of Array.from(view.container.querySelectorAll('input[placeholder]'))) {
    expect(input.getAttribute('aria-label')).toBe(input.getAttribute('placeholder'));
  }
  await act(async () => { await Promise.resolve(); });
});

it('uses a gear for Settings and a plug for Providers', async () => {
  mountApp('/not-a-real-route');
  await screen.findByRole('heading', { name: 'Page not found' });
  expect(screen.getByRole('link', { name: i18n.t('nav.settings') }).textContent).toContain('⚙️');
  expect(screen.getByRole('link', { name: i18n.t('nav.providers') }).textContent).toContain('🔌');
});

it.each([
  ['en', 'Page not found', 'The page you requested does not exist.', 'Back to knowledge', 'Knowledge entry not found.', 'Plan not found.'],
  ['es', 'Página no encontrada', 'La página solicitada no existe.', 'Volver al conocimiento', 'Entrada de conocimiento no encontrada.', 'Plan no encontrado.'],
  ['pt', 'Página não encontrada', 'A página solicitada não existe.', 'Voltar para o conhecimento', 'Entrada de conhecimento não encontrada.', 'Plano não encontrado.'],
])('provides all new translations in %s', (language, title, description, back, knowledge, plan) => {
  const expected = {
    'notFoundPage.title': title,
    'notFoundPage.description': description,
    'notFoundPage.back': back,
    'missingKnowledge.notFound': knowledge,
    'missingPlan.notFound': plan,
  };
  for (const [key, value] of Object.entries(expected)) {
    expect(i18n.getResource(language, 'translation', key)).toBe(value);
  }
});
