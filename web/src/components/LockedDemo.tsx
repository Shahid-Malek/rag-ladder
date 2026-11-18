import { useEffect, useRef, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import type { Level } from '@/lib/api';
import { observeVisibility } from '@/lib/visibility';
import { Button } from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import './LockedDemo.css';

const fields = [
  {
    id: 'upload',
    heading: 'A small collection. Your questions.',
    label: 'Upload a PDF',
    hint: 'Bring your own notes.',
    action: 'Browse files',
  },
  {
    id: 'question',
    heading: 'Follow the evidence.',
    label: 'Your question',
    hint: 'Ask a question about your notes…',
    action: 'Ask question',
  },
];

export default function LockedDemo({ level }: { level: Level }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const feedback = useRef<Animation | null>(null);

  useEffect(() => {
    const stop = Array.from(
      root.current!.querySelectorAll('.demo-locked-field'),
      (field) =>
        observeVisibility(field, (visible) =>
          field.toggleAttribute('data-lock-visible', visible),
        ),
    );
    return () => {
      stop.forEach((unsubscribe) => unsubscribe());
      feedback.current?.cancel();
    };
  }, []);

  function showLocked(control: HTMLButtonElement) {
    trigger.current = control;
    feedback.current?.cancel();
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    feedback.current = control.animate(
      [0, -4, 4, -3, 3, 0].map((x, index) => ({
        ...(!reduced && { transform: `translateX(${x}px)` }),
        boxShadow:
          index === 0 || index === 5
            ? '0 0 0 0 transparent'
            : '0 0 0 4px color-mix(in srgb, var(--color-destructive) 24%, transparent)',
      })),
      { duration: 600, easing: 'ease-out' },
    );
    setOpen(true);
    if (!reduced && window.matchMedia('(pointer: coarse)').matches) {
      try {
        navigator.vibrate?.(35);
      } catch {
        // Optional haptics must never interrupt the modal.
      }
    }
  }

  return (
    <Tooltip.Provider delayDuration={150}>
      <Dialog open={open} onOpenChange={setOpen}>
        <div ref={root} data-demo-locked className="space-y-6 pb-20">
          <p className="notice text-body text-muted-foreground">
            {level === 1 ? 'Naive' : 'Intermediate'} demo · Coming soon. PDF
            uploads and questions will unlock soon.
          </p>
          {fields.map((field) => (
            <article className="panel" key={field.id}>
              <h2 className="text-3xl">{field.heading}</h2>
              <p className="mt-5 text-body font-semibold">{field.label}</p>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    className={`demo-locked-field demo-locked-${field.id} mt-3`}
                    aria-label={`${field.label} — Coming soon`}
                    aria-disabled="true"
                    aria-haspopup="dialog"
                    onClick={(event) => showLocked(event.currentTarget)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      showLocked(event.currentTarget);
                    }}
                  >
                    <LockKeyhole
                      className="demo-lock-icon size-6"
                      aria-hidden="true"
                    />
                    <span className="text-body">{field.hint}</span>
                    <span className="demo-locked-action">{field.action}</span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="demo-locked-tooltip"
                    sideOffset={8}
                  >
                    Coming soon
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </article>
          ))}
        </div>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <LockKeyhole
            className="size-7 text-muted-foreground"
            aria-hidden="true"
          />
          <DialogHeader>
            <DialogTitle>Coming soon</DialogTitle>
            <DialogDescription>
              This feature is currently locked. PDF uploads and questions will
              unlock soon.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Got it</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tooltip.Provider>
  );
}
