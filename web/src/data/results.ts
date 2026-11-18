import source from '../../../results/final_results.json';
export const results = source;
export const percent = (value: number | null) =>
  value === null ? 'Not measured' : `${(value * 100).toFixed(1)}%`;
