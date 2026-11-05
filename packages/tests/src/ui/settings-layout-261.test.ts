import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsCard, SettingsRow, fieldClass } from '../../../../apps/dashboard/src/settings/SettingsLayout.js';
import { settingsCopy } from '../../../../apps/dashboard/src/i18n/settings-v261.js';
import { RetentionField } from '../../../../apps/dashboard/src/settings/RetentionField.js';

describe('settings layout for 2.6.1', () => {
  it('labels the card section with its title heading', () => {
    const { container } = render(createElement(SettingsCard, { title: 'Appearance' }, createElement('p', null, 'body')));
    const section = container.querySelector('section')!;
    const heading = screen.getByRole('heading', { level: 2, name: 'Appearance' });
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(section.className).toContain('border-border');
  });

  it('renders description and footer only when given', () => {
    const { container, rerender } = render(createElement(SettingsCard, { title: 'Models' }, 'x'));
    expect(container.querySelectorAll('p.text-muted-foreground')).toHaveLength(0);
    expect(container.querySelector('.border-t')).toBeNull();
    rerender(createElement(SettingsCard, { title: 'Models', description: 'Local models', footer: createElement('button', null, 'Save') }, 'x'));
    expect(screen.getByText('Local models')).toBeTruthy();
    expect(container.querySelector('.border-t')?.textContent).toBe('Save');
  });

  it('marks the danger tone on the title and border', () => {
    const { container } = render(createElement(SettingsCard, { title: 'Danger zone', tone: 'danger' }, 'x'));
    expect(screen.getByRole('heading', { name: 'Danger zone' }).className).toContain('text-destructive');
    expect(container.querySelector('section')!.className).toContain('border-destructive/60');
  });

  it('links a row label to its control and describes it', () => {
    const { container } = render(createElement(SettingsRow, { label: 'Model', description: 'Used for merges', htmlFor: 'model' },
      createElement('input', { id: 'model' })));
    expect(screen.getByLabelText('Model').id).toBe('model');
    expect(container.querySelector('#model-desc')?.textContent).toBe('Used for merges');
  });

  it('renders a plain span when the row has no control id', () => {
    const { container } = render(createElement(SettingsRow, { label: 'Embedding model' }, createElement('button', null, 'Install')));
    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByText('Embedding model').tagName).toBe('SPAN');
  });

  it('exposes the shared field class', () => {
    expect(fieldClass).toContain('border-input');
    expect(fieldClass).toContain('sm:w-56');
  });

  it('ships the same non-empty copy keys in en, es and pt', () => {
    const keys = Object.keys(settingsCopy.en).sort();
    for (const lang of ['es', 'pt'] as const) expect(Object.keys(settingsCopy[lang]).sort()).toEqual(keys);
    for (const lang of ['en', 'es', 'pt'] as const) for (const value of Object.values(settingsCopy[lang])) expect(value.trim()).not.toBe('');
  });

  it('renders the retention row with English copy by default', () => {
    render(createElement(RetentionField, { value: 90, onSave: vi.fn() }));
    expect(screen.getByLabelText(settingsCopy.en.retentionLabel)).toBe(screen.getByTestId('retention-days'));
    expect(screen.getByTestId('retention-save').textContent).toBe(settingsCopy.en.save);
  });
});
