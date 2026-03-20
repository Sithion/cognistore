import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { ScopeAutocomplete } from './ScopeAutocomplete.js';

interface KnowledgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  entry?: Record<string, unknown> | null;
}

export function KnowledgeModal({ isOpen, onClose, onSuccess, entry }: KnowledgeModalProps) {
  const { t } = useTranslation();
  const isEdit = !!entry;
  const [form, setForm] = useState({
    content: '',
    tags: '',
    type: 'pattern',
    scope: 'global',
    source: 'manual',
    confidenceScore: 1.0,
    agentId: '',
  });
  const [saving, setSaving] = useState(false);

  // Reset/populate form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (entry) {
        const tags = Array.isArray(entry.tags) ? (entry.tags as string[]).join(', ') : '';
        setForm({
          content: (entry.content as string) || '',
          tags,
          type: (entry.type as string) || 'pattern',
          scope: (entry.scope as string) || 'global',
          source: (entry.source as string) || 'manual',
          confidenceScore: (entry.confidenceScore as number) ?? 1.0,
          agentId: (entry.agentId as string) || '',
        });
      } else {
        setForm({
          content: '',
          tags: '',
          type: 'pattern',
          scope: 'global',
          source: 'manual',
          confidenceScore: 1.0,
          agentId: '',
        });
      }
    }
  }, [isOpen, entry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        content: form.content,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        type: form.type,
        scope: form.scope,
        source: form.source,
        confidenceScore: form.confidenceScore,
        agentId: form.agentId || undefined,
      };
      if (isEdit && entry?.id) {
        await api.update(entry.id as string, data);
      } else {
        await api.create(data);
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error(`Failed to ${isEdit ? 'update' : 'create'}:`, error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--border)', backgroundColor: 'var(--bg-input)',
    color: 'var(--text-primary)', fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 0.5, color: 'var(--text-secondary)',
    display: 'block', marginBottom: 6,
  };

  return (
    <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>
          {isEdit ? t('edit.title') : t('add.title')}
        </h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Content */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{t('knowledge.content')} *</label>
          <textarea
            required
            rows={5}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {/* Tags, Type, Scope */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('knowledge.tags')} *</label>
            <input
              required
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="auth, jwt, fix"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('knowledge.type')} *</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              style={inputStyle}
            >
              {['decision', 'pattern', 'fix', 'constraint', 'gotcha'].map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('knowledge.scope')} *</label>
            <ScopeAutocomplete
              required
              value={form.scope}
              onChange={(v) => setForm({ ...form, scope: v })}
            />
          </div>
        </div>

        {/* Source, Confidence, Agent */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('knowledge.source')}</label>
            <input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('knowledge.confidence')}</label>
            <input
              type="number" min={0} max={1} step={0.1}
              value={form.confidenceScore}
              onChange={(e) => setForm({ ...form, confidenceScore: parseFloat(e.target.value) })}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('knowledge.agent')}</label>
            <input
              value={form.agentId}
              onChange={(e) => setForm({ ...form, agentId: e.target.value })}
              placeholder="claude"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: '1px solid var(--border)', backgroundColor: 'var(--bg-input)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            {t('actions.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: 'none', backgroundColor: 'var(--accent)',
              color: '#fff', cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? '...' : t('actions.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
