import { observeVisibility } from '@/lib/visibility';

export function mountSections() {
  const stops: (() => void)[] = [];
  const animations: Animation[] = [];
  const headlines = new Map<HTMLElement, Node[]>();
  const restoreTimers: ReturnType<typeof setTimeout>[] = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const sections = [
    ...document.querySelectorAll<HTMLElement>('[data-section]'),
  ];
  sections
    .filter((section) => !section.closest('[hidden]'))
    .forEach((section, i) => {
      section.dataset.sectionTone = String(i % 2);
    });
  for (const section of sections) {
    if (
      section.dataset.sectionHero ||
      section.dataset.sectionSeen ||
      typeof IntersectionObserver === 'undefined' ||
      document.hidden ||
      reduced.matches ||
      section.closest('[hidden]')
    )
      continue;
    const top = section.getBoundingClientRect().top;
    if (top < innerHeight) {
      section.dataset.sectionSeen = 'true';
      continue;
    }
    let stop = () => {};
    const reveal = () => {
      if (section.dataset.sectionSeen) return;
      section.dataset.sectionSeen = 'true';
      delete section.dataset.sectionPending;
      stop();
      if (document.hidden || reduced.matches) return;
      const ease = getComputedStyle(document.documentElement)
        .getPropertyValue('--ease-smooth')
        .trim();
      const line = section.querySelector<HTMLElement>(':scope > .section-line');
      const marker = section.querySelector<HTMLElement>(
        ':scope > .section-content > .section-marker',
      );
      if (line)
        animations.push(
          line.animate(
            [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
            { duration: 650, easing: ease },
          ),
        );
      if (marker)
        animations.push(
          marker.animate(
            [
              { opacity: 0, transform: 'translateY(8px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 400, delay: 150, easing: ease, fill: 'backwards' },
          ),
        );
      const content = section.querySelector<HTMLElement>(
        ':scope > .section-content',
      );
      // Explicit headline lines retain their original markup and wrapping.
      content?.querySelectorAll<HTMLElement>('h2').forEach((heading) => {
        if (
          heading.closest('[data-stage], astro-island') ||
          heading.querySelector('.section-headline-line')
        )
          return;
        headlines.set(
          heading,
          [...heading.childNodes].map((node) => node.cloneNode(true)),
        );
        if (
          [...heading.childNodes].every(
            (node) => node.nodeType === Node.TEXT_NODE,
          )
        ) {
          const words = (heading.textContent || '')
            .trim()
            .split(/\s+/)
            .map((word) => {
              const span = document.createElement('span');
              span.textContent = word + ' ';
              return span;
            });
          heading.replaceChildren(...words);
          const rows: { top: number; text: string }[] = [];
          words.forEach((word) => {
            const top = Math.round(word.getBoundingClientRect().top),
              last = rows.at(-1);
            if (last && Math.abs(last.top - top) < 2)
              last.text += word.textContent;
            else rows.push({ top, text: word.textContent || '' });
          });
          heading.replaceChildren();
          rows.forEach((row, i) => {
            heading.append(document.createTextNode(row.text.trim()));
            if (i < rows.length - 1)
              heading.append(document.createElement('br'));
          });
        }
        const lines: DocumentFragment[] = [document.createDocumentFragment()];
        [...heading.childNodes].forEach((node) => {
          if (node.nodeName === 'BR')
            lines.push(document.createDocumentFragment());
          else lines.at(-1)!.append(node);
        });
        lines.forEach((fragment, i) => {
          const line = document.createElement('span');
          line.className = 'section-headline-line';
          line.append(fragment);
          heading.append(line);
          if (i < lines.length - 1)
            heading.append(document.createElement('br'));
        });
      });
      restoreTimers.push(
        setTimeout(() => {
          headlines.forEach((nodes, heading) => {
            if (section.contains(heading)) {
              heading.replaceChildren(...nodes);
              headlines.delete(heading);
            }
          });
        }, 1200),
      );
      const targets = content?.querySelectorAll<HTMLElement>(
        '.section-headline-line, :scope > p, :scope > .section-heading > p, :scope > .checkpoint-inner > div:last-child, :scope > .stats-grid, :scope > .table-wrap, :scope > .pill, :scope > astro-island',
      );
      targets?.forEach((target, i) =>
        animations.push(
          target.animate(
            [
              { opacity: 0, transform: 'translateY(24px)' },
              { opacity: 1, transform: 'none' },
            ],
            {
              duration: 500,
              delay: 220 + Math.min(i, 7) * 60,
              easing: ease,
              fill: 'backwards',
            },
          ),
        ),
      );
    };
    try {
      stop = observeVisibility(section, (visible) => {
        if (visible) reveal();
      });
      if (!section.dataset.sectionSeen) section.dataset.sectionPending = 'true';
      stops.push(stop);
    } catch {
      delete section.dataset.sectionPending;
    }
  }
  // Fail open even if a browser creates an observer but never delivers its callback.
  const failOpen = setTimeout(
    () => sections.forEach((section) => delete section.dataset.sectionPending),
    1500,
  );
  return () => {
    clearTimeout(failOpen);
    restoreTimers.forEach(clearTimeout);
    headlines.forEach((nodes, heading) => heading.replaceChildren(...nodes));
    stops.forEach((stop) => stop());
    animations.forEach((animation) => animation.cancel());
    sections.forEach((section) => delete section.dataset.sectionPending);
  };
}
