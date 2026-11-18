import { useRef, useState } from 'react';
import SlidingToggle from './SlidingToggle';
import IslandBoundary from './IslandBoundary';
import { withBase } from '@/lib/paths';
import type { LevelInfo } from '@/data/levels';
function Content({ levels }: { levels: LevelInfo[] }) {
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  function select(index: number) {
    const direction = index > active ? 1 : -1;
    setActive(index);
    if (!matchMedia('(prefers-reduced-motion:reduce)').matches)
      panel.current?.animate(
        [
          { opacity: 0.2, transform: `translateX(${direction * 16}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 300, easing: 'ease-out' },
      );
  }
  const level = levels[active];
  return (
    <>
      <SlidingToggle label="Compare a level">
        {levels.map((level, i) => (
          <button
            data-option
            type="button"
            key={level.id}
            aria-pressed={active === i}
            aria-controls="compare-detail"
            onClick={() => select(i)}
          >
            {level.name}
            {level.id === 'l3' && (
              <small className="local-tag">Local only</small>
            )}
          </button>
        ))}
      </SlidingToggle>
      <div
        ref={panel}
        id="compare-detail"
        className="panel mt-5 compare-detail"
      >
        <h2 className="text-3xl">{level.name}</h2>
        <p className="mt-4 max-w-2xl">{level.summary}</p>
        <p className="mt-4 text-body text-muted-foreground">
          {level.conversation}
        </p>
        <a
          className="pill pill-secondary mt-6"
          href={withBase(`/${level.slug}/?view=how-it-works`)}
        >
          Explore {level.name}
          {level.id === 'l3' && <small className="local-tag">Local only</small>}
        </a>
      </div>
    </>
  );
}
export default function LevelTabs(props: { levels: LevelInfo[] }) {
  return (
    <IslandBoundary name="LevelTabs">
      <Content {...props} />
    </IslandBoundary>
  );
}
