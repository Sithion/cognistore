import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

interface Stats {
  total: number;
  byType: { type: string; count: number }[];
  byScope: { scope: string; count: number }[];
}

export function StatsPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getStats().then(data => setStats(data as Stats)).catch((err) => {
      setError(err.message || 'Failed to load statistics');
    });
    api.listTags().then(data => setTags(data)).catch(console.error);
  }, []);

  if (error) return <p style={{ color: 'var(--error)', padding: 20 }}>⚠️ {error}</p>;
  if (!stats) return <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>;

  const maxCount = Math.max(...stats.byType.map(s => s.count), 1);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{t('stats.title')}</h1>

      <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)', marginBottom: 24 }}>
        {stats.total} <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 400 }}>{t('stats.total')}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* By Type */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{t('stats.byType')}</h3>
          {stats.byType.map(item => (
            <div key={item.type} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span>{t(`types.${item.type}`)}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{item.count}</span>
              </div>
              <div style={{ height: 6, backgroundColor: 'var(--bg-input)', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${(item.count / maxCount) * 100}%`, backgroundColor: 'var(--accent)', borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>

        {/* By Scope */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{t('stats.byScope')}</h3>
          {stats.byScope.map(item => (
            <div key={item.scope} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span>{item.scope}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{item.count}</span>
              </div>
              <div style={{ height: 6, backgroundColor: 'var(--bg-input)', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${(item.count / Math.max(...stats.byScope.map(s => s.count), 1)) * 100}%`, backgroundColor: 'var(--success)', borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tag Cloud */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{t('stats.tagCloud')}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {tags.map((tag, i) => (
            <span key={tag} style={{
              backgroundColor: 'var(--bg-input)', color: 'var(--accent)',
              padding: '4px 12px', borderRadius: 14,
              fontSize: 11 + (i % 3) * 3, fontWeight: i % 2 === 0 ? 600 : 400,
            }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
