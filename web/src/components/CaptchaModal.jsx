import { useEffect, useState } from 'react';
import { Loader2, ShieldQuestion, ChevronDown, ClipboardPaste } from 'lucide-react';
import { Modal } from '@/components/Modal.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';

export function CaptchaModal({ open, url, loading, saving, error, onClose, onSubmitCookie }) {
  const [manual, setManual] = useState(false);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!open) {
      setManual(false);
      setValue('');
    }
  }, [open]);

  const showFrame = !loading && !!url && !manual;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Verify write access"
      footer={
        <>
          {!manual ? (
            <Button variant="ghost" onClick={() => setManual(true)} className="mr-auto">
              <ClipboardPaste size={14} /> Paste cookie instead
            </Button>
          ) : null}
          {manual && url ? (
            <Button variant="ghost" onClick={() => setManual(false)} className="mr-auto">
              <ShieldQuestion size={14} /> Use the check instead
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </>
      }
    >
      <p className="mb-3.5 text-sm leading-relaxed text-muted-foreground">
        SoundCloud asks for a quick verification before it allows likes, reposts, comments,
        follows and playlist changes. Solve it once and Fala remembers the result for this
        connection.
      </p>

      {showFrame ? (
        <div className="h-[420px] w-full overflow-hidden rounded-lg border bg-white">
          <iframe
            title="SoundCloud verification"
            src={url}
            referrerPolicy="origin"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            className="size-full border-0"
          />
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-[420px] w-full flex-col items-center justify-center gap-2.5 rounded-lg border bg-muted/40 text-sm text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
          <span>Asking SoundCloud for a fresh check…</span>
        </div>
      ) : null}

      {manual ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="dd-cookie">datadome cookie value</Label>
            <Input
              id="dd-cookie"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="datadome=… or just the value"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <Button
            disabled={saving || !value.trim()}
            onClick={() => onSubmitCookie(value.trim())}
            className="w-fit"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Checking…
              </>
            ) : (
              'Save and test'
            )}
          </Button>

          <details className="group rounded-lg border bg-muted/40">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
              <ShieldQuestion size={14} /> How to get this cookie yourself
              <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-3 border-t px-3.5 py-3.5">
              <ol className="flex flex-col gap-3.5">
                {[
                  'Switch back with "Use the check instead". That check is triggered by a request that cannot change your account: it asks SoundCloud to add a repost for a track id that does not exist.',
                  'Solve the puzzle or audio check in the panel.',
                  'If Fala does not pick the result up by itself, open DevTools (F12) → Application → Cookies → https://soundcloud.com and copy the value of datadome.',
                  'Paste it above and press "Save and test". A correct value is accepted straight away.',
                ].map((text, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground/80">
                The value expires after a while. If writes start failing again, repeat these steps.
              </p>
            </div>
          </details>
        </div>
      ) : null}

      {saving && !manual ? (
        <p className="mt-3 text-xs text-muted-foreground">
          <Loader2 size={14} className="inline animate-spin" /> Saving the verification…
        </p>
      ) : null}

      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </Modal>
  );
}
