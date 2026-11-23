import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { Artwork } from '@/components/Media.jsx';
import { Button } from '@/components/ui/button.jsx';

/*
 * SoundCloud wants a square image and stores whatever it is given, so the file
 * is redrawn on a canvas before it leaves the browser. That keeps the upload
 * small, makes every cover square regardless of what was picked, and means the
 * server only ever sees a plain data URI.
 */
const SIZE = 800;

function readAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

function squareDataUri(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        // Crop from the middle so a non-square picture is not squashed.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('That file is not an image'));
    img.src = source;
  });
}

async function prepare(file) {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file');
  const raw = await readAsDataUri(file);
  return squareDataUri(raw);
}

/*
 * The artwork control used by both the create and the edit playlist dialogs.
 * `artwork` is tri-state: undefined means leave it alone, null means remove it,
 * and a data URI means replace it with that image.
 */
export function PlaylistArtworkField({ artwork, existingUrl, fallback, onChange, disabled }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const shown = artwork === undefined ? existingUrl : artwork;

  const pick = async (event) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires a change.
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const uri = await prepare(file);
      onChange(uri);
    } catch (err) {
      setError(err.message || 'Could not use that image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-4">
      <Artwork
        src={shown}
        fallback={fallback}
        alt="Playlist cover"
        size={88}
        rounded={10}
        kind="playlist"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Cover</div>
        <div className="text-xs text-muted-foreground">
          Square works best. Anything else is cropped to the middle.
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {shown ? 'Replace' : 'Upload'}
          </Button>
          {shown ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={() => onChange(null)}
            >
              <Trash2 size={14} /> Remove
            </Button>
          ) : null}
        </div>
        {error ? <div className="mt-1.5 text-xs text-destructive">{error}</div> : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={pick}
      />
    </div>
  );
}
