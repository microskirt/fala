import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/context/ThemeContext.jsx';

function Toaster(props) {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme === 'light' ? 'light' : 'dark'}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:rounded-md',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
