import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

export function AddPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    content: '', tags: '', type: 'pattern', scope: 'global', source: 'manual',
    confidenceScore: 1.0, agentId: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.create({
        content: form.content,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        type: form.type,
        scope: form.scope,
        source: form.source,
        confidenceScore: form.confidenceScore,
        agentId: form.agentId || undefined,
      });
      navigate('/');
    } catch (error) {
      console.error('Failed to create:', error);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', fontSize: 14, outline: 'none',
  };

  const labelStyle = { display: 'block', color: 'var(--text-secondary)', fontSize: 12, marginBottom: 4, fontWeight: 600 as const };

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{t('add.title')}</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{t('knowledge.content')} *</label>
          <textarea
            required rows={6} value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>{t('knowledge.tags')} *</label>
            <input required value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="auth, jwt, fix" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t('knowledge.type')} *</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inputStyle}>
              {['decision', 'pattern', 'fix', 'constraint', 'gotcha'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t('knowledge.scope')} *</label>
            <input required value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}
              placeholder="global" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
          <div>
            <label style={labelStyle}>{t('knowledge.source')}</label>
            <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t('knowledge.confidence')}</label>
            <input type="number" min={0} max={1} step={0.1} value={form.confidenceScore}
              onChange={(e) => setForm({ ...form, confidenceScore: parseFloat(e.target.value) })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t('knowledge.agent')}</label>
            <input value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}
              placeholder="claude" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => navigate('/')}
            style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            {t('actions.cancel')}
          </button>
          <button type="submit" disabled={saving}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', backgroundColor: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            {saving ? '...' : t('actions.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
