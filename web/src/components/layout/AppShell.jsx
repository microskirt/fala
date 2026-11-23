import { useEffect, useState } from 'react';
import { Outlet } from '@tanstack/react-router';
import { Sidebar } from '@/components/layout/Sidebar.jsx';
import { Topbar } from '@/components/layout/Topbar.jsx';
import { Player } from '@/components/player/Player.jsx';
import { QueuePanel } from '@/components/player/QueuePanel.jsx';
import { usePlayer } from '@/context/PlayerContext.jsx';

/* The tab follows the player: the app name when idle, the song title when not. */
function TabTitle() {
  const { current } = usePlayer();

  useEffect(() => {
    document.title = current?.title || 'Fala';
  }, [current?.title]);

  return null;
}

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <TabTitle />
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />

      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <Player />
      </div>

      <QueuePanel />
    </div>
  );
}
