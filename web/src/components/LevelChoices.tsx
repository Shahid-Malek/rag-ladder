import { Check } from 'lucide-react';
import AnimatedButton from './AnimatedButton';
export interface LevelChoice {
  slug: string;
  name: string;
}
export default function LevelChoices({
  options,
  selected,
  label,
  controls,
  caption,
  onToggle,
}: {
  options: LevelChoice[];
  selected: string[];
  label: string;
  controls: string;
  caption: string;
  onToggle?: (slug: string) => void;
}) {
  return (
    <div className="results-choices" role="group" aria-label={label}>
      {options.map((level) => (
        <AnimatedButton
          key={level.slug}
          type="button"
          variant="outline"
          className="result-choice"
          data-level-choice={level.slug}
          aria-pressed={selected.includes(level.slug)}
          aria-controls={controls}
          onClick={onToggle ? () => onToggle(level.slug) : undefined}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-3xl">{level.name}</span>
            {level.slug === 'advanced' && (
              <small className="local-tag">Local only</small>
            )}
          </span>
          <span className="result-choice-bottom">
            {caption}
            <span className="selection-check" aria-hidden="true">
              <Check size={18} />
            </span>
          </span>
        </AnimatedButton>
      ))}
    </div>
  );
}
