import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Home,
  Search,
  Heart,
  ListMusic,
  Repeat2,
  Users,
  Settings,
  Bell,
  LogIn,
  History,
  LogOut,
  User,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { Avatar } from '@/components/Media.jsx';
import { BrandMark } from '@/components/Brand.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import { cn } from '@/lib/utils.js';
import { userLink } from '@/lib/scRoute.js';

function NavLink({ to, icon: Icon, label, count, onClick }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = to === '/' ? pathname === '/' : pathname.startsWith(to);

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground'
      )}
    >
      <Icon size={18} className={cn(active ? 'text-primary' : 'text-muted-foreground')} />
      <span className="truncate">{label}</span>
      {count ? (
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function NavHeading({ children }) {
  return (
    <div className="px-3 pt-5 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  );
}

export function Sidebar({ open, onNavigate }) {
  const { user, isAuthed, logout } = useAuth();
  const { counts } = useLibrary();
  const navigate = useNavigate();

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar',
        'transition-transform duration-200 lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 py-4">
        <BrandMark size={32} className="shrink-0 rounded-lg" />
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">Fala</span>
          <span className="block text-xs text-muted-foreground">A working SoundCloud</span>
        </span>
      </Link>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-4">
        <div className="flex flex-col gap-0.5">
          <NavLink to="/" icon={Home} label="Home" onClick={onNavigate} />
          <NavLink to="/search" icon={Search} label="Search" onClick={onNavigate} />
        </div>

        <NavHeading>Your library</NavHeading>
        <div className="flex flex-col gap-0.5">
          {isAuthed ? (
            <>
              <NavLink
                to="/likes"
                icon={Heart}
                label="Likes"
                count={counts.likes || null}
                onClick={onNavigate}
              />
              <NavLink
                to="/playlists"
                icon={ListMusic}
                label="Playlists"
                count={counts.playlists || null}
                onClick={onNavigate}
              />
              <NavLink
                to="/reposts"
                icon={Repeat2}
                label="Reposts"
                count={counts.reposts || null}
                onClick={onNavigate}
              />
              <NavLink
                to="/following"
                icon={Users}
                label="Following"
                count={counts.following || null}
                onClick={onNavigate}
              />
              <NavLink to="/history" icon={History} label="History" onClick={onNavigate} />
              <NavLink to="/activity" icon={Bell} label="Activity" onClick={onNavigate} />
            </>
          ) : null}
        </div>
      </nav>

      {/*
       * The footer matches the player bar beside it: the same height token plus
       * the same 1px top border, so the two dividing lines sit on one level.
       * The whole strip is the account button, which drops the padding that
       * used to make it taller and gives the hover state the full width.
       */}
      <div className="shrink-0 border-t border-sidebar-border">
        {isAuthed && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-(--player-height) w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-sidebar-accent/60 data-[state=open]:bg-sidebar-accent/60"
                aria-label="Account menu"
              >
                <Avatar src={user.avatar_url} name={user.username} size={32} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-semibold">{user.username}</div>
                  <div className="truncate text-xs text-muted-foreground">@{user.permalink}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-[224px]">
              <DropdownMenuItem asChild>
                <Link {...userLink(user)} onClick={onNavigate}>
                  <User size={16} /> Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings" onClick={onNavigate}>
                  <Settings size={16} /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await logout();
                  onNavigate?.();
                  navigate({ to: '/' });
                }}
              >
                <LogOut size={16} /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            className="h-(--player-height) w-full rounded-none"
            onClick={() => {
              onNavigate?.();
              navigate({ to: '/login' });
            }}
          >
            <LogIn size={16} /> Connect SoundCloud
          </Button>
        )}
      </div>
    </aside>
  );
}
