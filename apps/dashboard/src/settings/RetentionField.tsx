import { useEffect, useState } from 'react';

export function RetentionField({ value, onSave }: { value: number; onSave: (days: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(String(value)); }, [value, saved]);

  const submit = async () => {
    if (saving) return;
    const days = Number(draft);
    if (!/^\d+$/.test(draft) || !Number.isInteger(days) || days < 0 || days > 36500) {
      setError('Enter an integer between 0 and 36500.');
      return;
    }
    setSaving(true);
    setError(null);
    try { await onSave(days); setSaved(count => count + 1); }
    catch { setError('Could not save retention. Please try again.'); }
    finally { setSaving(false); }
  };

  return <div>
    <label htmlFor="retention-days">Raw token history (days)</label>
    <p>Default: 90 days. Set 0 to keep raw history indefinitely. Daily rollups are retained. Previously pruned raw history cannot be recovered; shortening retention can permanently prune older records.</p>
    <input id="retention-days" data-testid="retention-days" type="number" min={0} max={36500} step={1}
      value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} aria-describedby="retention-error" />
    <button data-testid="retention-save" disabled={saving} onClick={() => void submit()}>{saving ? 'Saving…' : 'Save'}</button>
    {error && <p id="retention-error" role="alert">{error}</p>}
  </div>;
}
