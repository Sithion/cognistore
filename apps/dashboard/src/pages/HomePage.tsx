import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { KnowledgeCard } from '../components/KnowledgeCard.js';
import { TagBar } from '../components/TagBar.js';
import { KnowledgeModal } from '../components/KnowledgeModal.js';
import { FloatingAddButton } from '../components/FloatingAddButton.js';

const POLL_INTERVAL_MS = 10_000;

interface SearchResult {
  entry: Record<string, unknown>;
  similarity: number;
}

export function HomePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentEntries, setRecentEntries] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');

  // Tag state
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Available scopes (from stats API)
  const [allScopes, setAllScopes] = useState<string[]>([]);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Record<string, unknown> | null>(null);

  // Polling state — track both count and lastUpdatedAt for cross-process detection
  const lastSnapshotRef = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const types = ['decision', 'pattern', 'fix', 'constraint', 'gotcha'];

  const hasActiveFilters = typeFilter !== '' || scopeFilter !== '' || selectedTags.length > 0 || query.trim() !== '';

  // Load recent entries with server-side type/scope filters
  const loadRecent = useCallback((typeF?: string, scopeF?: string) => {
    const filters: { type?: string; scope?: string } = {};
    if (typeF) filters.type = typeF;
    if (scopeF) filters.scope = scopeF;
    return api.listRecent(50, Object.keys(filters).length > 0 ? filters : undefined)
      .then(setRecentEntries).catch(() => {});
  }, []);

  // Load tags (silent)
  const loadTags = useCallback(() => {
    return api.listTags().then(setAllTags).catch(() => {});
  }, []);

  // Load available scopes
  const loadScopes = useCallback(() => {
    return (api.getStats() as Promise<{ byScope: { scope: string }[] }>)
      .then(stats => setAllScopes(stats.byScope.map(s => s.scope)))
      .catch(() => {});
  }, []);

  // Initial load on mount
  useEffect(() => {
    loadRecent(typeFilter, scopeFilter);
    loadTags();
    loadScopes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload recent entries when type/scope filters change (non-search mode)
  useEffect(() => {
    if (!searched) {
      loadRecent(typeFilter, scopeFilter);
    }
  }, [typeFilter, scopeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for new/updated entries — detects changes from any process (OpenCode, Claude, etc.)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const stats = await api.getStats() as { total: number; lastUpdatedAt?: string };
        const snapshot = `${stats.total}:${stats.lastUpdatedAt || ''}`;
        if (lastSnapshotRef.current !== null && snapshot !== lastSnapshotRef.current) {
          setRefreshing(true);
          await Promise.all([loadRecent(typeFilter, scopeFilter), loadTags()]);
          setRefreshing(false);
        }
        lastSnapshotRef.current = snapshot;
      } catch { /* ignore polling errors */ }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadRecent, loadTags, typeFilter, scopeFilter]);

  // Read ?tag= from URL on mount
  useEffect(() => {
    const tagParam = searchParams.get('tag');
    if (tagParam) {
      setSelectedTags(tagParam.split(',').map(t => t.trim()).filter(Boolean));
    }
  }, []); // Only on mount

  // Sync selectedTags to URL
  useEffect(() => {
    if (selectedTags.length > 0) {
      setSearchParams({ tag: selectedTags.join(',') }, { replace: true });
    } else {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('tag');
      setSearchParams(newParams, { replace: true });
    }
  }, [selectedTags]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const options: Record<string, unknown> = {};
      if (typeFilter) options.type = typeFilter;
      if (scopeFilter) options.scope = scopeFilter;
      if (selectedTags.length > 0) options.tags = selectedTags;
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

  const handleToggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleClearAll = () => {
    setSelectedTags([]);
    setTypeFilter('');
    setScopeFilter('');
    setQuery('');
    setSearched(false);
    setResults([]);
  };

  const handleSuccess = () => {
    loadRecent(typeFilter, scopeFilter);
    loadTags();
    loadScopes();
    // Reset snapshot so polling doesn't double-refresh
    lastSnapshotRef.current = null;
  };

  const handleEdit = (entry: Record<string, unknown>) => {
    setEditingEntry(entry);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingEntry(null);
  };

  // Filter recent entries by selected tags (client-side — tags are always client-side)
  const filteredRecent = selectedTags.length > 0
    ? recentEntries.filter(entry => {
        const entryTags = (entry.tags as string[]) ?? [];
        return selectedTags.some(tag => entryTags.includes(tag));
      })
    : recentEntries;

  // Filter search results by tags (client-side)
  const filteredResults = selectedTags.length > 0
    ? results.filter(r => {
        const entryTags = ((r.entry as Record<string, unknown>).tags as string[]) ?? [];
        return selectedTags.some(tag => entryTags.includes(tag));
      })
    : results;

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 6,
            backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)',
            color: typeFilter ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 13,
          }}
        >
          <option value="">{t('filters.all')} — {t('filters.type')}</option>
          {types.map(type => (
            <option key={type} value={type}>{t(`types.${type}`)}</option>
          ))}
        </select>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 6,
            backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)',
            color: scopeFilter ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 13,
          }}
        >
          <option value="">{t('filters.all')} — {t('filters.scope')}</option>
          {allScopes.map(scope => (
            <option key={scope} value={scope}>{scope}</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            onClick={handleClearAll}
            style={{
              padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border)', backgroundColor: 'transparent',
              color: 'var(--accent)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('filters.clear')}
          </button>
        )}
      </div>

      {/* Tag Bar */}
      <TagBar
        tags={allTags}
        selectedTags={selectedTags}
        onToggleTag={handleToggleTag}
        onClearTags={() => setSelectedTags([])}
        loading={false}
      />

      {/* Search Results */}
      {searched && filteredResults.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
          {t('search.noResults')}
        </p>
      )}

      {searched && filteredResults.map((result) => (
        <KnowledgeCard
          key={(result.entry as Record<string, unknown>).id as string}
          entry={result.entry}
          similarity={result.similarity}
          onDelete={handleDelete}
          onTagClick={handleToggleTag}
          onEdit={handleEdit}
        />
      ))}

      {/* Recent Knowledge */}
      {!searched && filteredRecent.length > 0 && (
        <div>
          <h3 style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('search.recent')}
            {refreshing && (
              <span style={{
                display: 'inline-block', width: 12, height: 12,
                border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
            )}
          </h3>
          {filteredRecent.map((entry) => (
            <KnowledgeCard
              key={entry.id as string}
              entry={entry}
              onDelete={handleDelete}
              onTagClick={handleToggleTag}
              onEdit={handleEdit}
            />
          ))}
        </div>
      )}

      {!searched && filteredRecent.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
          {selectedTags.length > 0 || typeFilter || scopeFilter ? t('search.noResults') : t('search.empty')}
        </p>
      )}

      {/* FAB + Modal */}
      <FloatingAddButton onClick={() => { setEditingEntry(null); setShowModal(true); }} />
      <KnowledgeModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSuccess={handleSuccess}
        entry={editingEntry}
      />
    </div>
  );
}
