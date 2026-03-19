import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { KnowledgeCard } from '../components/KnowledgeCard.js';
import { TagBar } from '../components/TagBar.js';
import { KnowledgeModal } from '../components/KnowledgeModal.js';
import { FloatingAddButton } from '../components/FloatingAddButton.js';

const POLL_INTERVAL_MS = 10_000;

export function HomePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search state
  const [query, setQuery] = useState('');
  const [recentEntries, setRecentEntries] = useState<Record<string, unknown>[]>([]);
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

  // Reload recent entries when type/scope filters change
  useEffect(() => {
    loadRecent(typeFilter, scopeFilter);
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

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    try {
      await api.deleteEntry(id);
      setRecentEntries(prev => prev.filter(e => e.id !== id));
      setConfirmDeleteId(null);
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

  // Filter recent entries by tags (client-side) and text query
  const q = query.trim().toLowerCase();
  const filteredRecent = recentEntries.filter(entry => {
    // Exclude plans — they have their own page
    if ((entry.type as string) === 'plan') return false;
    // Tag filter
    if (selectedTags.length > 0) {
      const entryTags = (entry.tags as string[]) ?? [];
      if (!selectedTags.some(tag => entryTags.includes(tag))) return false;
    }
    // Text filter (substring match on content, tags, source, scope)
    if (q) {
      const content = ((entry.content as string) ?? '').toLowerCase();
      const tags = ((entry.tags as string[]) ?? []).join(' ').toLowerCase();
      const source = ((entry.source as string) ?? '').toLowerCase();
      const scope = ((entry.scope as string) ?? '').toLowerCase();
      const type = ((entry.type as string) ?? '').toLowerCase();
      if (
        !content.includes(q) &&
        !tags.includes(q) &&
        !source.includes(q) &&
        !scope.includes(q) &&
        !type.includes(q)
      ) return false;
    }
    return true;
  });

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* Search Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
          style={{
            flex: 1, padding: '12px 16px', borderRadius: 8,
            backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 14, outline: 'none',
          }}
        />
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

      {/* Knowledge Entries */}
      {filteredRecent.length > 0 && (
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
              confirmingDelete={confirmDeleteId === entry.id}
              onCancelDelete={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}

      {filteredRecent.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
          {hasActiveFilters ? t('search.noResults') : t('search.empty')}
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
