import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { SettingsRow } from './SettingsLayout.js';
import { settingsCopy, type SettingsCopy } from '../i18n/settings-v261.js';

export function RetentionField({ value, onSave, copy = settingsCopy.en }: { value: number; onSave: (days: number) => Promise<void>; copy?: SettingsCopy }) {
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(String(value)); }, [value, saved]);

  const submit = async () => {
    if (saving) return;
    const days = Number(draft);
    if (!/^\d+$/.test(draft) || !Number.isInteger(days) || days < 0 || days > 36500) {
      setError(copy.retentionInvalid);
      return;
    }
    setSaving(true);
    setError(null);
    try { await onSave(days); setSaved(count => count + 1); }
    catch { setError(copy.retentionSaveFailed); }
    finally { setSaving(false); }
  };

  return <>
    <SettingsRow label={copy.retentionLabel} description={copy.retentionHelp} htmlFor="retention-days">
      <Input id="retention-days" data-testid="retention-days" type="number" min={0} max={36500} step={1} className="w-28"
        value={draft} disabled={saving} onChange={event => setDraft(event.target.value)}
        aria-describedby={error ? 'retention-days-desc retention-error' : 'retention-days-desc'} />
      <Button data-testid="retention-save" variant="outline" disabled={saving} onClick={() => void submit()}>{saving ? copy.saving : copy.save}</Button>
    </SettingsRow>
    {error && <p id="retention-error" role="alert" className="pb-3 text-xs text-destructive">{error}</p>}
  </>;
}
