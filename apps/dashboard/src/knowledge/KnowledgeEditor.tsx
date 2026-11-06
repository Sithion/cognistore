import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Input } from '../components/ui/input.js';
import { Button } from '../components/ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.js';
import { registerKnowledgeResources } from '../i18n/round8-knowledge.js';
import { textareaClass } from '../components/ui/control-styles.js';

export type KnowledgeEntry = {
  id: string; title: string; content: string; tags: string[]; type: string;
  scope: string; source: string; confidenceScore?: number; agentId?: string | null;
  platform?: string | null; createdAt?: string; updatedAt?: string;
  version?: number; readCount?: number; lastReadAt?: string | null;
  expiresAt?: string | null; relatedIds?: string[] | null;
};

export function KnowledgeEditor({ entry, onSaved, onCancel }: {
  entry?: KnowledgeEntry | null; onSaved: () => void; onCancel: () => void;
}) {
  registerKnowledgeResources();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const id = useId();
  const [form, setForm] = useState({
    title: entry?.title ?? '', content: entry?.content ?? '',
    tags: entry?.tags.join(', ') ?? '', type: entry?.type ?? 'pattern',
    scope: entry?.scope ?? params.get('scope') ?? 'global', source: entry?.source ?? 'manual',
  });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    const data = {
      ...form, title: form.title.trim(),
      tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      confidenceScore: entry?.confidenceScore ?? 1,
      agentId: entry?.agentId ?? null, platform: entry?.platform ?? null,
    };
    try {
      if (entry) await api.update(entry.id, data);
      else await api.create(data);
    } catch {
      setFailed(true);
      setPending(false);
      return;
    }
    setPending(false);
    onSaved();
  };
  return <form onSubmit={submit} aria-busy={pending} className="space-y-4">
    <fieldset disabled={pending} className="space-y-4">
      {(['title', 'content', 'tags', 'scope', 'source'] as const).map(field => <div key={field}>
        <label htmlFor={`${id}-${field}`} className="mb-1 block text-sm font-medium">{t(`knowledgeScreen.${field}`)}</label>
        {field === 'content'
          ? <textarea id={`${id}-${field}`} required rows={10} maxLength={500000}
            className={`${textareaClass} font-mono`}
            value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })} />
          : <Input id={`${id}-${field}`} required maxLength={field === 'title' || field === 'source' ? 500 : undefined}
            value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })} />}
      </div>)}
      <div>
        <label htmlFor={`${id}-type`} className="mb-1 block text-sm font-medium">{t('knowledgeScreen.type')}</label>
        <Select value={form.type} onValueChange={type => setForm({ ...form, type })} disabled={pending}>
          <SelectTrigger id={`${id}-type`}><SelectValue /></SelectTrigger>
          <SelectContent>{['decision', 'pattern', 'fix', 'constraint', 'gotcha'].map(type =>
            <SelectItem key={type} value={type}>{t(`types.${type}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {failed && <p id={`${id}-error`} role="alert" className="text-destructive">{t('knowledgeScreen.failed')}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('knowledgeScreen.cancel')}</Button>
        <Button type="submit">{t('knowledgeScreen.save')}</Button>
      </div>
    </fieldset>
  </form>;
}
