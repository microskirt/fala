import { useState, useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
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
import { useAuth } from '@/context/AuthContext.jsx';
import { useToast } from '@/context/ToastContext.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';

export function AuthPage() {
  const navigate = useNavigate();
  const { connect, isAuthed } = useAuth();
  const toast = useToast();

  const [token, setTokenInput] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthed) navigate({ to: '/', replace: true });
  }, [isAuthed, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const account = await connect(token);
      toast.success(`Connected as @${account.permalink}`);
      navigate({ to: '/', replace: true });
    } catch (err) {
      setError(err.message || 'Could not connect that token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Pitch side */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r bg-card/40 p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 10%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 70%), radial-gradient(50% 45% at 85% 85%, color-mix(in srgb, var(--info) 16%, transparent), transparent 70%)',
          }}
        />
        <Link to="/" className="relative flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Radio size={18} strokeWidth={2.4} />
          </span>
          <span className="leading-tight">
            <span className="block text-base font-semibold tracking-tight">Fala</span>
            <span className="block text-xs text-muted-foreground">A working SoundCloud</span>
          </span>
        </Link>

        <div className="relative max-w-md">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            SoundCloud, with a cleaner interface.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Fala is a front-end for SoundCloud. You sign in with your real account, so your
            likes, reposts, comments and playlists are the real ones.
          </p>
          <ul className="mt-6 flex flex-col gap-3 text-sm text-muted-foreground">
            {[
              [Headphones, 'Adjustable streaming quality'],
              [ListMusic, 'Your real playlists, likes and reposts'],
              [ShieldCheck, 'No Fala account and no password to store'],
              [Globe2, 'Three themes, including Catppuccin Mocha'],
            ].map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-2.5">
                <Icon size={16} className="shrink-0 text-primary" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs leading-relaxed text-muted-foreground/70">
          Fala is an independent front-end. Music and metadata belong to SoundCloud and the
          creators who upload it.
        </p>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Connect SoundCloud</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Paste your SoundCloud <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">oauth_token</code>.
              Fala uses it to talk to SoundCloud as you.
            </p>
          </div>

          {error ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="mb-5 flex items-start gap-2 rounded-lg border bg-muted/50 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" />
            <span>
              The token stays in this browser and is sent only to your own Fala server, which
              forwards it to SoundCloud. It is never saved to disk or committed.
            </span>
          </div>

          <ol className="mb-5 flex flex-col gap-3">
            {[
              <>
                Open{' '}
                <a href="https://soundcloud.com" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                  soundcloud.com <ExternalLink size={14} className="inline" />
                </a>{' '}
                and sign in as usual.
              </>,
              <>
                Open developer tools, go to{' '}
                <strong className="text-foreground">Application → Cookies → soundcloud.com</strong>{' '}
                and copy the value of <code className="rounded-sm bg-muted px-1 font-mono text-xs">oauth_token</code>.
              </>,
              <>Paste it below.</>,
            ].map((text, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>

          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="token">SoundCloud oauth_token</Label>
              <div className="relative">
                <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="token"
                  className="pl-9 pr-10 font-mono text-xs"
                  type={reveal ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="2-123456-123456789-abcdefghijklmn"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide token' : 'Show token'}
                >
                  {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
              </div>
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={busy || !token.trim()}>
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Checking with SoundCloud…
                </>
              ) : (
                <>
                  Connect account <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>

          <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground/80">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            <span>
              You can disconnect at any time from Settings. To revoke access fully, sign out of
              SoundCloud or change your password.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
