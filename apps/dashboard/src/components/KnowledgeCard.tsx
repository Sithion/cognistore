import { useTranslation } from 'react-i18next';

export interface KnowledgeCardProps {
  entry: Record<string, unknown>;
  similarity?: number;
  onDelete: (id: string) => void;
  onTagClick: (tag: string) => void;
  onEdit?: (entry: Record<string, unknown>) => void;
  confirmingDelete?: boolean;
  onCancelDelete?: () => void;
}

export function KnowledgeCard({
  entry,
  similarity,
  onDelete,
  onTagClick,
  onEdit,
  confirmingDelete,
  onCancelDelete,
}: KnowledgeCardProps) {
  const { t } = useTranslation();

  const showSimilarity = similarity !== undefined;
  const simPercent = showSimilarity ? Math.round(similarity * 100) : 0;
  const color =
    simPercent >= 80 ? 'var(--success)' : simPercent >= 60 ? 'var(--warning)' : 'var(--error)';

  return (
    <div
      key={entry.id as string}
      onClick={() => onEdit?.(entry)}
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        padding: 16,
        marginBottom: 12,
        cursor: onEdit ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => onEdit && (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={(e) => onEdit && (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'start',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {showSimilarity && (
            <span
              style={{
                backgroundColor: color,
                color: '#fff',
                padding: '2px 8px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {simPercent}%
            </span>
          )}
          <span
            style={{
              backgroundColor: 'var(--accent)',
              color: '#fff',
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 11,
            }}
          >
            {t(`types.${entry.type as string}`)}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {entry.scope as string}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(entry); }}
              style={{
                background: 'none', border: 'none',
                color: 'var(--accent)', cursor: 'pointer', fontSize: 13,
              }}
            >
              {t('actions.edit')}
            </button>
          )}
          {confirmingDelete ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(entry.id as string); }}
                style={{
                  background: 'none', border: 'none',
                  color: '#fff', backgroundColor: 'var(--error)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  padding: '2px 10px', borderRadius: 4,
                }}
              >
                {t('actions.confirm')}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onCancelDelete?.(); }}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
                }}
              >
                {t('actions.cancel')}
              </button>
            </>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(entry.id as string); }}
              style={{
                background: 'none', border: 'none',
                color: 'var(--error)', cursor: 'pointer', fontSize: 13,
              }}
            >
              {t('actions.delete')}
            </button>
          )}
        </div>
      </div>

      {(entry.title as string) && (
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
          {entry.title as string}
        </h4>
      )}
      <p
        style={{
          color: 'var(--text-primary)',
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: 8,
          opacity: (entry.title as string) ? 0.7 : 1,
        }}
      >
        {(entry.content as string).substring(0, 200)}
        {(entry.content as string).length > 200 ? '...' : ''}
      </p>

      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        {((entry.tags as string[]) ?? []).map((tag) => (
          <button
            key={tag}
            onClick={(e) => { e.stopPropagation(); onTagClick(tag); }}
            style={{
              backgroundColor: 'var(--bg-input)',
              color: 'var(--accent)',
              padding: '2px 8px',
              borderRadius: 10,
              fontSize: 11,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {tag}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        v{entry.version as number} •{' '}
        {entry.agentId ? `Agent: ${entry.agentId}` : ''} •{' '}
        {new Date(entry.createdAt as string).toLocaleDateString()}
      </div>
    </div>
  );
}
