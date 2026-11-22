import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Radio,
  Mail,
  Lock,
  User,
  Link2,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
  Check,
  Sparkles,
  Headphones,
  ListMusic,
  Globe2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../api.js';

export function AuthPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'register' ? 'register' : 'login';
  const navigate = useNavigate();
  const { login, register, isAuthed } = useAuth();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [permalink, setPermalink] = useState('');
  const [code, setCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [permalinkState, setPermalinkState] = useState(null);
  const codeRef = useRef(null);

  useEffect(() => {
    if (isAuthed) navigate('/', { replace: true });
  }, [isAuthed, navigate]);

  useEffect(() => {
    if (mfaRequired) setTimeout(() => codeRef.current?.focus(), 80);
  }, [mfaRequired]);

  useEffect(() => {
    setError('');
    setMfaRequired(false);
    setCode('');
  }, [mode]);

  // Suggest a permalink from the display name.
  useEffect(() => {
    if (mode !== 'register') return;
    const slug = username
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    setPermalink(slug);
  }, [username, mode]);

  useEffect(() => {
    if (mode !== 'register' || !permalink) {
      setPermalinkState(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/api/auth/check-permalink?value=${encodeURIComponent(permalink)}`);
        if (!cancelled) setPermalinkState(res);
      } catch {
        if (!cancelled) setPermalinkState(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [permalink, mode]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') {
        if (permalinkState && !permalinkState.available) {
          setError('That profile URL is already taken');
          setBusy(false);
          return;
        }
        await register({ email, password, username, permalink });
        toast.success('Welcome to Wavefront!');
        navigate('/', { replace: true });
      } else {
        const res = await login(email, password, mfaRequired ? code : undefined);
        if (res && res.mfa_required) {
          setMfaRequired(true);
          toast.info('Enter the 6-digit code from your authenticator app');
          return;
        }
        toast.success('Signed in');
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
      if (err.data?.mfa_required) setMfaRequired(true);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next) => {
    const p = new URLSearchParams(params);
    p.set('mode', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="auth-page">
      <div className="auth-art">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Radio size={17} strokeWidth={2.4} />
          </span>
          <span>
            Wavefront
            <small>Sound, reimagined</small>
          </span>
        </Link>

        <div className="pitch">
          <h1>Everything you love about SoundCloud, with a better face.</h1>
          <p>
            Stream the full SoundCloud catalogue in a fast, focused interface. Build playlists,
            follow artists and keep the conversation going — all in one place.
          </p>
          <ul className="feature-list">
            <li>
              <Headphones size={16} /> Lossless-ready streaming with adjustable quality
            </li>
            <li>
              <ListMusic size={16} /> Playlists, likes and reposts that stay in sync
            </li>
            <li>
              <ShieldCheck size={16} /> Two-factor authentication with backup codes
            </li>
            <li>
              <Globe2 size={16} /> Three hand-tuned themes, including Catppuccin Mocha
            </li>
          </ul>
        </div>

        <div className="foot">
          Wavefront is an independent front-end. Music and metadata belong to SoundCloud and
          their respective creators.
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <div className="head">
            <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
            <p>
              {mode === 'login'
                ? 'Sign in to pick up where you left off.'
                : 'A few details and you are in. No credit card, no noise.'}
            </p>
          </div>

          {error && (
            <div className="auth-alert" role="alert">
              <AlertCircle size={15} style={{ flex: 'none', marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <form className="form-grid" onSubmit={submit}>
            {mode === 'register' && (
              <>
                <label className="field">
                  <span className="label">Display name</span>
                  <div className="input-wrap">
                    <User size={16} />
                    <input
                      className="input"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="How should we call you?"
                      autoComplete="nickname"
                      required
                      minLength={2}
                      maxLength={60}
                    />
                  </div>
                </label>

                <label className="field">
                  <span className="label">Profile URL</span>
                  <div className="input-wrap">
                    <Link2 size={16} />
                    <input
                      className="input"
                      value={permalink}
                      onChange={(e) =>
                        setPermalink(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                      }
                      placeholder="your-handle"
                      maxLength={32}
                    />
                  </div>
                  {permalinkState && (
                    <span className={`hint ${permalinkState.available ? 'ok' : 'error'}`}>
                      {permalinkState.available ? (
                        <>
                          <Check size={11} style={{ verticalAlign: '-1px' }} /> wavefront.app/u/
                          {permalink} is available
                        </>
                      ) : (
                        'That profile URL is not available'
                      )}
                    </span>
                  )}
                </label>
              </>
            )}

            <label className="field">
              <span className="label">Email</span>
              <div className="input-wrap">
                <Mail size={16} />
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
            </label>

            <label className="field">
              <span className="label">Password</span>
              <div className="input-wrap">
                <Lock size={16} />
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                />
              </div>
            </label>

            {mfaRequired && (
              <label className="field">
                <span className="label">Two-factor code</span>
                <input
                  ref={codeRef}
                  className="input totp-code"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/[-9A-Za-z]/g, '').toUpperCase().slice(0, 11))
                  }
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
                <span className="hint">
                  Enter the 6-digit code from your authenticator, or a backup code.
                </span>
              </label>
            )}

            <button type="submit" className="btn primary lg block" disabled={busy}>
              {busy ? (
                'Working…'
              ) : (
                <>
                  {mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="auth-divider">or</div>

          <div className="auth-switch">
            {mode === 'login' ? (
              <>
                New to Wavefront?{' '}
                <button type="button" onClick={() => switchMode('register')}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')}>
                  Sign in
                </button>
              </>
            )}
          </div>

          <div className="notice">
            <Sparkles size={15} />
            <span>
              This build keeps accounts locally so you can explore every feature. Your
              SoundCloud catalogue data stays live and read-only.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
