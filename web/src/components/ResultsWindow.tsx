import { useEffect, useRef, useState } from 'react';
import LevelChoices from './LevelChoices';
import IslandBoundary from './IslandBoundary';
import { readSelection, selectionUrl } from '@/lib/selection';
export interface Evidence {
  slug: string;
  name: string;
  metric: number;
  interval: [number, number] | null;
  breakdown: { type: string; n: number; coverage: number | null }[];
}
function Content({ evidence }: { evidence: Evidence[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const panels = useRef<HTMLDivElement>(null);
  const panelRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const restore = () => setSelected(readSelection(location.search));
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const removing = useRef(new Set<string>());
  function toggle(slug: string) {
    if (removing.current.has(slug)) return;
    const remove = selected.includes(slug),
      leaving = panelRefs.current.get(slug);
    const update = () => {
      removing.current.delete(slug);
      setSelected((current) => {
        const next = remove
          ? current.filter((value) => value !== slug)
          : [...current.filter((value) => value !== slug), slug];
        history.replaceState(
          history.state,
          '',
          selectionUrl(location.href, next),
        );
        return next;
      });
    };
    if (
      leaving &&
      remove &&
      !matchMedia('(prefers-reduced-motion:reduce)').matches
    ) {
      removing.current.add(slug);
      leaving
        .animate(
          [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(.97)' },
          ],
          { duration: 180, easing: 'ease-in' },
        )
        .finished.then(update)
        .catch(update);
    } else update();
  }
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    panels.current?.querySelectorAll('[data-result-panel]').forEach((panel) => {
      if (panel.getAttribute('data-entered')) return;
      panel.setAttribute('data-entered', 'true');
      panel.animate(
        [
          { opacity: 0, transform: 'translateY(24px) scale(.98)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ],
        { duration: 400, easing: 'ease-out' },
      );
    });
  }, [selected]);
  return (
    <>
      <LevelChoices
        options={evidence}
        selected={selected}
        label="Choose saved evidence"
        controls="selected-evidence"
        caption="Saved retrieval evidence"
        onToggle={toggle}
      />
      <div
        id="selected-evidence"
        ref={panels}
        className="results-panels"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, selected.length)},minmax(0,1fr))`,
        }}
      >
        {!selected.length && (
          <div className="results-empty" role="status">
            Choose a level to see its saved evidence.
          </div>
        )}
        {evidence
          .filter((level) => selected.includes(level.slug))
          .map((level) => (
            <article
              key={level.slug}
              data-result-panel
              ref={(element) => {
                if (element) panelRefs.current.set(level.slug, element);
                else panelRefs.current.delete(level.slug);
              }}
              className="panel evidence-panel"
              aria-label={`${level.name} saved evidence`}
            >
              <h2 className="text-3xl">{level.name}</h2>
              <p className="evidence-value">
                <span className="sr-only">
                  {(level.metric * 100).toFixed(1)} percent Hit at 5
                </span>
                <span
                  data-countup={level.metric * 100}
                  data-countup-key={`result-${level.slug}`}
                  aria-hidden="true"
                >
                  {(level.metric * 100).toFixed(1)}
                </span>
                <span aria-hidden="true">%</span>
              </p>
              <p className="text-body">Hit@5 · 184 answerable questions</p>
              <p className="mt-4 text-body text-muted-foreground">
                37 documents · 200 questions · 16 excluded from quality
                averages.
              </p>
              {level.interval && (
                <p className="mt-4 text-body">
                  Wilson 95% interval: {(level.interval[0] * 100).toFixed(1)}–
                  {(level.interval[1] * 100).toFixed(1)}%
                </p>
              )}
              <p className="mt-6 text-body">
                These results describe frozen retrieval with processing off.
              </p>
              <p className="mt-4 text-body">
                Overall Hit@5 differences are not statistically distinguishable
                in this dataset.
              </p>
              <p className="mt-4 text-body text-muted-foreground">
                Saved pairwise difference intervals include zero; this does not
                establish equal performance. Question-type findings are
                exploratory. Generated answers and hosted speed are not ranked
                here.
              </p>
              <h3 className="mt-8 text-product-label">
                Evidence coverage by question type
              </h3>
              <dl className="evidence-breakdown">
                {level.breakdown.map((group) => (
                  <div key={group.type}>
                    <dt>
                      {group.type.replaceAll('_', ' ')}
                      <small>
                        {group.n} answerable
                        {group.n > 0 && group.n < 20 ? ' · small sample' : ''}
                      </small>
                    </dt>
                    <dd>
                      {group.coverage === null
                        ? 'Not measured'
                        : `${(group.coverage * 100).toFixed(1)}%`}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
      </div>
    </>
  );
}
export default function ResultsWindow(props: { evidence: Evidence[] }) {
  return (
    <IslandBoundary name="ResultsWindow">
      <Content {...props} />
    </IslandBoundary>
  );
}
