import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface TagBarProps {
  tags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags?: () => void;
  loading?: boolean;
}

export function TagBar({
  tags,
  selectedTags,
  onToggleTag,
  onClearTags,
  loading = false,
}: TagBarProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Return null if no tags and not loading
  if (!loading && tags.length === 0) {
    return null;
  }

  // Show loading state
  if (loading) {
    return (
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 14,
          marginBottom: 20,
          color: 'var(--text-secondary)',
          fontSize: 13,
        }}
      >
        {t('tags.loading', { defaultValue: 'Loading tags...' })}
      </div>
    );
  }

  // Determine how many tags to show
  const maxDefaultTags = 20;
  const shouldShowExpand = tags.length > maxDefaultTags;
  const displayedTags = expanded ? tags : tags.slice(0, maxDefaultTags);

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        marginBottom: 20,
      }}
    >
      {/* Tags container */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        {/* Render tags */}
        {displayedTags.map((tag) => {
          const isSelected = selectedTags.includes(tag);
          return (
            <button
              key={tag}
              onClick={() => onToggleTag(tag)}
              style={{
                backgroundColor: isSelected ? 'var(--accent)' : 'var(--bg-card)',
                border: isSelected
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border)',
                color: isSelected ? '#fff' : 'var(--accent)',
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.backgroundColor = 'var(--border)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                }
              }}
            >
              {tag}
            </button>
          );
        })}

        {/* Show all / Show less button */}
        {shouldShowExpand && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              padding: '6px 0',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            {expanded ? `${t('tags.showLess', { defaultValue: 'Show less' })} <<` : `${t('tags.showAll', { defaultValue: 'Show all' })} >>`}
          </button>
        )}

        {/* Clear button */}
        {selectedTags.length > 0 && onClearTags && (
          <div style={{ marginLeft: 'auto' }}>
            <button
              onClick={onClearTags}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                padding: '6px 0',
                cursor: 'pointer',
                fontSize: 12,
                textDecoration: 'none',
              }}
            >
              {t('filters.clear', { defaultValue: 'Clear filters' })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
