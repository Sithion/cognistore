import { createElement } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '../../../../apps/dashboard/src/i18n/index.js';
import { AppliedPanel, HealthPanel, PendingPanel, TrashPanel } from '../../../../apps/dashboard/src/curation/CurationPanels.js';
import type { CurationQueueAction } from '../../../../apps/dashboard/src/api/client.js';

const action = (id: string, over: Partial<CurationQueueAction> = {}): CurationQueueAction =>
  ({ id, kind: 'trash', status: 'proposed', confidence: 0.9, titles: [`Entry ${id}`], entryIds: [id], reason: `reason ${id}`, ...over });
const pendingProps = (over = {}) => ({
  actions: [action('a'), action('b')], selected: new Set<string>(), busy: false,
  onToggle: vi.fn(), onToggleAll: vi.fn(), onApprove: vi.fn(), onReject: vi.fn(), onBatch: vi.fn(), ...over,
});

it('batch buttons stay disabled until rows are selected, then forward the operation', () => {
  const none = pendingProps();
  const { unmount } = render(createElement(PendingPanel, none));
  expect((screen.getByTestId('batch-approve') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId('batch-reject') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(screen.getAllByTestId('pending-row')[0]).getByRole('checkbox'));
  expect(none.onToggle).toHaveBeenCalledWith('a');
  unmount();

  const some = pendingProps({ selected: new Set(['a', 'b']) });
  render(createElement(PendingPanel, some));
  expect((screen.getByTestId('select-all') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByTestId('batch-reject'));
  expect(some.onBatch).toHaveBeenCalledWith('reject');
  fireEvent.click(screen.getByTestId('batch-approve'));
  expect(some.onBatch).toHaveBeenCalledWith('apply');
});

it('disables every control while busy', () => {
  render(createElement(PendingPanel, pendingProps({ busy: true, selected: new Set(['a']) })));
  expect((screen.getByTestId('batch-approve') as HTMLButtonElement).disabled).toBe(true);
  for (const button of within(screen.getAllByTestId('pending-row')[0]).getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
});

it('undo is disabled once its window has ended and enabled before that', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  const onUndo = vi.fn();
  render(createElement(AppliedPanel, { now, busy: false, onUndo, actions: [
    { id: 'fresh', kind: 'trash', status: 'applied', confidence: 1, titles: ['Fresh'], entryIds: ['fresh'], undoExpiresAt: '2026-06-02T12:00:00Z' },
    { id: 'old', kind: 'trash', status: 'applied', confidence: 1, titles: ['Old'], entryIds: ['old'], undoExpiresAt: '2026-05-30T12:00:00Z' },
  ] }));
  const [fresh, old] = screen.getAllByTestId('applied-row').map(row => within(row).getByRole('button') as HTMLButtonElement);
  expect(fresh.disabled).toBe(false);
  expect(old.disabled).toBe(true);
  fireEvent.click(fresh);
  expect(onUndo).toHaveBeenCalledWith('fresh');
});

it('shows a teaching empty state in every panel', () => {
  render(createElement(PendingPanel, pendingProps({ actions: [] })));
  render(createElement(AppliedPanel, { actions: [], now: 0, busy: false, onUndo: vi.fn() }));
  render(createElement(TrashPanel, { items: [], now: 0, busy: false, onRestore: vi.fn() }));
  for (const id of ['pending-empty', 'applied-empty', 'trash-empty']) expect(screen.getByTestId(id).textContent!.length).toBeGreaterThan(20);
});

it('renders agent-authored text inert', () => {
  const evil = '<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2">';
  const { container } = render(createElement(PendingPanel, pendingProps({ actions: [action('x', { reason: evil, titles: [evil] })] })));
  expect(container.querySelector('script, img')).toBeNull();
  expect(container.textContent).toContain('<script>window.__pwned = 1</script>');
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
});

it('trash rows show the days left and restore forwards the id', () => {
  const onRestore = vi.fn();
  const now = Date.parse('2026-06-01T00:00:00Z');
  render(createElement(TrashPanel, { now, busy: false, onRestore, items: [{ id: 't1', title: 'Trashed', trashedAt: '2026-05-25T00:00:00Z', expiresAt: '2026-06-04T00:00:00Z' }] }));
  expect(screen.getByTestId('trash-row').textContent).toContain('3');
  fireEvent.click(within(screen.getByTestId('trash-row')).getByRole('button'));
  expect(onRestore).toHaveBeenCalledWith('t1');
});

it('health panel lists size, telemetry share, tables and event-loop lag', () => {
  render(createElement(HealthPanel, { health: { sizeBytes: 5_242_880, tables: [{ name: 'knowledge_entries', rows: 12 }], telemetryShare: 0.25, lastVacuumAt: null, eventLoopLagMs: { p50: 1, p99: 4, max: 9 } } }));
  const text = screen.getByTestId('health-panel').textContent!;
  expect(text).toContain('5.0 MB');
  expect(text).toContain('25%');
  expect(text).toContain('knowledge_entries');
  expect(text).toContain('9 ms');
});
