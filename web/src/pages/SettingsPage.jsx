import { useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
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
import { formatDate, formatCount, api } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useTheme } from '@/context/ThemeContext.jsx';
import { useToast } from '@/context/ToastContext.jsx';
import { useCaptcha } from '@/context/CaptchaContext.jsx';
import { usePrefs } from '@/prefs.js';
import { Avatar } from '@/components/Media.jsx';
import { Modal } from '@/components/Modal.jsx';
import { Page, PageHeader } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { cn } from '@/lib/utils.js';

const SECTIONS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'playback', label: 'Playback', icon: Headphones },
  { id: 'write', label: 'Write access', icon: ShieldQuestion },
];

function Group({ title, description, children }) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border bg-card last:mb-0">
      <header className="border-b px-5 py-4">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function Row({ title, description, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-medium">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

function WriteAccessPanel() {
  const { solve, forget } = useCaptcha();
  const toast = useToast();
  const [status, setStatus] = useState(null);
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

  const statusText =
    status === null
      ? 'Check whether this connection can currently write to SoundCloud.'
      : status.solved
        ? 'A solved verification is saved for this connection.'
        : status.blocked
          ? 'SoundCloud is currently asking for a verification.'
          : 'SoundCloud is not asking for a verification right now.';

  return (
    <Group
      title="Write access"
      description="Likes, reposts, comments, follows and playlist changes go through SoundCloud bot check. If those actions fail, verify once here."
    >
      <Row title="Verification" description={statusText}>
        <Button variant="outline" size="sm" onClick={check} disabled={checking}>
          {checking ? <Loader2 size={13} className="animate-spin" /> : <ShieldQuestion size={13} />}
          Check
        </Button>
        <Button size="sm" onClick={openVerification}>
          <ShieldCheck size={13} /> Verify
        </Button>
      </Row>

      <details className="group px-5 py-3.5">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ShieldQuestion size={14} /> How to solve this without changing anything
          <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 flex flex-col gap-3 text-[13px] leading-relaxed text-muted-foreground">
          <p>
            The check is triggered by a request that <strong className="text-foreground">cannot</strong>{' '}
            change your account: it asks SoundCloud to add a repost for a track id that does not
            exist. The bot check answers first, and if it ever got through it would only return
            &ldquo;not found&rdquo;. Nothing is liked, reposted or created.
          </p>
          <ol className="flex flex-col gap-3">
            {[
              <>
                Press <strong className="text-foreground">Verify</strong> above. Wavefront asks
                SoundCloud for a fresh check and shows it right here.
              </>,
              <>
                Solve the visual or audio puzzle in the panel. When it passes, Wavefront receives
                the result automatically and retries your action.
              </>,
              <>
                Prefer to do it by hand? Choose{' '}
                <strong className="text-foreground">Paste cookie instead</strong> in that panel,
                open soundcloud.com in another tab, solve the check there, then copy the{' '}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">datadome</code>{' '}
                cookie from DevTools &rarr;{' '}
                <strong className="text-foreground">Application &rarr; Cookies &rarr; soundcloud.com</strong>.
              </>,
            ].map((text, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground/80">
            The result is tied to this server network address. If writes start failing again
            later, press <strong className="text-foreground">Verify</strong> once more.
          </p>
        </div>
      </details>

      <Row
        title="Forget saved verification"
        description="Clears the stored result on the server. Your SoundCloud account is unchanged."
      >
        <Button
          variant="destructive"
          size="sm"
          disabled={forgetting}
          onClick={async () => {
            setForgetting(true);
            const ok = await forget();
            if (ok) setStatus((s) => (s ? { ...s, solved: false } : s));
            setForgetting(false);
          }}
        >
          <Eraser size={13} /> Forget
        </Button>
      </Row>
    </Group>
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
    <div
      className="flex h-20 w-full flex-col gap-1.5 rounded-lg border p-2.5"
      style={{ background: swatch.bg, borderColor: swatch.border }}
    >
      <div className="h-1.5 w-3/5 rounded-full" style={{ background: swatch.text, opacity: 0.85 }} />
      <div className="h-1.5 w-2/5 rounded-full" style={{ background: swatch.border }} />
      <div className="mt-auto flex gap-1.5">
        <div className="h-3 flex-1 rounded" style={{ background: swatch.accent }} />
        <div className="h-3 flex-1 rounded" style={{ background: swatch.elev }} />
        <div className="h-3 flex-1 rounded" style={{ background: swatch.elev }} />
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { tab = 'account' } = useSearch();
  const section = SECTIONS.some((s) => s.id === tab) ? tab : 'account';
  const navigate = useNavigate();
  const { user, disconnect } = useAuth();
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = usePrefs();
  const toast = useToast();
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const setSection = (id) => {
    navigate({ to: '/settings', search: { tab: id }, replace: true });
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
      <Page>
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
          <h2 className="text-base font-semibold">Connect your SoundCloud account</h2>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            Wavefront has no accounts of its own. Connect SoundCloud to use your real profile.
          </p>
          <Button className="mt-5" asChild>
            <Link to="/login">
              <KeyRound size={15} /> Connect SoundCloud
            </Link>
          </Button>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Your SoundCloud account, plus how Wavefront looks and sounds."
      />

      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav
          className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible"
          aria-label="Settings sections"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
                section === s.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <s.icon size={15} /> {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {section === 'account' ? (
            <>
              <Group
                title="Connected account"
                description="Wavefront is signed in to your real SoundCloud account. Edits to your name, avatar and bio are made on SoundCloud."
              >
                <div className="flex items-center gap-3.5 px-5 py-4">
                  <Avatar src={user.avatar_url} name={user.username} size={64} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      {user.username}
                      {user.verified ? <BadgeCheck size={15} className="text-primary" /> : null}
                    </div>
                    <div className="text-[12.5px] text-muted-foreground">@{user.permalink}</div>
                  </div>
                </div>
                <Row
                  title="Followers"
                  description={`${formatCount(user.followers_count)} people follow you`}
                />
                <Row
                  title="Following"
                  description={`You follow ${formatCount(user.followings_count)} accounts`}
                />
                <Row title="Tracks" description={`${formatCount(user.track_count)} uploaded`} />
                {user.city ? (
                  <Row
                    title="Location"
                    description={
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} /> {user.city}
                        {user.country_code ? `, ${user.country_code}` : ''}
                      </span>
                    }
                  />
                ) : null}
                {user.created_at ? (
                  <Row
                    title="On SoundCloud since"
                    description={
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={12} /> {formatDate(user.created_at)}
                      </span>
                    }
                  />
                ) : null}
                <Row title="SoundCloud profile" description={`soundcloud.com/${user.permalink}`}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copyText(`https://soundcloud.com/${user.permalink}`, 'Profile link copied')
                    }
                  >
                    <Copy size={13} /> Copy
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`https://soundcloud.com/${user.permalink}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={13} /> Open
                    </a>
                  </Button>
                </Row>
              </Group>

              <Group
                title="Connection"
                description="Wavefront keeps your token in this browser only. It is not stored on the server."
              >
                <Row
                  title="Disconnect this browser"
                  description="Forget the token here. Your SoundCloud account is unchanged."
                >
                  <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
                    <LogOut size={14} /> Disconnect
                  </Button>
                </Row>
              </Group>
            </>
          ) : null}

          {section === 'appearance' ? (
            <Group title="Theme" description="Pick a look. Stored in this browser.">
              <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={theme === t.id}
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      'rounded-xl border p-2.5 text-left transition-colors',
                      theme === t.id
                        ? 'border-primary ring-2 ring-primary/25'
                        : 'border-border hover:border-foreground/25'
                    )}
                  >
                    <ThemeSwatch swatch={t.swatch} />
                    <span className="mt-2 flex items-center gap-1.5 text-[13px] font-medium">
                      <t.icon size={13} /> {t.name}
                      {theme === t.id ? <Check size={14} className="ml-auto text-primary" /> : null}
                    </span>
                  </button>
                ))}
              </div>
              <div className="px-5 py-3 text-xs text-muted-foreground">
                Themes apply instantly. Catppuccin Mocha uses the official palette.
              </div>
            </Group>
          ) : null}

          {section === 'write' ? <WriteAccessPanel /> : null}

          {section === 'playback' ? (
            <>
              <Group
                title="Streaming quality"
                description="Higher quality uses more bandwidth. Changes apply to the next track."
              >
                <div className="flex flex-col gap-2 px-5 py-4">
                  {[
                    {
                      id: 'hq',
                      title: 'High - 160 kbps',
                      desc: 'Best available AAC stream. Recommended.',
                    },
                    {
                      id: 'sq',
                      title: 'Standard - 96 kbps',
                      desc: 'Balanced quality for slower connections.',
                    },
                    {
                      id: 'lq',
                      title: 'Data saver',
                      desc: 'Lowest bitrate to stretch mobile data.',
                    },
                  ].map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      aria-pressed={prefs.quality === q.id}
                      onClick={() => {
                        setPrefs({ quality: q.id });
                        toast.success(`Quality set to ${q.title.split(' -')[0]}`);
                      }}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors',
                        prefs.quality === q.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-foreground/25'
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded-full border-2',
                          prefs.quality === q.id
                            ? 'border-primary'
                            : 'border-muted-foreground/50'
                        )}
                      >
                        {prefs.quality === q.id ? (
                          <span className="size-2 rounded-full bg-primary" />
                        ) : null}
                      </span>
                      <span className="min-w-0 leading-tight">
                        <span className="block text-[13px] font-medium">{q.title}</span>
                        <span className="block text-xs text-muted-foreground">{q.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Group>

              <Group title="Playback behaviour" description="Fine-tune how the player behaves.">
                <Row
                  title="Autoplay similar tracks"
                  description="Keep the music going when the queue runs out."
                >
                  <Switch
                    checked={!!prefs.autoplay}
                    onCheckedChange={(v) => setPrefs({ autoplay: v })}
                    aria-label="Autoplay similar tracks"
                  />
                </Row>
                <Row
                  title="Normalise volume"
                  description="Even out loud and quiet tracks automatically."
                >
                  <Switch
                    checked={!!prefs.normalize}
                    onCheckedChange={(v) => setPrefs({ normalize: v })}
                    aria-label="Normalise volume"
                  />
                </Row>
              </Group>
            </>
          ) : null}
        </div>
      </div>

      <Modal
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect SoundCloud?"
        footer={
          <>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await disconnect();
                setDisconnectOpen(false);
                navigate({ to: '/' });
              }}
            >
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Wavefront will forget the token in this browser. You stay signed in on SoundCloud
          itself, and can reconnect any time by pasting the token again.
        </p>
      </Modal>
    </Page>
  );
}
