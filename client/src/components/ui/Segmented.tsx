import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Tabs with a highlight that slides to the selected one. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  // Position and size of the selected tab: options can wrap onto a second row on narrow screens.
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value);
      if (el) setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    // Fonts load late and panels resize: keep the highlight under the right tab.
    const ro = new ResizeObserver(measure);
    const el = refs.current.get(value);
    if (el?.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [value]);

  return (
    <div role="tablist" className={cn('relative flex gap-0.5', className)}>
      {box && <span className="ec-seg-indicator" style={{ width: box.w, height: box.h, bottom: 'auto', transform: `translate(${box.x}px, ${box.y}px)` }} aria-hidden />}
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            if (el) refs.current.set(o.value, el);
            else refs.current.delete(o.value);
          }}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative rounded-lg px-2.5 py-1 text-xs font-semibold tracking-[0.1em] uppercase transition-colors duration-200',
            value === o.value ? 'text-white' : 'text-slate-500 hover:text-slate-300',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
