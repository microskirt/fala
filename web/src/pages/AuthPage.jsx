import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Radio,
  KeyRound,
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  Headphones,
  ListMusic,
  Globe2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export function AuthPage() {
  const navigate = useNavigate();
  const { connect, isAuthed } = useAuth();
  const toast = useToast();

  const [token, setTokenInput] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthed) navigate('/', { replace: true });
  }, [isAuthed, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const account = await connect(token);
      toast.success(`Connected as @${account.permalink}`);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not connect that token');
    } finally {
      setBusy(false);
    }
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
          <h1>Your SoundCloud account, with a better face.</h1>
          <p>
            Wavefront is just a front-end. It signs you in with your real SoundCloud account, so
            your likes, reposts, comments, follows and playlists are the real ones.
          </p>
          <ul className="feature-list">
            <li>
              <Headphones size={16} /> Lossless-ready streaming with adjustable quality
            </li>
            <li>
              <ListMusic size={16} /> Your real playlists, likes and reposts
            </li>
            <li>
              <ShieldCheck size={16} /> No Wavefront account, no password, no database
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
            <h1>Connect SoundCloud</h1>
            <p>
              Paste your SoundCloud <code>oauth_token</code>. Wavefront uses it to talk to
              SoundCloud as you.
            </p>
          </div>

          {error && (
            <div className="auth-alert" role="alert">
              <AlertCircle size={15} style={{ flex: 'none', marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <div className="auth-alert info" style={{ marginBottom: 16 }}>
            <ShieldCheck size={15} style={{ flex: 'none', marginTop: 1 }} />
            <span>
              The token stays in this browser and is sent only to your own Wavefront server,
              which forwards it to SoundCloud. It is never saved to disk or committed.
            </span>
          </div>

          <ol className="step-list" style={{ marginBottom: 18 }}>
            <li className="step">
              <span className="num">1</span>
              <div className="step-body">
                Open{' '}
                <a href="https://soundcloud.com" target="_blank" rel="noreferrer">
                  soundcloud.com <ExternalLink size={12} style={{ verticalAlign: '-1px' }} />
                </a>{' '}
                and sign in as usual.
              </div>
            </li>
            <li className="step">
              <span className="num">2</span>
              <div className="step-body">
                Open developer tools, go to <strong>Application → Cookies → soundcloud.com</strong>{' '}
                and copy the value of <code>oauth_token</code>.
              </div>
            </li>
            <li className="step">
              <span className="num">3</span>
              <div className="step-body">Paste it below.</div>
            </li>
          </ol>

          <form className="form-grid" onSubmit={submit}>
            <label className="field">
              <span className="label">SoundCloud oauth_token</span>
              <div className="input-wrap">
                <KeyRound size={16} />
                <input
                  className="input"
                  type={reveal ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="2-123456-123456789-abcdefghijklmn"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <button
                  type="button"
                  className="icon-btn sm"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide token' : 'Show token'}
                >
                  {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>

            <button type="submit" className="btn primary lg block" disabled={busy || !token.trim()}>
              {busy ? (
                <>
                  <Loader2 size={16} className="spin" /> Checking with SoundCloud…
                </>
              ) : (
                <>
                  Connect account <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="notice">
            <ShieldCheck size={15} />
            <span>
              You can disconnect at any time from Settings. To revoke access fully, sign out of
              SoundCloud or change your password.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
