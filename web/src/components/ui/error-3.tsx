import { ArrowLeft, ArrowUpRight, FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { withBase } from '@/lib/paths';
import { site } from '@/data/site';

// Restyled from Watermelon's error-3; navigation works without hydration.
export default function ErrorPage() {
  return (
    <div className="stage relative overflow-hidden px-4 py-24 text-center md:py-36">
      <div className="relative mx-auto max-w-3xl space-y-8">
        <FileQuestion
          className="mx-auto size-10 text-primary"
          aria-hidden="true"
        />
        <p
          className="text-display-xl font-semibold text-primary"
          aria-hidden="true"
        >
          404
        </p>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          This page isn’t in the notes.
        </h1>
        <p className="mx-auto max-w-md text-section-nav text-muted-foreground">
          The address may have changed. Pick a level or return to the start.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <a href={withBase('/')}>
              <ArrowLeft aria-hidden="true" />
              Back to home
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={withBase('/naive/')}>Naive</a>
          </Button>
          <Button asChild variant="outline">
            <a href={withBase('/intermediate/')}>Intermediate</a>
          </Button>
        </div>
        <a
          className="inline-flex min-h-11 items-center gap-2 text-foreground underline"
          href={site.repository}
          target="_blank"
          rel="noopener noreferrer"
        >
          View the repository
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
