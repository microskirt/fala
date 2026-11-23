import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';

/*
 * Long profile and track text is cut to a few lines until the reader asks for
 * the rest. Whether the button appears is decided by measuring the element, so
 * short text never gets a pointless control and long text always does.
 */
const CLAMP = {
  3: 'line-clamp-3',
  4: 'line-clamp-4',
  5: 'line-clamp-5',
  6: 'line-clamp-6',
};

export function ClampedText({ text, lines = 4, className }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Measure while collapsed only. Expanded text does not overflow, so
    // measuring then would hide the button the reader needs to collapse it.
    if (expanded) return undefined;
    const measure = () => {
      const over = el.scrollHeight - el.clientHeight > 2;
      // A layout-less environment reports zero heights; fall back to length so
      // the control still exists there.
      setOverflows(el.clientHeight === 0 ? String(text || '').length > lines * 90 : over);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [text, lines, expanded]);

  if (!text) return null;

  return (
    <div>
      <p
        ref={ref}
        className={cn(
          'text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground',
          !expanded && (CLAMP[lines] || 'line-clamp-4'),
          className
        )}
      >
        {text}
      </p>
      {overflows || expanded ? (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-primary hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      ) : null}
    </div>
  );
}
