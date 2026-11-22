import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  User,
  Palette,
  Headphones,
  ShieldCheck,
  Bell,
  Lock,
  Trash2,
  Check,
  Copy,
  Loader2,
  AlertCircle,
  Sun,
  Moon,
  Cat,
  Eye,
  EyeOff,
  KeyRound,
  QrCode,
  Download,
  LogOut,
} from 'lucide-react';
import QRCode from 'qrcode';
import { api, formatDate } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Avatar } from '../components/Media.jsx';
import { Modal, ConfirmDialog } from '../components/Modal.jsx';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'playback', label: 'Playback', icon: Headphones },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'account', label: 'Account', icon: Lock },
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
  const { user, patchSettings, updateProfile, logout, refresh } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();

  const [profileForm, setProfileForm] = useState({
    username: '',
    bio: '',
    city: '',
    country_code: '',
    avatar_url: '',
    banner_url: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);

  const [totpSetup, setTotpSetup] = useState(null);
  const [totpQr, setTotpQr] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState(null);
  const [disableTotp, setDisableTotp] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileForm({
        username: user.username || '',
        bio: user.description || '',
        city: user.city || '',
        country_code: user.country_code || '',
        avatar_url: user.avatar_url || '',
        banner_url: user.banner_url || '',
      });
    }
  }, [user?.id]);

  const setSection = (id) => {
    const p = new URLSearchParams(params);
    p.set('tab', id);
    setParams(p, { replace: true });
  };

  if (!user) {
    return (
      <div className="content-inner">
        <div className="empty-state">
          <h3>Sign in to manage your account</h3>
          <Link to="/login" className="btn primary" style={{ marginTop: 14 }}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateProfile({
        username: profileForm.username,
        bio: profileForm.bio,
        city: profileForm.city,
        country_code: profileForm.country_code,
        avatar_url: profileForm.avatar_url,
        banner_url: profileForm.banner_url,
      });
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message || 'Could not save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (pwForm.next !== pwForm.confirm) {
      toast.error('New passwords do not match');
      return;
    }
    if (pwForm.next.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    setSavingPw(true);
    try {
      await api.post('/api/auth/password', { current: pwForm.current, next: pwForm.next });
      setPwForm({ current: '', next: '', confirm: '' });
      toast.success('Password changed');
    } catch (err) {
      toast.error(err.message || 'Could not change password');
    } finally {
      setSavingPw(false);
    }
  };

  const startTotp = async () => {
    setTotpBusy(true);
    try {
      const res = await api.post('/api/auth/totp/setup');
      setTotpSetup(res);
      setTotpCode('');
      const dataUrl = await QRCode.toDataURL(res.uri, {
        margin: 1,
        width: 220,
        color: { dark: '#11111b', light: '#ffffff' },
      });
      setTotpQr(dataUrl);
    } catch (err) {
      toast.error(err.message || 'Could not start two-factor setup');
    } finally {
      setTotpBusy(false);
    }
  };

  const enableTotp = async () => {
    setTotpBusy(true);
    try {
      const res = await api.post('/api/auth/totp/enable', { code: totpCode.trim() });
      setBackupCodes(res.backup_codes);
      setTotpSetup(null);
      setTotpQr(null);
      setTotpCode('');
      await refresh();
      toast.success('Two-factor authentication enabled');
    } catch (err) {
      toast.error(err.message || 'That code did not work');
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmDisableTotp = async () => {
    setTotpBusy(true);
    try {
      await api.post('/api/auth/totp/disable', { password: disablePassword });
      setDisableTotp(false);
      setDisablePassword('');
      setBackupCodes(null);
      await refresh();
      toast.success('Two-factor authentication disabled');
    } catch (err) {
      toast.error(err.message || 'Could not disable two-factor');
    } finally {
      setTotpBusy(false);
    }
  };

  const doDeleteAccount = async () => {
    setDeleteBusy(true);
    try {
      await api.del('/api/me', { password: deletePassword });
      toast.success('Account deleted');
      await logout();
      window.location.href = '/';
    } catch (err) {
      toast.error(err.message || 'Could not delete account');
    } finally {
      setDeleteBusy(false);
    }
  };

  const copyText = async (text, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error('Could not copy');
    }
  };

  const settings = user.settings || {};

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Manage your profile, playback and account security.</p>
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
                  <h3>Your profile</h3>
                  <p>This is how other listeners see you across Wavefront.</p>
                </header>
                <div className="body">
                  <div className="row" style={{ gap: 14 }}>
                    <Avatar src={user.avatar_url} name={user.username} size={64} />
                    <div>
                      <strong style={{ fontSize: 14 }}>{user.username}</strong>
                      <div className="faint" style={{ fontSize: 12.5 }}>
                        wavefront.app/u/{user.permalink}
                      </div>
                    </div>
                  </div>

                  <label className="field">
                    <span className="label">Display name</span>
                    <input
                      className="input"
                      value={profileForm.username}
                      onChange={(e) => setProfileForm((f) => ({ ...f, username: e.target.value }))}
                      maxLength={60}
                    />
                  </label>

                  <label className="field">
                    <span className="label">Avatar image URL</span>
                    <input
                      className="input"
                      value={profileForm.avatar_url ?? ''}
                      placeholder="https://…"
                      onChange={(e) => setProfileForm((f) => ({ ...f, avatar_url: e.target.value }))}
                    />
                    <span className="hint">Paste a direct image link. Leave empty to use initials.</span>
                  </label>

                  <label className="field">
                    <span className="label">Bio</span>
                    <textarea
                      className="textarea"
                      value={profileForm.bio}
                      onChange={(e) => setProfileForm((f) => ({ ...f, bio: e.target.value }))}
                      maxLength={2000}
                      placeholder="Tell people what you are into."
                    />
                  </label>

                  <div className="form-row">
                    <label className="field">
                      <span className="label">City</span>
                      <input
                        className="input"
                        value={profileForm.city}
                        onChange={(e) => setProfileForm((f) => ({ ...f, city: e.target.value }))}
                        maxLength={80}
                      />
                    </label>
                    <label className="field">
                      <span className="label">Country code</span>
                      <input
                        className="input"
                        value={profileForm.country_code}
                        onChange={(e) =>
                          setProfileForm((f) => ({
                            ...f,
                            country_code: e.target.value.toUpperCase().slice(0, 2),
                          }))
                        }
                        placeholder="DE"
                        maxLength={2}
                      />
                    </label>
                  </div>

                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={saveProfile}
                      disabled={savingProfile}
                    >
                      {savingProfile ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                      {savingProfile ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <header>
                  <h3>Banner</h3>
                  <p>Optional image shown at the top of your profile.</p>
                </header>
                <div className="body">
                  <label className="field">
                    <span className="label">Banner image URL</span>
                    <input
                      className="input"
                      value={profileForm.banner_url ?? ''}
                      placeholder="https://…"
                      onChange={(e) => setProfileForm((f) => ({ ...f, banner_url: e.target.value }))}
                    />
                  </label>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn" onClick={saveProfile} disabled={savingProfile}>
                      Save banner
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
                <p>Pick a look. Your choice follows you across devices.</p>
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
                        onClick={async () => {
                          setTheme(t.id);
                          try {
                            await patchSettings({ theme: t.id });
                          } catch {}
                        }}
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
                        aria-pressed={settings.quality === q.id}
                        onClick={async () => {
                          try {
                            await patchSettings({ quality: q.id });
                            toast.success(`Quality set to ${q.title.split(' —')[0]}`);
                          } catch (err) {
                            toast.error(err.message);
                          }
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
                    checked={settings.autoplay}
                    onChange={(v) => patchSettings({ autoplay: v }).catch(() => {})}
                  />
                  <SwitchRow
                    title="Normalise volume"
                    description="Even out loud and quiet tracks automatically."
                    checked={settings.normalize}
                    onChange={(v) => patchSettings({ normalize: v }).catch(() => {})}
                  />
                </div>
              </div>
            </>
          )}

          {section === 'security' && (
            <>
              <div className="settings-group">
                <header>
                  <h3>Password</h3>
                  <p>Use at least 8 characters. A passphrase works well.</p>
                </header>
                <div className="body">
                  <label className="field">
                    <span className="label">Current password</span>
                    <input
                      className="input"
                      type="password"
                      value={pwForm.current}
                      onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
                      autoComplete="current-password"
                    />
                  </label>
                  <div className="form-row">
                    <label className="field">
                      <span className="label">New password</span>
                      <input
                        className="input"
                        type="password"
                        value={pwForm.next}
                        onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="field">
                      <span className="label">Confirm new password</span>
                      <input
                        className="input"
                        type="password"
                        value={pwForm.confirm}
                        onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={changePassword}
                      disabled={savingPw || !pwForm.current || !pwForm.next}
                    >
                      {savingPw ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}
                      Change password
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <header>
                  <h3>Two-factor authentication</h3>
                  <p>Protect your account with a TOTP authenticator app.</p>
                </header>
                <div className="body">
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>
                        {user.totp_enabled ? 'Two-factor is enabled' : 'Two-factor is off'}
                      </strong>
                      <span>
                        {user.totp_enabled
                          ? 'You will be asked for a 6-digit code when signing in.'
                          : 'Works with Authy, 1Password, Google Authenticator and similar apps.'}
                      </span>
                    </div>
                    <div className="control">
                      {user.totp_enabled ? (
                        <button
                          type="button"
                          className="btn danger"
                          onClick={() => setDisableTotp(true)}
                        >
                          Disable
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn primary"
                          onClick={startTotp}
                          disabled={totpBusy}
                        >
                          {totpBusy ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
                          Set up
                        </button>
                      )}
                    </div>
                  </div>

                  {totpSetup && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
                      <div className="divider" style={{ margin: 0 }} />
                      <div className="step-list">
                        <div className="step">
                          <span className="num">1</span>
                          <div className="step-body">
                            <strong>Scan this code</strong> with your authenticator app, or enter the
                            setup key manually.
                          </div>
                        </div>
                      </div>
                      {totpQr && (
                        <div className="qr-box">
                          <img src={totpQr} alt="Two-factor QR code" width={200} height={200} />
                        </div>
                      )}
                      <div className="secret-box">
                        <QrCode size={15} style={{ flex: 'none' }} />
                        <span style={{ flex: 1 }}>{totpSetup.secret}</span>
                        <button
                          type="button"
                          className="icon-btn sm"
                          onClick={() => copyText(totpSetup.secret, 'Setup key copied')}
                          aria-label="Copy setup key"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                      <div className="step">
                        <span className="num">2</span>
                        <div className="step-body">
                          <strong>Enter the 6-digit code</strong> your app shows to finish setup.
                        </div>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <input
                          className="input totp-code"
                          style={{ flex: 1 }}
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                        />
                        <button
                          type="button"
                          className="btn primary"
                          onClick={enableTotp}
                          disabled={totpBusy || totpCode.length !== 6}
                        >
                          {totpBusy ? <Loader2 size={14} className="spin" /> : 'Verify & enable'}
                        </button>
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => {
                            setTotpSetup(null);
                            setTotpQr(null);
                            setTotpCode('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {section === 'notifications' && (
            <div className="settings-group">
              <header>
                <h3>Notifications</h3>
                <p>Control what lands in your notification feed.</p>
              </header>
              <div className="body">
                <SwitchRow
                  title="Email notifications"
                  description="Occasional product updates and activity digests."
                  checked={settings.email_notifs}
                  onChange={(v) => patchSettings({ email_notifs: v }).catch(() => {})}
                />
                <SwitchRow
                  title="Show reposts on your profile"
                  description="Let reposts appear in your profile activity."
                  checked={settings.show_reposts}
                  onChange={(v) => patchSettings({ show_reposts: v }).catch(() => {})}
                />
                <SwitchRow
                  title="Keep likes private"
                  description="Only you can see the tracks you have liked."
                  checked={settings.private_likes}
                  onChange={(v) => patchSettings({ private_likes: v }).catch(() => {})}
                />
              </div>
            </div>
          )}

          {section === 'account' && (
            <>
              <div className="settings-group">
                <header>
                  <h3>Account details</h3>
                </header>
                <div className="body">
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Email</strong>
                      <span>{user.email || 'Not set'}</span>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Member since</strong>
                      <span>{formatDate(user.created_at)}</span>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Profile URL</strong>
                      <span>wavefront.app/u/{user.permalink}</span>
                    </div>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => copyText(`${window.location.origin}/u/${user.permalink}`, 'Profile link copied')}
                    >
                      <Copy size={13} /> Copy
                    </button>
                  </div>
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Session</strong>
                      <span>Sign out of this browser.</span>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={async () => {
                        await logout();
                        window.location.href = '/';
                      }}
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-group" style={{ borderColor: 'color-mix(in srgb, var(--danger) 32%, var(--border))' }}>
                <header>
                  <h3 style={{ color: 'var(--danger)' }}>Danger zone</h3>
                  <p>These actions are permanent.</p>
                </header>
                <div className="body">
                  <div className="setting-row">
                    <div className="label-block">
                      <strong>Delete account</strong>
                      <span>Remove your profile, likes, playlists and comments forever.</span>
                    </div>
                    <button type="button" className="btn danger" onClick={() => setDeleteOpen(true)}>
                      <Trash2 size={14} /> Delete account
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={!!backupCodes}
        onClose={() => setBackupCodes(null)}
        title="Save your backup codes"
        footer={
          <button type="button" className="btn primary" onClick={() => setBackupCodes(null)}>
            I have saved them
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="auth-alert info">
            <AlertCircle size={15} style={{ flex: 'none', marginTop: 1 }} />
            <span>
              Each code can be used once if you lose access to your authenticator. Store them
              somewhere safe.
            </span>
          </div>
          <div className="backup-codes">
            {backupCodes?.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => copyText(backupCodes.join('\n'), 'Backup codes copied')}
            >
              <Copy size={14} /> Copy all
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const blob = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'wavefront-backup-codes.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={14} /> Download
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={disableTotp}
        onClose={() => setDisableTotp(false)}
        title="Disable two-factor authentication"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDisableTotp(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={confirmDisableTotp}
              disabled={totpBusy || !disablePassword}
            >
              {totpBusy ? 'Disabling…' : 'Disable 2FA'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <p className="muted" style={{ fontSize: 13 }}>
            Confirm your password to turn off two-factor authentication.
          </p>
          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDeleteOpen(false)}>
              Keep my account
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={doDeleteAccount}
              disabled={deleteBusy || !deletePassword}
            >
              {deleteBusy ? 'Deleting…' : 'Delete forever'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="auth-alert">
            <AlertCircle size={15} style={{ flex: 'none', marginTop: 1 }} />
            <span>
              This permanently deletes your profile, likes, playlists and comments. It cannot be
              undone.
            </span>
          </div>
          <label className="field">
            <span className="label">Confirm with your password</span>
            <input
              className="input"
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
