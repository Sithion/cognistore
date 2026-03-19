import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';

interface ScopeAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  style?: React.CSSProperties;
  required?: boolean;
}

let scopesCache: string[] | null = null;

export function ScopeAutocomplete({ value, onChange, style, required }: ScopeAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scopesCache) {
      setScopes(scopesCache);
      return;
    }
    api.listScopes().then(s => {
      scopesCache = s;
      setScopes(s);
    }).catch(() => {});
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = scopes.filter(s =>
    s.toLowerCase().includes((filter || value).toLowerCase())
  );

  // Ensure "global" is always visible as an option
  const options = filtered.includes('global') ? filtered : ['global', ...filtered];

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
    ...style,
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        required={required}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setFilter(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="global"
        style={inputStyle}
      />
      {open && options.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 160,
            overflowY: 'auto',
            zIndex: 100,
          }}
        >
          {options.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onChange(s);
                setFilter('');
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                textAlign: 'left',
                background: s === value ? 'var(--accent-muted)' : 'none',
                border: 'none',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-muted)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = s === value ? 'var(--accent-muted)' : 'none')}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Reset cache so next mount refetches */
export function invalidateScopesCache() {
  scopesCache = null;
}
