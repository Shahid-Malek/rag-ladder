import { ArrowUpRight } from 'lucide-react';
import { withBase } from '@/lib/paths';
import Stats2, { type LevelStat } from './ui/stats-2';
export default function ProductStage({ stats }: { stats: LevelStat[] }) {
  return (
    <div className="product-stage">
      <div className="hero-stat-panel">
        <div className="mb-6 flex flex-wrap justify-between gap-3">
          <p className="eyebrow">FROZEN RETRIEVAL · HIT@5</p>
          <span className="text-utility-nav">184 answerable</span>
        </div>
        <Stats2 stats={stats} compact />
      </div>
      <p className="text-utility-nav text-muted-foreground mt-5">
        Overall Hit@5 differences are not statistically distinguishable in this
        dataset.
      </p>
      <a
        className="pipeline-cta animated-button"
        href={withBase('/pipeline/')}
        data-astro-prefetch="viewport"
      >
        <span className="pipeline-cta-title">
          Explore the pipelines <ArrowUpRight size={24} aria-hidden="true" />
        </span>
        <span className="text-body text-muted-foreground mt-4">
          Pick Naive, Intermediate or Advanced and follow each stage.
        </span>
      </a>
    </div>
  );
}
