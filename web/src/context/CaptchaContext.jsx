import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../api.js';
import { useToast } from './ToastContext.jsx';
import { CaptchaModal } from '../components/CaptchaModal.jsx';

/*
 * SoundCloud's bot check (DataDome) sits in front of write actions. Its challenge
 * page is designed to be embedded: on success it posts the solved `datadome`
 * cookie to the parent window. We show that page in a modal, take the cookie from
 * the message, hand it to our proxy, and retry the write that was blocked.
 *
 * Nothing here weakens the check. A real person still has to solve it.
 */

const CaptchaContext = createContext(null);

const CHALLENGE_ORIGINS = new Set([
  'https://geo.captcha-delivery.com',
  'https://ct.captcha-delivery.com',
]);

export function CaptchaProvider({ children }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const waiter = useRef(null);
  const inFlight = useRef(null);

  const settle = useCallback((ok) => {
    const resolve = waiter.current;
    waiter.current = null;
    setOpen(false);
    setUrl('');
    setError('');
    setSaving(false);
    setLoading(false);
    resolve?.(ok);
  }, []);

  const close = useCallback(() => settle(false), [settle]);

  const store = useCallback(
    async (cookie) => {
      // DataDome ties the verdict to the UA that solved it, and this browser is
      // the one that solved it, so the server has to replay it as this UA.
      await api.post('/api/captcha', {
        cookie,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
    },
    []
  );

  // Open the challenge and resolve once the cookie is stored (or cancelled).
  const solve = useCallback(async () => {
    if (inFlight.current) return inFlight.current;

    setError('');
    setLoading(true);
    setOpen(true);

    const run = (async () => {
      try {
        const data = await api.get('/api/captcha');
        if (!data.blocked || !data.url) {
          setOpen(false);
          setLoading(false);
          toast.success('Write access is already working');
          return true;
        }
        setUrl(data.url);
        setLoading(false);
        return await new Promise((resolve) => {
          waiter.current = resolve;
        });
      } catch (err) {
        setLoading(false);
        setError(err.message || 'Could not load the verification');
        return false;
      }
    })();

    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [toast]);

  // DataDome posts {"eventType":"passed","cookie":"…"} to the embedding page.
  useEffect(() => {
    if (!open) return undefined;

    const onMessage = async (event) => {
      if (!CHALLENGE_ORIGINS.has(event.origin)) return;
      let payload = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== 'object') return;
      if (payload.eventType !== 'passed' || !payload.cookie) return;

      setSaving(true);
      setError('');
      try {
        await store(payload.cookie);
        toast.success('Write access unlocked');
        settle(true);
      } catch (err) {
        setSaving(false);
        setError(err.message || 'Could not save the verification');
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, settle, store, toast]);

  // Manual fallback: paste a datadome cookie copied from DevTools.
  const submitCookie = useCallback(
    async (raw) => {
      setSaving(true);
      setError('');
      try {
        await store(raw);
        toast.success('Write access unlocked');
        settle(true);
        return true;
      } catch (err) {
        setSaving(false);
        setError(err.message || 'That cookie was not accepted');
        return false;
      }
    },
    [settle, store, toast]
  );

  const forget = useCallback(async () => {
    try {
      await api.del('/api/captcha');
      toast.info('Saved verification forgotten');
      return true;
    } catch {
      toast.error('Could not forget the verification');
      return false;
    }
  }, [toast]);

  const value = useMemo(
    () => ({ solve, close, submitCookie, forget }),
    [solve, close, submitCookie, forget]
  );

  return (
    <CaptchaContext.Provider value={value}>
      {children}
      <CaptchaModal
        open={open}
        url={url}
        loading={loading}
        saving={saving}
        error={error}
        onClose={close}
        onSubmitCookie={submitCookie}
      />
    </CaptchaContext.Provider>
  );
}

export function useCaptcha() {
  const ctx = useContext(CaptchaContext);
  if (!ctx) throw new Error('useCaptcha must be used inside CaptchaProvider');
  return ctx;
}
