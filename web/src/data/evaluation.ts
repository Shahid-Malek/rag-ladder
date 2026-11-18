// Source: results/final_results.json, frozen runtime retrieval, processing off.
import { results } from './results';
import type { LevelStat } from '@/components/ui/stats-2';

export const levelStats: LevelStat[] = [
  {
    level: 'L1',
    name: 'Naive',
    metric: results.levels.L1.overall.metrics['hit@5'],
    description:
      'Page text, overlapping chunks and dense retrieval. A baseline you can follow.',
  },
  {
    level: 'L2',
    name: 'Intermediate',
    metric: results.levels.L2.overall.metrics['hit@5'],
    description:
      'Markdown, OCR and hybrid retrieval. Adds conversation history in the hosted demo.',
  },
  {
    level: 'L3',
    name: 'Advanced',
    metric: results.levels.L3.overall.metrics['hit@5'],
    description:
      'Structured parsing, dense/sparse retrieval, reranking and parent context. Run this level locally.',
  },
];

export const evaluationNote = `${results.n_total} saved questions; ${results.n_answerable} answerable. Processing, rewriting, retries and generation off. Overall Hit@5 differences are not statistically distinguishable in this dataset.`;
