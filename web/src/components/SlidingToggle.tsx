import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { mountSlidingToggle } from '@/lib/controls';
export default function SlidingToggle({
  children,
  label,
  className = '',
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => mountSlidingToggle(root.current!), []);
  return (
    <div
      ref={root}
      className={`sliding-toggle ${className}`}
      role="group"
      aria-label={label}
    >
      <span className="sliding-ghost" aria-hidden="true" />
      <span className="sliding-indicator" aria-hidden="true" />
      {children}
    </div>
  );
}
