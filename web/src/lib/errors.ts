export interface Explanation {
  title: string;
  whatBroke: string;
  nextStep: string;
}
export type ErrorContext =
  | 'connecting'
  | 'uploading'
  | 'answering'
  | 'ending'
  | 'page'
  | 'questions'
  | 'security';
const stages: Record<string, string> = {
  parse: 'reading your PDF',
  parsing: 'reading your PDF',
  chunk: 'splitting your notes into windows',
  chunking: 'splitting your notes into windows',
  embed: 'preparing your notes for search',
  embedding: 'preparing your notes for search',
  index: 'preparing your notes for search',
  indexing: 'preparing your notes for search',
  retrieve: 'searching your notes',
  retrieval: 'searching your notes',
  answer: 'answering your question',
  generation: 'answering your question',
};
export function explain(
  error: unknown,
  context: ErrorContext = 'answering',
): Explanation {
  const value =
    error && typeof error === 'object'
      ? (error as {
          code?: string;
          status?: number;
          stage?: string;
          name?: string;
        })
      : {};
  const code = value.code || '',
    status = value.status || 0;
  const make = (title: string, whatBroke: string, nextStep: string) => ({
    title,
    whatBroke,
    nextStep,
  });
  if (code === 'chunk_load' || context === 'page')
    return make(
      'Part of this page didn’t load.',
      'An interactive part of the page is unavailable.',
      'Reload to retry.',
    );
  if (code === 'unsupported_browser' || value.name === 'NotSupportedError')
    return make(
      'This browser cannot run the demo.',
      'A required browser feature is unavailable.',
      'Try a current version of your browser.',
    );
  if (
    code === 'timeout' ||
    value.name === 'TimeoutError' ||
    code === 'parse_timeout' ||
    status === 504
  )
    return make(
      'The request took too long.',
      'We couldn’t finish the current step in time.',
      'Check your connection. Try a smaller PDF if you were uploading. Check the session before retrying.',
    );
  if (
    ['session_expired', 'invalid_token'].includes(code) ||
    [401, 410].includes(status)
  )
    return make(
      'This session has ended.',
      'Your files are no longer available in this session; live-data cleanup may still be pending.',
      'Start a new session and add your notes again. Provider records and backups may remain.',
    );
  if (code === 'session_locked')
    return make(
      'This session is locked.',
      'The session cannot process more questions.',
      'End this session to request deletion.',
    );
  if (code === 'quota_exceeded')
    return make(
      'The session limit was reached.',
      'This session cannot accept more documents or questions.',
      'Use the remaining allowance or end this session before starting another.',
    );
  if (code === 'unsupported_type')
    return make(
      'This file type is not supported.',
      'Only text PDFs work here.',
      'Choose a PDF and try again.',
    );
  if (code === 'file_too_large' || status === 413)
    return make(
      'This PDF is too large.',
      'The file exceeds this session’s upload limit.',
      'Choose a smaller PDF. The limit appears beside the upload button.',
    );
  if (['document_limit', 'too_many_documents'].includes(code))
    return make(
      'The document limit was reached.',
      'There are no document slots left.',
      'Remove a queued document or start a new session.',
    );
  if (code === 'no_text_found')
    return make(
      'We couldn’t read text from this PDF.',
      'The document has no readable text for this level.',
      'Try a text PDF or use Intermediate for scanned text.',
    );
  if (code === 'guardrail_blocked' || code === 'validation_failed')
    return make(
      'We couldn’t accept this request.',
      context === 'uploading'
        ? 'The document did not pass the upload checks.'
        : 'The question could not be processed.',
      context === 'uploading'
        ? 'Try a different, smaller text PDF.'
        : 'Ask a clear question about the content of your notes.',
    );
  if (status === 429 || code === 'rate_limited')
    return make(
      'The free service is busy.',
      'The service has temporarily limited requests.',
      'Wait a little before trying again. Check your remaining allowance first.',
    );
  if (code === 'invalid_response')
    return make(
      'We couldn’t read the response.',
      'The service returned an unexpected response format.',
      'Reload or retry later. Check the session before submitting again.',
    );
  if (
    code === 'network_error' ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  )
    return make(
      'We couldn’t reach the server.',
      'The connection is offline or the server is unavailable.',
      'Check your connection, then retry. Check upload progress before uploading again.',
    );
  const stage = stages[value.stage || ''];
  if (stage)
    return make(
      'A processing step failed.',
      `We couldn’t finish ${stage}.`,
      context === 'uploading'
        ? 'Try a smaller PDF.'
        : 'Check your remaining allowance and try again later.',
    );
  if (
    status >= 500 ||
    [
      'server_busy',
      'demo_capacity_reached',
      'infrastructure_unavailable',
    ].includes(code)
  )
    return make(
      'The service is unavailable.',
      context === 'uploading'
        ? 'The server couldn’t finish processing your notes.'
        : 'The service couldn’t finish your request.',
      'Try again later. Check your session before submitting again.',
    );
  const tasks: Record<ErrorContext, string> = {
    connecting: 'starting or restoring your session',
    uploading: 'processing your PDF',
    answering: 'answering your question',
    ending: 'ending your session and deleting its live data',
    page: 'loading this page',
    questions: 'loading the saved evidence',
    security: 'completing the security check',
  };
  return make(
    'We couldn’t complete this step.',
    `Something went wrong while ${tasks[context]}.`,
    context === 'ending'
      ? 'Keep this page open and retry ending the session.'
      : 'Try again. If it keeps happening, reload the page.',
  );
}
