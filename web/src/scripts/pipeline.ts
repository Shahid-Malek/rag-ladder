import { observeVisibility } from '@/lib/visibility';
import { pipelineScrollPlan } from '@/lib/pipeline';

export async function mountPipeline(root: HTMLElement) {
  if (!root.isConnected || root.closest('[hidden]')) return () => {};

  const cards = [...root.querySelectorAll<HTMLElement>('[data-stage]')],
    nodes = [...root.querySelectorAll<HTMLAnchorElement>('[data-flow-target]')];
  const progress = root.querySelector<HTMLElement>('[data-stage-progress]');
  const tileAnimations: Animation[] = [];
  function revealTech(card: HTMLElement) {
    if (card.dataset.techRevealed) return;
    card.dataset.techRevealed = 'true';
    if (
      document.hidden ||
      matchMedia('(prefers-reduced-motion:reduce)').matches
    )
      return;
    card.querySelectorAll<HTMLElement>('[data-stage-tech]').forEach((tile, i) =>
      tileAnimations.push(
        tile.animate(
          [
            { opacity: 0, transform: 'translateY(12px)' },
            { opacity: 1, transform: 'none' },
          ],
          {
            duration: 300,
            delay: i * 80,
            easing: getComputedStyle(document.documentElement)
              .getPropertyValue('--ease-smooth')
              .trim(),
            fill: 'backwards',
          },
        ),
      ),
    );
  }
  let current = 0;
  let jump = (index: number, focus = false) => {
    cards[index].scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion:reduce)').matches
        ? 'auto'
        : 'smooth',
    });
    if (focus) cards[index].focus({ preventScroll: true });
  };
  function active(index: number) {
    current = index;
    nodes.forEach((node, i) => {
      if (i === index) node.setAttribute('aria-current', 'step');
      else node.removeAttribute('aria-current');
    });
    const text = `${index + 1} of ${cards.length}`;
    if (progress && progress.textContent !== text) progress.textContent = text;
  }
  function select(index: number, focus = false) {
    jump(index, focus);
    const card = cards[index];
    card.classList.remove('is-jumped');
    void card.offsetWidth;
    card.classList.add('is-jumped');
  }
  const handlers = nodes.map((node, index) => {
    const handler = (event: MouseEvent) => {
      event.preventDefault();
      select(index);
    };
    node.addEventListener('click', handler);
    return () => node.removeEventListener('click', handler);
  });
  const key = (event: KeyboardEvent) => {
    if (
      (event.target as HTMLElement).closest(
        'input,textarea,select,[contenteditable="true"]',
      ) ||
      !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)
    )
      return;
    event.preventDefault();
    const index = Math.max(
      0,
      Math.min(
        cards.length - 1,
        current + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1),
      ),
    );
    select(index, cards.includes(document.activeElement as HTMLElement));
    if (nodes.includes(document.activeElement as HTMLAnchorElement))
      nodes[index].focus({ preventScroll: true });
  };
  root.addEventListener('keydown', key);
  const stops = cards.map((card, index) =>
    observeVisibility(card, (visible, entry) => {
      if (
        !root.classList.contains('pipeline-enhanced') &&
        visible &&
        (entry?.intersectionRatio || 0) >= 0.2
      ) {
        active(index);
        revealTech(card);
      }
    }),
  );
  const nativeCleanup = () => {
    tileAnimations.forEach((animation) => animation.cancel());
    stops.forEach((stop) => stop());
    root.removeEventListener('keydown', key);
    handlers.forEach((fn) => fn());
  };
  if (matchMedia('(prefers-reduced-motion:reduce)').matches)
    return nativeCleanup;
  let modules;
  try {
    modules = await Promise.all([
      import('gsap'),
      import('gsap/ScrollTrigger'),
      import('gsap/ScrollToPlugin'),
    ]);
  } catch (error) {
    nativeCleanup();
    throw error;
  }
  const [{ gsap }, { ScrollTrigger }, { ScrollToPlugin }] = modules;
  await document.fonts.ready;
  if (!root.isConnected || root.closest('[hidden],[data-view-leaving]')) {
    nativeCleanup();
    return () => {};
  }
  gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
  const media = gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)', () => {
    const stack = root.querySelector<HTMLElement>('.pipeline-stages')!;
    const flow = root.querySelector<HTMLElement>('.flow-column')!;
    const top = 110;
    const heights = cards.map((card) => card.getBoundingClientRect().height);
    const { height, reading, hold, travel, stops, snapPoints, duration } =
      pipelineScrollPlan(heights, innerHeight - top - 24);
    const available = Math.max(200, innerHeight - top - 24);
    root.style.setProperty('--stage-height', `${height}px`);
    root.style.setProperty('--stage-min-height', `${height}px`);
    root.classList.add('pipeline-enhanced');

    const pin =
      innerWidth >= 768 && flow.offsetHeight <= available ? root : stack;
    root.classList.toggle('pipeline-cards-only', pin === stack);
    gsap.set(cards, { opacity: 0, xPercent: 105, pointerEvents: 'none' });
    gsap.set(cards[0], { opacity: 1, xPercent: 0, pointerEvents: 'auto' });
    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: pin,
        start: `top ${top}px`,
        end: `+=${duration}`,
        pin: true,
        scrub: 0.2,
        // Don't snap past text in a card taller than the available viewport.
        snap: reading.some(Boolean)
          ? undefined
          : {
              inertia: false,
              directional: false,
              snapTo: snapPoints.map((point) => point / duration),
              duration: { min: 0.15, max: 0.3 },
              delay: 0.2,
            },
        invalidateOnRefresh: true,
        anticipatePin: 1,
      },
      onUpdate: () => {
        const time = timeline.time();
        let index = 0;
        stops.forEach((stop, i) => {
          if (time >= stop - (i ? travel / 2 : 0)) index = i;
        });
        active(index);
        revealTech(cards[index]);
        cards.forEach((card, i) => {
          card.inert = i !== index;
          card.style.pointerEvents = i === index ? 'auto' : 'none';
          card.tabIndex = i === index ? 0 : -1;
        });
      },
    });
    cards.forEach((card, index) => {
      const start = stops[index];
      if (reading[index])
        timeline.to(
          card,
          { y: -reading[index], duration: reading[index], ease: 'none' },
          start,
        );
      timeline.to({}, { duration: hold }, start + reading[index]);
      if (index === cards.length - 1) return;
      const transition = start + reading[index] + hold;
      // Hide the older layer before admitting the incoming card, including in reverse.
      if (index > 0) timeline.set(cards[index - 1], { opacity: 0 }, transition);
      timeline
        .to(
          cards[index + 1],
          {
            xPercent: 0,
            opacity: 1,
            duration: travel,
            ease: 'none',
          },
          transition,
        )
        .to(
          card,
          {
            scale: 0.97,
            opacity: 0.25,
            duration: travel,
            ease: 'none',
          },
          transition,
        );
    });
    let jumpTween: gsap.core.Tween | undefined;
    jump = (index, focus = false) => {
      const trigger = timeline.scrollTrigger!;
      const snapTween = trigger.getTween(true);
      if (snapTween) snapTween.kill();
      jumpTween?.kill();
      jumpTween = gsap.to(window, {
        scrollTo: { y: trigger.start + stops[index], autoKill: true },
        duration: 0.55,
        ease: 'power2.out',
        overwrite: 'auto',
        onComplete: () => {
          if (focus) cards[index].focus({ preventScroll: true });
        },
      });
    };
    const focus = (event: FocusEvent) => {
      if (event.target === cards[current]) jump(current);
    };
    stack.addEventListener('focusin', focus);
    cards.forEach((card, index) => {
      card.inert = index !== 0;
      card.tabIndex = index === 0 ? 0 : -1;
    });
    ScrollTrigger.refresh();
    return () => {
      jumpTween?.kill();
      stack.removeEventListener('focusin', focus);
      root.classList.remove('pipeline-enhanced', 'pipeline-cards-only');
      root.style.removeProperty('--stage-height');
      root.style.removeProperty('--stage-min-height');
      cards.forEach((card) => {
        card.removeAttribute('style');
        card.inert = false;
        card.tabIndex = 0;
      });
      jump = (index, focus = false) => {
        cards[index].scrollIntoView({ block: 'center' });
        if (focus) cards[index].focus({ preventScroll: true });
      };
    };
  });
  return () => {
    media.revert();
    nativeCleanup();
  };
}
