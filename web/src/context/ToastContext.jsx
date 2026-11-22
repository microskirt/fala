import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, opts = {}) => {
      const id = ++seq;
      const toast = { id, message, tone: opts.tone || 'default' };
      setToasts((list) => [...list.slice(-3), toast]);
      const timeout = opts.duration ?? (opts.tone === 'error' ? 5200 : 3200);
      const timer = setTimeout(() => dismiss(id), timeout);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  const api = {
    toast: push,
    success: (m, o) => push(m, { ...o, tone: 'success' }),
    error: (m, o) => push(m, { ...o, tone: 'error' }),
    info: (m, o) => push(m, { ...o, tone: 'info' }),
    dismiss,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-layer" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.tone === 'success' && <CheckCircle2 size={16} color="var(--success)" />}
            {t.tone === 'error' && <AlertCircle size={16} color="var(--danger)" />}
            {t.tone === 'info' && <Info size={16} color="var(--info)" />}
            <span style={{ minWidth: 0 }}>{t.message}</span>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              style={{ marginLeft: 'auto' }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
