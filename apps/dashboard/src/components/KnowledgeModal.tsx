import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

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

  // Handle Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    backgroundColor: 'var(--bg-input)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    fontSize: 14,
    outline: 'none',
  };

  const labelStyle = {
    display: 'block' as const,
    color: 'var(--text-secondary)',
    fontSize: 12,
    marginBottom: 4,
    fontWeight: 600 as const,
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12, padding: 24,
          width: '90%', maxWidth: 600,
          maxHeight: '90vh', overflowY: 'auto' as const,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            {isEdit ? t('edit.title') : t('add.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: 24,
              cursor: 'pointer', color: 'var(--text-secondary)',
              padding: 0, width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label={t('actions.close')}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{t('knowledge.content')} *</label>
            <textarea
              required
              rows={6}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>{t('knowledge.tags')} *</label>
              <input
                required
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="auth, jwt, fix"
                style={inputStyle}
              />
            </div>
            <div>
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
            <div>
              <label style={labelStyle}>{t('knowledge.scope')} *</label>
              <input
                required
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
                placeholder="global"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
            <div>
              <label style={labelStyle}>{t('knowledge.source')}</label>
              <input
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('knowledge.confidence')}</label>
              <input
                type="number" min={0} max={1} step={0.1}
                value={form.confidenceScore}
                onChange={(e) => setForm({ ...form, confidenceScore: parseFloat(e.target.value) })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('knowledge.agent')}</label>
              <input
                value={form.agentId}
                onChange={(e) => setForm({ ...form, agentId: e.target.value })}
                placeholder="claude"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px', borderRadius: 8,
                border: '1px solid var(--border)', backgroundColor: 'transparent',
                color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600,
              }}
            >
              {t('actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                backgroundColor: 'var(--accent)', color: '#fff',
                cursor: 'pointer', fontWeight: 600,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? '...' : t('actions.save')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
