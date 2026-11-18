import { observeVisibility } from '@/lib/visibility';
export function mountOverview() {
  const root = document.querySelector<HTMLElement>('#hero');
  if (!root) return () => {};
  const headline = root.querySelector<HTMLElement>('[data-headline]')!,
    focusTarget = root.querySelector<HTMLElement>('[data-headline-pause]')!;
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  let hovered = false,
    focused = false,
    visible = false,
    index = 0;
  const words = ['Three ways', 'Naive', 'Intermediate', 'Advanced'];
  const enter = () => {
      hovered = true;
    },
    leave = () => {
      hovered = false;
    },
    focus = () => {
      focused = true;
    },
    blur = () => {
      focused = false;
    };
  headline.addEventListener('mouseenter', enter);
  headline.addEventListener('mouseleave', leave);
  focusTarget.addEventListener('focus', focus);
  focusTarget.addEventListener('blur', blur);
  const stop = observeVisibility(root, (value) => {
    visible = value;
  });
  const timer = setInterval(() => {
    if (hovered || focused || !visible || document.hidden || reduced.matches)
      return;
    index = (index + 1) % words.length;
    headline.textContent = words[index];
    headline.animate(
      [
        { opacity: 0.15, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 350, easing: 'ease-out' },
    );
  }, 5000);
  return () => {
    clearInterval(timer);
    stop();
    headline.removeEventListener('mouseenter', enter);
    headline.removeEventListener('mouseleave', leave);
    focusTarget.removeEventListener('focus', focus);
    focusTarget.removeEventListener('blur', blur);
  };
}
