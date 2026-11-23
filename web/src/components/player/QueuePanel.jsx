import { useEffect, useRef, useState } from 'react';
import { X, Trash2, ListMusic, GripVertical, Play } from 'lucide-react';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { AddToPlaylistButton } from '@/components/Controls.jsx';
import { Artwork } from '@/components/Media.jsx';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

/*
 * The queue is a panel that comes out of the player bar, not a full height
 * sidebar. It only covers the part of the page it needs, the way SoundCloud
 * shows it, and the list scrolls inside it so a long queue stays reachable.
 * Rows can be dragged to reorder them, and a row can be removed on its own.
 */
export function QueuePanel() {
  const {
    queue,
    index,
    queueOpen,
    setQueueOpen,
    playQueue,
    removeFromQueue,
    clearQueue,
    moveInQueue,
  } = usePlayer();

  const panelRef = useRef(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  // Escape and a click outside both close it, like any other popup.
  useEffect(() => {
    if (!queueOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setQueueOpen(false);
    };
    const onDown = (e) => {
      const el = panelRef.current;
      if (el && !el.contains(e.target)) setQueueOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [queueOpen, setQueueOpen]);

  // A closed panel forgets any half finished drag.
  useEffect(() => {
    if (!queueOpen) {
      setDragIndex(null);
      setOverIndex(null);
    }
  }, [queueOpen]);

  if (!queueOpen) return null;

  const drop = (to) => {
    if (dragIndex !== null && dragIndex !== to) moveInQueue(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <aside
      ref={panelRef}
      className="fixed right-2 bottom-[calc(var(--player-height)+0.5rem)] z-40 flex max-h-[min(60vh,560px)] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      aria-label="Queue"
    >
      <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
        <div className="min-w-0 leading-tight">
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <ListMusic size={16} /> Queue
          </h3>
          <span className="text-xs text-muted-foreground">
            {queue.length} track{queue.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {queue.length > 1 ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearQueue}
              aria-label="Clear queue"
              title="Clear the queue, keep this song playing"
            >
              <Trash2 size={16} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setQueueOpen(false)}
            aria-label="Close queue"
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {queue.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            Your queue is empty.
          </p>
        ) : (
          queue.map((t, i) => {
            const active = i === index;
            const dragging = dragIndex === i;
            const dropTarget = overIndex === i && dragIndex !== null && dragIndex !== i;
            return (
              <div
                key={`${t.id}-${i}`}
                draggable
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox needs data set before a drag will start.
                  e.dataTransfer.setData('text/plain', String(i));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDragLeave={() => {
                  if (overIndex === i) setOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(i);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={cn(
                  'group relative flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors',
                  active ? 'bg-accent' : 'hover:bg-accent/50',
                  dragging && 'opacity-40',
                  dropTarget && 'ring-1 ring-primary/60'
                )}
              >
                <span
                  className="flex shrink-0 cursor-grab items-center text-muted-foreground/60 active:cursor-grabbing"
                  title="Drag to reorder"
                  aria-hidden="true"
                >
                  <GripVertical size={14} />
                </span>
                <button
                  type="button"
                  onClick={() => playQueue(queue, i)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="relative shrink-0">
                    <Artwork src={t.artwork_url} alt={t.title} size={38} rounded={5} />
                    <span
                      className={cn(
                        'absolute inset-0 grid place-items-center rounded-[5px] bg-black/45 text-white transition-opacity',
                        active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                    >
                      <Play size={14} fill="currentColor" />
                    </span>
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span
                      className={cn(
                        'block truncate text-xs font-semibold',
                        active && 'text-primary'
                      )}
                    >
                      {t.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.user?.username}
                    </span>
                  </span>
                </button>
                <AddToPlaylistButton
                  track={t}
                  size={14}
                  className="opacity-0 group-hover:opacity-100"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => removeFromQueue(t.id)}
                  aria-label={`Remove ${t.title} from queue`}
                  title="Remove from queue"
                >
                  <X size={14} />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
