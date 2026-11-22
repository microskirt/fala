import { useMemo, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  User,
  Palette,
  Headphones,
  Check,
  Copy,
  Sun,
  Moon,
  Cat,
  LogOut,
  ExternalLink,
  KeyRound,
  BadgeCheck,
  Calendar,
  MapPin,
  ShieldQuestion,
  ShieldCheck,
  ChevronDown,
  Loader2,
  Eraser,
} from 'lucide-react';
import { formatDate, formatCount, api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useCaptcha } from '../context/CaptchaContext.jsx';
import { usePrefs } from '../prefs.js';
import { Avatar } from '../components/Media.jsx';
import { Modal } from '../components/Modal.jsx';

const SECTIONS = [
  { id: 'profile', label: 'Account', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'playback', label: 'Playback', icon: Headphones },
  { id: 'write', label: 'Write access', icon: ShieldQuestion },
];

function WriteAccessPanel() {
  const { solve, forget } = useCaptcha();
  const toast = useToast();
  const [status, setStatus] = useState(null); // null | { blocked, solved }
  const [checking, setChecking] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const data = await api.get('/api/captcha');
      setStatus({ blocked: data.blocked, solved: data.solved });
    } catch (err) {
      toast.error(err.message || 'Could not check write access');
    } finally {
      setChecking(false);
    }
  };

  const openVerification = async () => {
    const ok = await solve();
    if (ok) {
      setStatus({ blocked: false, solved: true });
      toast.success('Write access unlocked');
    }
  };

  return (
    <div className="settings-group">
      <header>
        <h3>Write access</h3>
        <p>
          Likes, reposts, comments, follows and playlist changes go through SoundCloud's bot
          check. If those actions fail, verify once here.
        </p>
      </header>
      <div className="body">
        <div className="setting-row">
          <div className="label-block">
            <strong>Verification</strong>
            <span>
              {status === null
                ? 'Check whether this connection can currently write to SoundCloud.'
                : status.solved
                  ? 'A solved verification is saved for this connection.'
                  : status.blocked
                    ? 'SoundCloud is currently asking for a verification.'
                    : 'SoundCloud is not asking for a verification right now.'}
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" onClick={check} disabled={checking}>
              {checking ? <Loader2 size={13} className="spin" /> : <ShieldQuestion size={13} />}{' '}
              Check
            </button>
            <button type="button" className="btn sm primary" onClick={openVerification}>
              <ShieldCheck size={13} /> Verify
            </button>
          </div>
        </div>

        <details className="info-banner">
          <summary>
            <ShieldQuestion size={14} /> How to solve this without changing anything
            <ChevronDown size={14} className="chev" />
          </summary>
          <div className="info-body">
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              The check is triggered by a request that <strong>cannot</strong> change your
              account: it asks SoundCloud to add a repost for a track id that does not exist. The
              bot check answers first, and if it ever got through it would only return "not found".
              Nothing is liked, reposted or created.
            </p>
            <ol className="step-list">
              <li className="step">
                <span className="num">1</span>
                <div className="step-body">
                  Press <strong>Verify</strong> above. Wavefront asks SoundCloud for a fresh check
                  and shows it right here.
                </div>
              </li>
              <li className="step">
                <span className="num">2</span>
                <div className="step-body">
                  Solve the visual or audio puzzle in the panel. When it passes, Wavefront receives
                  the result automatically and retries your action.
                </div>
              </li>
              <li className="step">
                <span className="num">3</span>
                <div className="step-body">
                  Prefer to do it by hand? Choose <strong>Paste cookie instead</strong> in that
                  panel, open soundcloud.com in another tab, solve the check there, then copy the{' '}
                  <code>datadome</code> cookie from DevTools →{' '}
                  <strong>Application → Cookies → soundcloud.com</strong>.
                </div>
              </li>
            </ol>
            <p className="hint">
              The result is tied to this server's network address. If writes start failing again
              later, press <strong>Verify</strong> once more.
            </p>
          </div>
        </details>

        <div className="setting-row">
          <div className="label-block">
            <strong>Forget saved verification</strong>
            <span>Clears the stored result on the server. Your SoundCloud account is unchanged.</span>
          </div>
          <button
            type="button"
            className="btn sm danger"
            disabled={forgetting}
            onClick={async () => {
              setForgetting(true);
              const ok = await forget();
              if (ok) setStatus((s) => (s ? { ...s, solved: false } : s));
              setForgetting(false);
            }}
          >
            <Eraser size={13} /> Forget
          </button>
        </div>
      </div>
    </div>
  );
}

