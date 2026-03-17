import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

export function TagsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listTags().then(data => {
      setTags(data);
      setLoading(false);
    }).catch((err) => {
      setError(err.message || 'Failed to load tags');
      setLoading(false);
    });
  }, []);

  const handleTagClick = (tag: string) => {
    navigate(`/?tag=${encodeURIComponent(tag)}`);
  };

  if (loading) return <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>;
  if (error) return <p style={{ color: 'var(--error)', padding: 20 }}>⚠️ {error}</p>;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{t('tags.title')}</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24 }}>
        {tags.length} {t('tags.total')}
      </p>

      {tags.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
          {t('tags.empty')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => handleTagClick(tag)}
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--accent)',
                padding: '8px 16px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--accent)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                e.currentTarget.style.color = 'var(--accent)';
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
