import { uploadConfig } from './uploads.ts';
export type Level = 1 | 2;
export interface Limits {
  documents: number;
  questions: number;
  upload_bytes: number;
  pages: number;
  idle_minutes: number;
  absolute_minutes: number;
}
export interface Quota {
  docs_remaining: number;
  questions_remaining: number;
  expires_at: string;
  status: string;
}
export interface Session {
  session_id: string;
  token: string;
  level: Level;
  limits: Limits;
  expires_at: string;
  notice: string;
}
export interface Notice {
  notice: string;
  turnstile_site_key: string;
  turnstile_action: string;
  notice_accepted_required: boolean;
}
export interface IngestJob {
  status: string;
  duplicate: boolean;
  chunks: number;
  flagged_chunks: number;
  error_code: string | null;
  error_status: number | null;
  error_detail: string | null;
  stage?: string;
  session: Quota;
}
export interface Chunk {
  chunk_id: string;
  text: string;
  file?: string;
  pages?: number[];
  heading_path?: string[];
}
export interface Answer {
  answer: string | null;
  original_question: string;
  rewritten_query: string | null;
  rewritten_queries: string[];
  citations: string[];
  citation_valid: boolean;
  invalid_citations: string[];
  missing_citations: boolean;
  retrieved_chunks: Chunk[];
  session?: Quota;
  generation_status?: string;
  conversation?: string;
  trace: {
    retrieval_seconds?: number;
    timings?: Record<string, number>;
    guardrails?: { rule_ids?: string[] };
  };
}
export class ApiError extends Error {
  status: number;
  code: string;
  retryAfter: number | null;
  stage?: string;
  job?: IngestJob;
  constructor(
    status: number,
    code: string,
    message: string,
    retryAfter: number | null = null,
    job?: IngestJob,
    stage?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.job = job;
    this.stage = stage;
  }
}

// Defaults copied from config.py; a live session's returned limits always win.
export const defaultLimits: Limits = {
  documents: uploadConfig.maxFiles,
  questions: 10,
  upload_bytes: uploadConfig.maxBytes,
  pages: 30,
  idle_minutes: 60,
  absolute_minutes: 120,
};
export const dataNotice =
  'This demo processes files temporarily on our server. Your question, relevant excerpts and recent Intermediate conversation are sent to external AI providers. A storage provider holds extracted note representations, conversation history and session metadata. Some free AI services may retain prompts or use them for training. Ending or timing out a session requests deletion of live files, extracted note data and conversation; cleanup may be delayed. Provider records and database backups may remain longer. Application logs contain operational metadata, not your document or question text. Use only non-sensitive material you are permitted to share.';