const THEMES = [
  {
    id: 'dark',
    name: 'Dark',
    icon: Moon,
    swatch: { bg: '#0c0c0e', elev: '#1b1b20', text: '#f3f3f4', accent: '#ff5500', border: '#292930' },
  },
  {
    id: 'light',
    name: 'Light',
    icon: Sun,
    swatch: { bg: '#fafafb', elev: '#f3f3f5', text: '#17171b', accent: '#f04d00', border: '#e5e5ea' },
  },
  {
    id: 'mocha',
    name: 'Catppuccin Mocha',
    icon: Cat,
    swatch: { bg: '#1e1e2e', elev: '#313244', text: '#cdd6f4', accent: '#fab387', border: '#45475a' },
  },
];

function ThemeSwatch({ swatch }) {
  return (
    <div className="swatch" style={{ background: swatch.bg, borderColor: swatch.border }}>
      <div className="bar wide" style={{ background: swatch.text, opacity: 0.85 }} />
      <div className="bar mid" style={{ background: swatch.border }} />
      <div className="row-bars">
        <div className="bar" style={{ background: swatch.accent }} />
        <div className="bar" style={{ background: swatch.elev }} />
        <div className="bar" style={{ background: swatch.elev }} />
      </div>
    </div>
  );
}

function SwitchRow({ title, description, checked, onChange }) {
  return (
    <div className="setting-row">
      <div className="label-block">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={!!checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const section = params.get('tab') || 'profile';
  const { user, disconnect } = useAuth();
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = usePrefs();
  const toast = useToast();
  const navigate = useNavigate();
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const setSection = (id) => {
    const p = new URLSearchParams(params);
    p.set('tab', id);
    setParams(p, { replace: true });
  };

  const copyText = async (text, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error('Could not copy');
    }
  };

  if (!user) {
    return (
      <div className="content-inner">
        <div className="empty-state">
          <h3>Connect your SoundCloud account</h3>
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Wavefront has no accounts of its own. Connect SoundCloud to use your real profile.
          </p>
          <Link to="/login" className="btn primary" style={{ marginTop: 14 }}>
            <KeyRound size={15} /> Connect SoundCloud
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Your SoundCloud account, plus how Wavefront looks and sounds.</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                className={section === s.id ? 'active' : ''}
                onClick={() => setSection(s.id)}
              >
                <Icon size={15} /> {s.label}
              </button>
            );
          })}
        </nav>

        <div className="settings-panel">
          {section === 'profile' && (
            <>
              <div className="settings-group">
                <header>
                  <h3>Connected account</h3>
                  <p>
                    Wavefront is signed in to your real SoundCloud account. Edits to your name,
                    avatar and bio are made on SoundCloud.
                  </p>
                </header>
                <div className="body">
                  <div className="row" style={{ gap: 14 }}>
                    <Avatar src={user.avatar_url} name={user.username} size={64} />
                    <div>
                      <strong style={{ fontSize: 14 }}>
                        {user.username}
                        {user.verified && (
                          <BadgeCheck size={15} color="var(--accent)" style={{ verticalAlign: '-2px', marginLeft: 4 }} />
                        )}
                      </strong>
                      <div className="faint" style={{ fontSize: 12.5 }}>
                        @{user.permalink}
                      </div>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Followers</strong>
                      <span>{formatCount(user.followers_count)} people follow you</span>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Following</strong>
                      <span>You follow {formatCount(user.followings_count)} accounts</span>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Tracks</strong>
                      <span>{formatCount(user.track_count)} uploaded</span>
                    </div>
                  </div>
                  {user.city && (
                    <div className="setting-row">
                      <div className="label-block">
                        <strong>Location</strong>
                        <span>
                          <MapPin size={12} style={{ verticalAlign: '-1px' }} /> {user.city}
                          {user.country_code ? `, ${user.country_code}` : ''}
                        </span>
                      </div>
                    </div>
                  )}
                  {user.created_at && (
                    <div className="setting-row">
                      <div className="label-block">
                        <strong>On SoundCloud since</strong>
                        <span>
                          <Calendar size={12} style={{ verticalAlign: '-1px' }} />{' '}
                          {formatDate(user.created_at)}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>SoundCloud profile</strong>
                      <span>soundcloud.com/{user.permalink}</span>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          copyText(`https://soundcloud.com/${user.permalink}`, 'Profile link copied')
                        }
                      >
                        <Copy size={13} /> Copy
                      </button>
                      <a
                        className="btn sm"
                        href={`https://soundcloud.com/${user.permalink}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={13} /> Open
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <header>
                  <h3>Connection</h3>
                  <p>
                    Wavefront keeps your token in this browser only. It is not stored on the
                    server.
                  </p>
                </header>
                <div className="body">
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Disconnect this browser</strong>
                      <span>Forget the token here. Your SoundCloud account is unchanged.</span>
                    </div>
                    <button type="button" className="btn danger" onClick={() => setDisconnectOpen(true)}>
                      <LogOut size={14} /> Disconnect
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {section === 'appearance' && (
            <div className="settings-group">
              <header>
                <h3>Theme</h3>
                <p>Pick a look. Stored in this browser.</p>
              </header>
              <div className="body">
                <div className="theme-picker">
                  {THEMES.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className="theme-option"
                        aria-pressed={theme === t.id}
                        onClick={() => setTheme(t.id)}
                      >
                        <ThemeSwatch swatch={t.swatch} />
                        <span className="name">
                          <span className="row" style={{ gap: 6 }}>
                            <Icon size={13} /> {t.name}
                          </span>
                          {theme === t.id && (
                            <span className="tick">
                              <Check size={14} />
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="hint">
                  Themes apply instantly. Catppuccin Mocha uses the official palette.
                </p>
              </div>
            </div>
          )}

          {section === 'write' && <WriteAccessPanel />}

          {section === 'playback' && (
            <>
              <div className="settings-group">
                <header>
                  <h3>Streaming quality</h3>
                  <p>Higher quality uses more bandwidth. Changes apply to the next track.</p>
                </header>
                <div className="body">
                  <div className="quality-options">
                    {[
                      { id: 'hq', title: 'High — 160 kbps', desc: 'Best available AAC stream. Recommended.' },
                      { id: 'sq', title: 'Standard — 96 kbps', desc: 'Balanced quality for slower connections.' },
                      { id: 'lq', title: 'Data saver', desc: 'Lowest bitrate to stretch mobile data.' },
                    ].map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        className="quality-option"
                        aria-pressed={prefs.quality === q.id}
                        onClick={() => {
                          setPrefs({ quality: q.id });
                          toast.success(`Quality set to ${q.title.split(' —')[0]}`);
                        }}
                      >
                        <span className="radio" />
                        <span className="q-body">
                          <strong>{q.title}</strong>
                          <span>{q.desc}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <header>
                  <h3>Playback behaviour</h3>
                  <p>Fine-tune how the player behaves.</p>
                </header>
                <div className="body">
                  <SwitchRow
                    title="Autoplay similar tracks"
                    description="Keep the music going when the queue runs out."
                    checked={prefs.autoplay}
                    onChange={(v) => setPrefs({ autoplay: v })}
                  />
                  <SwitchRow
                    title="Normalise volume"
                    description="Even out loud and quiet tracks automatically."
                    checked={prefs.normalize}
                    onChange={(v) => setPrefs({ normalize: v })}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect SoundCloud?"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await disconnect();
                setDisconnectOpen(false);
                navigate('/');
              }}
            >
              Disconnect
            </button>
          </>
        }
      >
        <p className="muted" style={{ fontSize: 13 }}>
          Wavefront will forget the token in this browser. You stay signed in on SoundCloud
          itself, and can reconnect any time by pasting the token again.
        </p>
      </Modal>
    </div>
  );
}
