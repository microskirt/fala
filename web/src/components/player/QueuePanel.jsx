import { X, Trash2, ListMusic } from 'lucide-react';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { Artwork } from '@/components/Media.jsx';
import { Button } from '@/components/ui/button.jsx';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';
import { cn } from '@/lib/utils.js';

export function QueuePanel() {
  const { queue, index, queueOpen, setQueueOpen, playQueue, removeFromQueue, clearQueue } = usePlayer();

  if (!queueOpen) return null;

  return (
    <aside
      className="fixed bottom-(--player-height) right-0 top-14 z-30 flex w-full max-w-sm flex-col border-l border-border bg-card shadow-lg sm:top-0 sm:h-dvh"
      aria-label="Queue"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="leading-tight">
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <ListMusic size={16} /> Queue
          </h3>
          <span className="text-xs text-muted-foreground">
            {queue.length} track{queue.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {queue.length > 0 ? (
            <Button variant="ghost" size="icon-sm" onClick={clearQueue} aria-label="Clear queue">
              <Trash2 size={16} />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={() => setQueueOpen(false)} aria-label="Close queue">
            <X size={16} />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {queue.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">Your queue is empty.</p>
          ) : (
            queue.map((t, i) => (
              <div
                key={`${t.id}-${i}`}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-1.5 py-1.5',
                  i === index ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <button
                  type="button"
                  onClick={() => playQueue(queue, i)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Artwork src={t.artwork_url} alt={t.title} size={38} rounded={5} />
                  <span className="min-w-0 leading-tight">
                    <span
                      className={cn(
                        'block truncate text-xs font-semibold',
                        i === index && 'text-primary'
                      )}
                    >
                      {t.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.user?.username}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => removeFromQueue(t.id)}
                  aria-label="Remove from queue"
                >
                  <X size={14} />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
