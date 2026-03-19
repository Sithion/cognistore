import { useState, useRef, useEffect } from 'react';
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
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter suggestions: match input, exclude already selected
  const suggestions = inputValue.trim()
    ? tags.filter(
        (tag) =>
          tag.toLowerCase().includes(inputValue.toLowerCase()) &&
          !selectedTags.includes(tag)
      )
    : [];

  // Close suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions.length]);

  const addTag = (tag: string) => {
    if (tag && !selectedTags.includes(tag)) {
      onToggleTag(tag);
    }
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        addTag(suggestions[highlightedIndex]);
      } else if (inputValue.trim()) {
        // Add exact match if exists, otherwise first suggestion
        const exact = tags.find(
          (t) => t.toLowerCase() === inputValue.trim().toLowerCase()
        );
        if (exact && !selectedTags.includes(exact)) {
          addTag(exact);
        } else if (suggestions.length > 0) {
          addTag(suggestions[0]);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1
      );
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    } else if (e.key === 'Backspace' && !inputValue && selectedTags.length > 0) {
      // Remove last tag on backspace when input is empty
      onToggleTag(selectedTags[selectedTags.length - 1]);
    }
  };

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

  return (
    <div ref={containerRef} style={{ position: 'relative', marginBottom: 20 }}>
      {/* Input container with chips */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          backgroundColor: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 12px',
          cursor: 'text',
          minHeight: 42,
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Selected tag chips */}
        {selectedTags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              backgroundColor: 'var(--accent)',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {tag}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleTag(tag);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 14,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
              }}
            >
              x
            </button>
          </span>
        ))}

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => {
            if (inputValue.trim()) setShowSuggestions(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedTags.length === 0
              ? t('tags.inputPlaceholder', { defaultValue: 'Filter by tags...' })
              : ''
          }
          style={{
            flex: 1,
            minWidth: 100,
            border: 'none',
            outline: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-primary)',
            fontSize: 13,
            padding: '2px 0',
          }}
        />

        {/* Clear all button */}
        {selectedTags.length > 0 && onClearTags && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearTags();
              setInputValue('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '2px 4px',
              fontSize: 14,
              lineHeight: 1,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            x
          </button>
        )}
      </div>

      {/* Autocomplete dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            maxHeight: 200,
            overflowY: 'auto',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          {suggestions.slice(0, 20).map((tag, index) => (
            <div
              key={tag}
              onClick={() => addTag(tag)}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                cursor: 'pointer',
                color:
                  index === highlightedIndex
                    ? '#fff'
                    : 'var(--text-primary)',
                backgroundColor:
                  index === highlightedIndex
                    ? 'var(--accent)'
                    : 'transparent',
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {tag}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