export function publicNotice(notice: string) {
  return notice
    .replace(/Level 1|\bL1\b/g, 'Naive')
    .replace(/Level 2|\bL2\b/g, 'Intermediate')
    .replace(/Level 3|\bL3\b/g, 'Advanced');
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function quota(value: unknown): value is Quota {
  return (
    record(value) &&
    Number.isInteger(value.docs_remaining) &&
    Number.isInteger(value.questions_remaining) &&
    Number(value.docs_remaining) >= 0 &&
    Number(value.questions_remaining) >= 0 &&
    typeof value.status === 'string' &&
    typeof value.expires_at === 'string' &&
    Number.isFinite(Date.parse(value.expires_at))
  );
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
export function isSession(value: unknown): value is Session {
  return (
    record(value) &&
    typeof value.token === 'string' &&
    value.token.length > 0 &&
    typeof value.session_id === 'string' &&
    (value.level === 1 || value.level === 2) &&
    record(value.limits) &&
    Object.keys(defaultLimits).every((key) => {
      const limit = (value.limits as Record<string, unknown>)[key];
      return Number.isInteger(limit) && Number(limit) > 0;
    }) &&
    typeof value.expires_at === 'string' &&
    Number.isFinite(Date.parse(value.expires_at)) &&
    typeof value.notice === 'string'
  );
}

function malformed(): never {
  throw new ApiError(
    502,
    'invalid_response',
    'The server returned an unexpected response. Please try again.',
  );
}

export function createApi(baseUrl = '') {
  const base = baseUrl.replace(/\/+$/, '');
  const mock = !base;
  let localSession: Session | null = null,
    localQuota: Quota | null = null;
  const jobs = new Map<string, IngestJob>();
  async function request(
    path: string,
    init: RequestInit = {},
    token?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      if (
        typeof AbortSignal.timeout !== 'function' ||
        typeof AbortSignal.any !== 'function'
      )
        throw new ApiError(
          0,
          'unsupported_browser',
          'Required browser feature missing',
        );
      response = await fetch(`${base}${path}`, {
        ...init,
        headers,
        credentials: 'omit',
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(185000)])
          : AbortSignal.timeout(185000),
      });
    } catch (error) {
      if (signal?.aborted || error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === 'TimeoutError')
        throw new ApiError(0, 'timeout', 'Request timed out');
      throw new ApiError(
        0,
        'network_error',
        'The request could not reach the server. Check your connection before trying again.',
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(
        response.status,
        'invalid_response',
        'The server did not return a readable response.',
      );
    }
    if (!response.ok) {
      const data = record(body) ? body : {};
      const retry = response.headers.get('Retry-After');
      const retryAfter = retry
        ? /^\d+$/.test(retry)
          ? Number(retry)
          : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))
        : null;
      throw new ApiError(
        response.status,
        typeof data.code === 'string'
          ? data.code
          : typeof data.error_code === 'string'
            ? data.error_code
            : 'request_failed',
        typeof data.detail === 'string'
          ? data.detail
          : typeof data.error_detail === 'string'
            ? data.error_detail
            : 'The request could not be completed.',
        Number.isFinite(retryAfter) ? retryAfter : null,
        quota(data.session) && typeof data.status === 'string'
          ? (data as unknown as IngestJob)
          : undefined,
        typeof data.stage === 'string' ? data.stage : undefined,
      );
    }
    return body;
  }
  function json(body: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }
  function local(token: string) {
    if (!localSession || localSession.token !== token || !localQuota)
      throw new ApiError(
        410,
        'session_expired',
        'This mock session has ended.',
      );
    if (Date.parse(localQuota.expires_at) <= Date.now())
      throw new ApiError(
        410,
        'session_expired',
        'This mock session has expired.',
      );
    return localQuota;
  }
  return {
    mock,
    async notice(signal?: AbortSignal): Promise<Notice> {
      if (mock)
        return {
          notice: dataNotice,
          turnstile_site_key: '',
          turnstile_action: 'session_start',
          notice_accepted_required: true,
        };
      const data = await request('/notice', {}, undefined, signal);
      if (
        !record(data) ||
        typeof data.notice !== 'string' ||
        typeof data.turnstile_site_key !== 'string' ||
        typeof data.turnstile_action !== 'string'
      )
        malformed();
      return data as unknown as Notice;
    },
    async start(
      level: Level,
      turnstile_token: string,
      signal?: AbortSignal,
    ): Promise<Session> {
      if (mock) {
        localSession = {
          session_id: crypto.randomUUID(),
          token: `mock.${crypto.randomUUID()}`,
          level,
          limits: { ...defaultLimits },
          expires_at: new Date(
            Date.now() + defaultLimits.absolute_minutes * 60000,
          ).toISOString(),
          notice: dataNotice,
        };
        localQuota = {
          docs_remaining: 2,
          questions_remaining: 10,
          expires_at: localSession.expires_at,
          status: 'active',
        };
        return { ...localSession };
      }
      const data = await request(
        '/session',
        json({ level, turnstile_token, notice_accepted: true }),
        undefined,
        signal,
      );
      if (!isSession(data) || data.level !== level) malformed();
      return data as unknown as Session;
    },
    async status(token: string, signal?: AbortSignal): Promise<Quota> {
      if (mock) return { ...local(token) };
      const data = await request('/session', {}, token, signal);
      const value = record(data) && record(data.session) ? data.session : data;
      if (!quota(value)) malformed();
      return value;
    },
    async end(token: string, signal?: AbortSignal): Promise<void> {
      if (mock) {
        local(token);
        localSession = null;
        localQuota = null;
        jobs.clear();
        return;
      }
      const data = await request(
        '/session',
        { method: 'DELETE' },
        token,
        signal,
      );
      if (!record(data) || data.status !== 'ended') malformed();
    },
    async ingest(
      token: string,
      file: File,
      signal?: AbortSignal,
    ): Promise<{ job_id: string }> {
      if (mock) {
        const session = local(token);
        if (!session.docs_remaining)
          throw new ApiError(403, 'quota_exceeded', 'Document quota reached.');
        session.docs_remaining--;
        const id = crypto.randomUUID();
        jobs.set(id, {
          status: 'done',
          duplicate: false,
          chunks: 0,
          flagged_chunks: 0,
          error_code: null,
          error_status: null,
          error_detail: null,
          session: { ...session },
        });
        return { job_id: id };
      }
      const form = new FormData();
      form.append('file', file);
      const data = await request(
        '/ingest',
        { method: 'POST', body: form },
        token,
        signal,
      );
      if (!record(data) || typeof data.job_id !== 'string') malformed();
      return { job_id: data.job_id };
    },
    async job(
      token: string,
      id: string,
      signal?: AbortSignal,
    ): Promise<IngestJob> {
      if (mock) {
        local(token);
        const job = jobs.get(id);
        if (!job) malformed();
        return { ...job };
      }
      const data = await request(
        `/ingest/${encodeURIComponent(id)}`,
        {},
        token,
        signal,
      );
      if (
        !record(data) ||
        typeof data.status !== 'string' ||
        !quota(data.session) ||
        typeof data.chunks !== 'number' ||
        typeof data.flagged_chunks !== 'number'
      )
        malformed();
      return data as unknown as IngestJob;
    },
    async ask(
      token: string,
      question: string,
      query_processing: boolean,
      signal?: AbortSignal,
    ): Promise<Answer> {
      if (!question.trim() || question.length > 2000)
        throw new ApiError(
          422,
          'validation_failed',
          'Enter a question of 1–2000 characters.',
        );
      if (mock) {
        const session = local(token);
        if (!session.questions_remaining)
          throw new ApiError(403, 'quota_exceeded', 'Question quota reached.');
        if (session.docs_remaining === defaultLimits.documents)
          throw new ApiError(422, 'validation_failed', 'Add a document first.');
        session.questions_remaining--;
        return {
          answer: null,
          original_question: question,
          rewritten_query: null,
          rewritten_queries: [],
          citations: [],
          citation_valid: false,
          invalid_citations: [],
          missing_citations: true,
          retrieved_chunks: [],
          session: { ...session },
          generation_status: 'unavailable',
          conversation:
            localSession?.level === 2 ? 'multi_turn' : 'single_turn',
          trace: {},
        };
      }
      const data = await request(
        '/ask',
        json({ question, query_processing }),
        token,
        signal,
      );
      if (
        !record(data) ||
        !(data.answer === null || typeof data.answer === 'string') ||
        typeof data.original_question !== 'string' ||
        !strings(data.citations) ||
        !strings(data.rewritten_queries) ||
        typeof data.citation_valid !== 'boolean' ||
        !Array.isArray(data.retrieved_chunks) ||
        !data.retrieved_chunks.every(
          (chunk) =>
            record(chunk) &&
            typeof chunk.chunk_id === 'string' &&
            typeof chunk.text === 'string' &&
            (chunk.file === undefined || typeof chunk.file === 'string') &&
            (chunk.pages === undefined ||
              (Array.isArray(chunk.pages) &&
                chunk.pages.every(
                  (page) => Number.isInteger(page) && page > 0,
                ))),
        ) ||
        !record(data.trace) ||
        (data.session !== undefined &&
          data.session !== null &&
          !quota(data.session))
      )
        malformed();
      return data as unknown as Answer;
    },
  };
}
