import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils.js';

/*
 * Radix lays out a vertical slider by itself, so the orientation is passed
 * through and the track is sized on the matching axis. Before this the volume
 * bar was a horizontal slider turned with a CSS rotation, which left it
 * cramped and made the drag follow the wrong axis.
 */
function Slider({ className, defaultValue, value, min = 0, max = 100, orientation = 'horizontal', ...props }) {
  const values = value ?? defaultValue ?? [min];
  const vertical = orientation === 'vertical';
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      orientation={orientation}
      className={cn(
        'relative flex touch-none items-center select-none data-[disabled]:opacity-50',
        vertical ? 'h-full flex-col justify-center' : 'w-full',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          'bg-muted relative overflow-hidden rounded-full',
          vertical ? 'h-full w-1.5 grow' : 'h-1 w-full grow'
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute rounded-full data-[orientation=vertical]:w-full data-[orientation=horizontal]:h-full"
        />
      </SliderPrimitive.Track>
      {values.map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          data-slot="slider-thumb"
          className="border-primary bg-background ring-ring/50 block size-3.5 shrink-0 cursor-grab rounded-full border-2 shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
