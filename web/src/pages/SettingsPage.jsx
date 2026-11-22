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
} from 'lucide-react';
import { formatDate, formatCount } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { usePrefs } from '../prefs.js';
import { Avatar } from '../components/Media.jsx';
import { Modal } from '../components/Modal.jsx';

const SECTIONS = [
  { id: 'profile', label: 'Account', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'playback', label: 'Playback', icon: Headphones },
];

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
