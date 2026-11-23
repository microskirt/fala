import { useEffect, useState } from 'react';
import { MessageSquare, Loader2, Send } from 'lucide-react';
import { api, timeAgo } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useToast } from '@/context/ToastContext.jsx';
import { Avatar } from '@/components/Media.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import { cn } from '@/lib/utils.js';

// The other person in a conversation, since the list includes both sides.
function otherUser(conversation, meId) {
  const users = conversation?.users || [];
  return users.find((u) => String(u.id) !== String(meId)) || users[0] || null;
}

export function MessagesMenu() {
  const { isAuthed, user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !isAuthed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get('/api/me/conversations?limit=30')
      .then((res) => !cancelled && setConversations(res.collection || []))
      .catch((err) => !cancelled && setError(err.message || 'Could not load messages'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, isAuthed]);

  const openThread = async (conversation) => {
    const peer = otherUser(conversation, user?.id);
    if (!peer) return;
    setActive({ conversation, peer });
    setMessages([]);
    setLoadingThread(true);
    try {
      // Threads are keyed by the other person, not by the conversation id.
      const res = await api.get(`/api/me/conversations/${peer.id}/messages?limit=100`);
      // The endpoint returns newest first; the thread reads oldest at the top.
      setMessages([...(res.collection || [])].reverse());
    } catch (err) {
      toast.error(err.message || 'Could not open that conversation');
    } finally {
      setLoadingThread(false);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending || !active) return;
    setSending(true);
    try {
      await api.post(`/api/me/conversations/${active.peer.id}/messages`, { body });
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          content: body,
          sender_id: user?.id,
          created_at: new Date().toISOString(),
        },
      ]);
      setDraft('');
    } catch (err) {
      toast.error(err.message || 'Could not send that message');
    } finally {
      setSending(false);
    }
  };

  if (!isAuthed) return null;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setActive(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Messages" title="Messages">
          <MessageSquare size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(380px,calc(100vw-1rem))] overflow-x-hidden p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          {active ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setActive(null)}
            >
              Back to all
            </button>
          ) : (
            <span className="text-sm font-semibold">Messages</span>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {active ? active.peer.username : conversations.length}
          </span>
        </div>
        <DropdownMenuSeparator className="my-0" />

        {active ? (
          <div className="flex min-w-0 max-h-[420px] flex-col">
            <div className="scrollbar-thin min-h-[140px] min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
              {loadingThread ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No messages yet. Say hello.
                </p>
              ) : (
                messages.map((m) => {
                  const mine = String(m.sender_id) === String(user?.id);
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        'mb-2 flex min-w-0',
                        mine ? 'justify-end' : 'justify-start'
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[80%] min-w-0 rounded-lg px-2.5 py-1.5 text-sm break-words [overflow-wrap:anywhere]',
                          mine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                        )}
                      >
                        <span className="whitespace-pre-wrap">{m.content}</span>
                        {m.created_at ? (
                          <div className="mt-0.5 text-[10px] opacity-70">{timeAgo(m.created_at)}</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <form className="flex min-w-0 items-center gap-1.5 border-t p-2" onSubmit={send}>
              <Input
                className="h-8 min-w-0 flex-1 text-sm"
                placeholder="Write a message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button type="submit" size="icon-sm" disabled={!draft.trim() || sending}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </Button>
            </form>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{error}</p>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No conversations yet. Open an artist page to start one.
          </p>
        ) : (
          <div className="scrollbar-thin max-h-[380px] overflow-y-auto overflow-x-hidden">
            {conversations.map((c) => {
              const other = otherUser(c, user?.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
                  onClick={() => openThread(c)}
                >
                  <Avatar src={other?.avatar_url} name={other?.username} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">
                        {other?.username || 'Conversation'}
                      </span>
                      {!c.read ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.last_message?.content || 'No messages yet'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(c.last_message?.created_at)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
