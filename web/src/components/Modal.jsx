import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, footer, wide = false, closeOnBackdrop = true }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        const focusable = ref.current?.querySelector(
          'input:not([type="hidden"]), textarea, select, button'
        );
        focusable?.focus?.();
      }, 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        {title && (
          <div className="modal-header">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={17} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = false, busy = false }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-dim)' }}>{message}</p>
    </Modal>
  );
}
