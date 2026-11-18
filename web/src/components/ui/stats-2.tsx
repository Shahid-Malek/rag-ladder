import { ArrowUpRight } from 'lucide-react';
import { withBase } from '@/lib/paths';
export interface LevelStat {
  level: 'L1' | 'L2' | 'L3';
  name: string;
  metric: number;
  description: string;
}
export default function Stats2({
  stats,
  compact = false,
}: {
  stats: LevelStat[];
  compact?: boolean;
}) {
  return (
    <div
      className={`stats-grid reactive-group ${compact ? 'stats-compact' : ''}`}
    >
      {stats.map((stat) => (
        <a
          key={stat.level}
          className="stat-card reactive-card"
          data-reactive
          href={withBase(`/${stat.name.toLowerCase()}/?view=how-it-works`)}
        >
          <div className="stat-accent" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">{stat.name.toUpperCase()}</span>
            {stat.level === 'L3' && (
              <small className="local-tag">Local only</small>
            )}
          </div>
          <p className="stat-value">
            <span className="sr-only">
              {(stat.metric * 100).toFixed(1)} percent Hit at 5
            </span>
            <span
              data-countup={stat.metric * 100}
              data-countup-key={`${compact ? 'hero' : 'ladder'}-${stat.level}`}
              aria-hidden="true"
            >
              {(stat.metric * 100).toFixed(1)}
            </span>
            <span className="stat-percent" aria-hidden="true">
              %
            </span>
          </p>
          <p className="text-utility-nav text-muted-foreground mt-2">Hit@5</p>
          {!compact && (
            <>
              <p className="mt-6 mb-8 text-body text-muted-foreground">
                {stat.description}
              </p>
              <span className="stat-explore">
                Explore {stat.name}
                <ArrowUpRight size={16} aria-hidden="true" />
              </span>
            </>
          )}
        </a>
      ))}
    </div>
  );
}
