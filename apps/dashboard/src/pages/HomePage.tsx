import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

interface SearchResult {
  entry: Record<string, unknown>;
  similarity: number;
}

export function HomePage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentEntries, setRecentEntries] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');

  // Load recent entries on mount
  useEffect(() => {
    api.listRecent(20).then((data) => {
      setRecentEntries(data);
    }).catch((error) => {
      console.error('Failed to load recent entries:', error);
    });
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const options: Record<string, unknown> = {};
      if (typeFilter) options.type = typeFilter;
      if (scopeFilter) options.scope = scopeFilter;
      const data = await api.search(query, options) as SearchResult[];
      setResults(data);
      setSearched(true);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('delete.message'))) return;
    try {
      await api.deleteEntry(id);
      setResults(results.filter(r => (r.entry as Record<string, unknown>).id !== id));
      setRecentEntries(recentEntries.filter(e => e.id !== id));
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const types = ['decision', 'pattern', 'fix', 'constraint', 'gotcha'];

  // Render a knowledge entry card
  const renderEntryCard = (entry: Record<string, unknown>, similarity?: number) => {
    const showSimilarity = similarity !== undefined;
    const simPercent = showSimilarity ? Math.round(similarity * 100) : 0;
    const color = simPercent >= 80 ? 'var(--success)' : simPercent >= 60 ? 'var(--warning)' : 'var(--error)';
    return (
      <div
        key={entry.id as string}
        style={{
          backgroundColor: 'var(--bg-card)', borderRadius: 10,
          border: '1px solid var(--border)', padding: 16, marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {showSimilarity && (
              <span style={{ backgroundColor: color, color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                {simPercent}%
              </span>
            )}
            <span style={{ backgroundColor: 'var(--accent)', color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>
              {t(`types.${entry.type as string}`)}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{entry.scope as string}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => handleDelete(entry.id as string)}
              style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 13 }}>
              {t('actions.delete')}
            </button>
          </div>
        </div>
        <p style={{ color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.5, marginBottom: 8 }}>
          {(entry.content as string).substring(0, 200)}
          {(entry.content as string).length > 200 ? '...' : ''}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {((entry.tags as string[]) ?? []).map((tag) => (
            <span key={tag} style={{
              backgroundColor: 'var(--bg-input)', color: 'var(--accent)',
              padding: '2px 8px', borderRadius: 10, fontSize: 11,
            }}>
              {tag}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          v{entry.version as number} • {entry.agentId ? `Agent: ${entry.agentId}` : ''} • {new Date(entry.createdAt as string).toLocaleDateString()}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Search Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={t('search.placeholder')}
          style={{
            flex: 1, padding: '12px 16px', borderRadius: 8,
            backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{
            padding: '12px 24px', borderRadius: 8, border: 'none',
            backgroundColor: 'var(--accent)', color: '#fff',
            cursor: 'pointer', fontSize: 14, fontWeight: 600,
          }}
        >
          {loading ? '...' : t('search.button')}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 6,
            backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 13,
          }}
        >
          <option value="">{t('filters.all')} — {t('filters.type')}</option>
          {types.map(type => (
            <option key={type} value={type}>{t(`types.${type}`)}</option>
          ))}
        </select>
        <input
          type="text"
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          placeholder={t('filters.scope')}
          style={{
            padding: '8px 12px', borderRadius: 6,
            backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 13, width: 200,
          }}
        />
      </div>

      {/* Search Results */}
      {searched && results.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
          {t('search.noResults')}
        </p>
      )}

      {searched && results.map((result) => renderEntryCard(result.entry, result.similarity))}

      {/* Recent Knowledge (shown when no search has been performed) */}
      {!searched && recentEntries.length > 0 && (
        <div>
          <h3 style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            {t('search.recent')}
          </h3>
          {recentEntries.map((entry) => renderEntryCard(entry))}
        </div>
      )}

      {!searched && recentEntries.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
          {t('search.empty')}
        </p>
      )}
    </div>
  );
}
