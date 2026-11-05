import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { Button } from './ui/button.js';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  /** When set, rendered in the error color above the buttons. Callers keep the
   *  modal OPEN on mutation failure and pass the error here (never silently close). */
  errorText?: string | null;
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmLabel, loading, errorText }: ConfirmModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
          padding: 24, maxWidth: 400, width: '90%',
        }}
      >
        <h2 id={titleId} style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{title}</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>{message}</p>
        {errorText && (
          <p style={{ fontSize: 13, color: 'var(--error, #ef4444)', marginBottom: 16 }}>{errorText}</p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && (
              <span style={{
                display: 'inline-block', width: 12, height: 12,
                border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
                borderRadius: '50%', animation: 'spin 0.6s linear infinite',
              }} />
            )}
            {confirmLabel || t('actions.confirm')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
