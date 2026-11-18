import { CircleAlert, FileText } from 'lucide-react';
import LatticeLoader from './LatticeLoader.jsx';
import { Skeleton } from './ui/skeleton';
import type { Answer } from '@/lib/api';

export default function AnswerPanel({
  answer,
  pending = false,
  mock = false,
}: {
  answer?: Answer;
  pending?: boolean;
  mock?: boolean;
}) {
  return (
    <div
      className="panel h-[360px] overflow-auto"
      aria-busy={pending}
      role={pending ? 'status' : undefined}
    >
      {pending ? (
        <>
          <LatticeLoader
            label="Thinking through your notes"
            status={mock ? 'idle' : 'working'}
            showTimer={false}
          />
          <div className="mt-6 space-y-3" aria-hidden="true">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="mt-8 h-11 w-40 rounded-pill" />
          </div>
        </>
      ) : answer ? (
        <>
          {answer.answer === null ? (
            <p className="flex gap-3">
              <CircleAlert size={20} className="shrink-0" aria-hidden="true" />
              {mock
                ? 'Mock mode has no model or retrieval engine. Connect an API to get answers and citations from your notes.'
                : 'The answer provider is unavailable. Retrieved evidence is shown below when available. Check the remaining quota before trying again.'}
            </p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-section-nav">
              {answer.answer}
            </p>
          )}
          {!answer.citation_valid && answer.answer !== null && (
            <p className="mt-5 flex gap-2 text-body">
              <CircleAlert size={18} className="shrink-0" aria-hidden="true" />
              The response did not pass citation checks. Treat it as
              unsupported.
            </p>
          )}
          {answer.rewritten_query && (
            <p className="mt-5 break-words text-body text-muted-foreground">
              Search query: {answer.rewritten_query}
            </p>
          )}
          <div className="mt-6 space-y-3">
            <p className="text-body font-semibold">
              Source chunks ({answer.retrieved_chunks.length})
            </p>
            {answer.retrieved_chunks.map((chunk) => (
              <details
                key={chunk.chunk_id}
                className="rounded-navigation border border-border px-4"
              >
                <summary className="flex min-h-11 items-center gap-2 py-3 text-body">
                  <FileText size={16} className="shrink-0" aria-hidden="true" />
                  <span className="break-all">
                    {answer.citations.includes(chunk.chunk_id)
                      ? 'Cited'
                      : 'Retrieved'}{' '}
                    · {chunk.chunk_id}
                  </span>
                </summary>
                <p className="mb-3 text-utility-nav text-muted-foreground">
                  {chunk.file ?? 'Source document'}
                  {chunk.pages?.length
                    ? ` · page ${chunk.pages.join(', ')}`
                    : ''}
                </p>
                <p className="mb-4 whitespace-pre-wrap break-words text-body">
                  {chunk.text}
                </p>
              </details>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
