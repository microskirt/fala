import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/context/ThemeContext.jsx';

/*
 * Toasts sit under the top bar on the right, stack downward, and use the same
 * tokens as every other surface so Catppuccin Mocha does not fall back to the
 * plain Sonner colours.
 */
function Toaster(props) {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme === 'light' ? 'light' : 'dark'}
      className="toaster group"
      /*
       * Sonner's own dark theme paints the close button with --normal-bg,
       * which is plain black and ignores our palette. Pointing those variables
       * at the same tokens the toast uses keeps the button on the Catppuccin
       * surface instead of a black dot.
       */
      style={{
        '--normal-bg': 'var(--popover)',
        '--normal-bg-hover': 'var(--accent)',
        '--normal-border': 'var(--border)',
        '--normal-border-hover': 'var(--border)',
        '--normal-text': 'var(--popover-foreground)',
      }}
      position="top-right"
      /*
       * The toast is a fixed 340px wide, which is wider than a phone once the
       * 12px gutters are taken off. It keeps that width on a desktop and shrinks
       * to the viewport on anything narrower, so it never runs off the edge.
       */
      offset={{ top: 'calc(var(--topbar-height) + 12px)', right: '12px' }}
      gap={8}
      visibleToasts={4}
      expand
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group relative flex w-[min(340px,calc(100vw-1.5rem))] items-start gap-2.5 rounded-lg border border-border bg-popover py-3 pl-3.5 pr-9 text-popover-foreground shadow-lg',
          title: 'text-sm font-medium leading-snug',
          description: 'mt-0.5 text-xs text-muted-foreground',
          icon: 'mt-0.5 shrink-0 text-muted-foreground',
          content: 'min-w-0 flex-1',
          closeButton:
            'absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          success: '[&_[data-icon]]:text-[var(--success)]',
          error: '[&_[data-icon]]:text-[var(--destructive)]',
          info: '[&_[data-icon]]:text-[var(--info)]',
          warning: '[&_[data-icon]]:text-[var(--warning)]',
          actionButton:
            'ml-auto shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground',
          cancelButton:
            'ml-auto shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
