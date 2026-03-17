import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { KnowledgeCard } from '../components/KnowledgeCard.js';
import { TagBar } from '../components/TagBar.js';
import { AddKnowledgeModal } from '../components/AddKnowledgeModal.js';
import { FloatingAddButton } from '../components/FloatingAddButton.js';

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
  const [tagsLoading, setTagsLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);

  const types = ['decision', 'pattern', 'fix', 'constraint', 'gotcha'];

  // Load recent entries
  const loadRecent = useCallback(() => {
    api.listRecent(20).then(setRecentEntries).catch(console.error);
  }, []);

  // Load tags
  useEffect(() => {
    api.listTags().then((tags) => {
      setAllTags(tags);
      setTagsLoading(false);
    }).catch(() => setTagsLoading(false));
  }, []);

  // Load recent on mount
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

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
      // Remove tag param if no tags selected
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

  const handleClearTags = () => {
    setSelectedTags([]);
  };

  const handleAddSuccess = () => {
    loadRecent();
    // Refresh tags too
    api.listTags().then(setAllTags).catch(console.error);
  };

  // Filter recent entries by selected tags (client-side)
  const filteredRecent = selectedTags.length > 0
    ? recentEntries.filter(entry => {
        const entryTags = (entry.tags as string[]) ?? [];
        return selectedTags.some(tag => entryTags.includes(tag));
      })
    : recentEntries;

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

      {/* Tag Bar */}
      <TagBar
        tags={allTags}
        selectedTags={selectedTags}
        onToggleTag={handleToggleTag}
        onClearTags={handleClearTags}
        loading={tagsLoading}
      />

      {/* Search Results */}
      {searched && results.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
          {t('search.noResults')}
        </p>
      )}

      {searched && results.map((result) => (
        <KnowledgeCard
          key={(result.entry as Record<string, unknown>).id as string}
          entry={result.entry}
          similarity={result.similarity}
          onDelete={handleDelete}
          onTagClick={handleToggleTag}
        />
      ))}

      {/* Recent Knowledge */}
      {!searched && filteredRecent.length > 0 && (
        <div>
          <h3 style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            {t('search.recent')}
          </h3>
          {filteredRecent.map((entry) => (
            <KnowledgeCard
              key={entry.id as string}
              entry={entry}
              onDelete={handleDelete}
              onTagClick={handleToggleTag}
            />
          ))}
        </div>
      )}

      {!searched && filteredRecent.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
          {selectedTags.length > 0 ? t('search.noResults') : t('search.empty')}
        </p>
      )}

      {/* FAB + Modal */}
      <FloatingAddButton onClick={() => setShowModal(true)} />
      <AddKnowledgeModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={handleAddSuccess}
      />
    </div>
  );
}
