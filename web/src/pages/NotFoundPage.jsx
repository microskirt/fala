import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/Media.jsx';
import { Page } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';

export function NotFoundPage() {
  return (
    <Page>
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        action={
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
        }
      >
        The link may be broken, or the page may have moved.
      </EmptyState>
    </Page>
  );
}
