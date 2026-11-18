import { useEffect, useState, useRef } from 'react';
import SlidingToggle from './SlidingToggle';
import { observeVisibility } from '@/lib/visibility';
import IslandBoundary from './IslandBoundary';
const chips = [
  ['Page text', 'Overlapping chunks', 'Dense retrieval'],
  ['Markdown', 'OCR', 'Hybrid retrieval', 'Conversation history'],
  [
    'Structured parsing',
    'Dense/sparse retrieval',
    'Reranking',
    'Parent context',
  ],
];
import type { LevelStat } from './ui/stats-2';
function Content({ stats }: { stats: LevelStat[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => observeVisibility(root.current!, setVisible), []);
  const [active, setActive] = useState(0),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    if (
      !visible ||
      paused ||
      matchMedia('(prefers-reduced-motion:reduce)').matches
    )
      return;
    const timer = setInterval(() => {
      if (!matchMedia('(prefers-reduced-motion:reduce)').matches)
        setActive((value) => (value + 1) % stats.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [paused, stats.length, visible]);
  return (
    <div
      className="parts-selector"
      ref={root}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPaused(false);
      }}
    >
      <SlidingToggle label="Inspect a level">
        {stats.map((stat, i) => (
          <button
            type="button"
            data-option
            key={stat.level}
            aria-pressed={active === i}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
          >
            {stat.name}
            {i === 2 && <small className="local-tag">Local only</small>}
          </button>
        ))}
      </SlidingToggle>
      <div
        key={active}
        className="parts-swap"
        aria-live={paused ? 'polite' : 'off'}
      >
        <p className="parts-description">{stats[active].description}</p>
        <ul
          className="level-stage-chips"
          aria-label={`${stats[active].name} stages`}
        >
          {chips[active].map((chip) => (
            <li key={chip} className="measurement-chip">
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
export default function PartsSelector(props: { stats: LevelStat[] }) {
  return (
    <IslandBoundary name="PartsSelector">
      <Content {...props} />
    </IslandBoundary>
  );
}
