import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Info,
  LockKeyhole,
  Trash2,
} from 'lucide-react';
import {
  createApi,
  publicNotice,
  ApiError,
  isSession,
  type Answer,
  type Level,
  type Notice,
  type Quota,
  type Session,
} from '@/lib/api';
import { uploadConfig, validateFiles } from '@/lib/uploads';
import { withBase } from '@/lib/paths';
import { FileUpload, type FileItem } from './ui/file-upload-2';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import Turnstile from './Turnstile';
import AnswerPanel from './AnswerPanel';
import LatticeLoader from './LatticeLoader.jsx';
import ErrorNotice from './ErrorNotice';
import { explain, type ErrorContext } from '@/lib/errors';

type Turn = { question: string; response?: Answer; error?: string };
type Saved = { session: Session; jobId?: string };
function message(error: unknown, context: ErrorContext = 'answering') {
  if (import.meta.env.DEV && error instanceof ApiError)
    console.debug('Request failed', {
      code: error.code,
      status: error.status,
      stage: error.stage,
    });
  const result = explain(error, context);
  return `${result.title} ${result.whatBroke} ${result.nextStep}`;
}
export default function TryDemo({ level }: { level: Level }) {
  const api = useMemo(
    () => createApi(import.meta.env.PUBLIC_API_BASE_URL || ''),
    [],
  );
  const storageKey = `rag-ladder:session:l${level}`;
  const abort = useRef(new AbortController());
  const activeFileId = useRef('');
  const pipelineStage = useRef('');
  const [notice, setNotice] = useState<Notice | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false),
    [challenge, setChallenge] = useState('');
  const [error, setError] = useState(''),
    [files, setFiles] = useState<FileItem[]>([]),
    [jobId, setJobId] = useState(''),
    [jobStatus, setJobStatus] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]),
    [question, setQuestion] = useState(''),
    [processing, setProcessing] = useState(true),
    [asking, setAsking] = useState(false);
  const [ended, setEnded] = useState(false),
    [confirmEnd, setConfirmEnd] = useState(false),
    [expired, setExpired] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false),
    [attempt, setAttempt] = useState(0);
  function save(value: Session, pendingJob?: string) {
    if (api.mock) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          session: value,
          ...(pendingJob ? { jobId: pendingJob } : {}),
        }),
      );
    } catch {
      setStorageWarning(true);
    }
  }
  function forget() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage may be disabled. */
    }
  }
  function fail(reason: unknown, context: ErrorContext = 'answering') {
    setError(message(reason, context));
    if (reason instanceof ApiError && [401, 410].includes(reason.status)) {
      setExpired(true);
      forget();
    }
    if (reason instanceof ApiError && reason.code === 'session_locked')
      setQuota((current) =>
        current ? { ...current, status: 'locked' } : current,
      );
  }
  function updateQuota(current: Session, value: Quota) {
    setQuota({
      ...value,
      docs_remaining: Math.max(
        0,
        Math.min(uploadConfig.maxFiles, current.limits.documents) -
          (current.limits.documents - value.docs_remaining),
      ),
      questions_remaining: Math.max(
        0,
        Math.min(10, current.limits.questions) -
          (current.limits.questions - value.questions_remaining),
      ),
    });
  }
  async function refresh(current: Session) {
    const updated = await api.status(current.token, abort.current.signal);
    updateQuota(current, updated);
    return updated;
  }
  async function poll(current: Session, id: string) {
    setJobId(id);
    save(current, id);
    try {
      while (!abort.current.signal.aborted) {
        const job = await api.job(current.token, id, abort.current.signal);
        updateQuota(current, job.session);
        pipelineStage.current = job.stage || job.status;
        setJobStatus(
          (
            {
              parsing: 'Reading your PDF',
              chunking: 'Splitting your notes',
              embedding: 'Preparing notes for search',
              indexing: 'Preparing notes for search',
              queued: 'Waiting to process your PDF',
              running: 'Processing your PDF',
            } as Record<string, string>
          )[job.status] || 'Processing your PDF',
        );
        if (job.status === 'failed' || job.error_code) {
          setJobId('');
          save(current);
          throw new ApiError(
            job.error_status ?? 422,
            job.error_code ?? 'ingest_failed',
            'This document could not be processed.',
            null,
            undefined,
            job.stage,
          );
        }
        if (job.status === 'done') {
          setJobStatus(
            api.mock
              ? 'Mock document accepted · no indexing performed'
              : job.duplicate
                ? 'Duplicate document · no quota used'
                : 'Your notes are ready for questions.',
          );
          setJobId('');
          save(current);
          return job;
        }
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          };
          const timer = setTimeout(() => {
            abort.current.signal.removeEventListener('abort', done);
            resolve();
          }, 1800);
          abort.current.signal.addEventListener('abort', done, { once: true });
        });
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.job) {
        updateQuota(current, reason.job.session);
        setJobId('');
        save(current);
      }
      if (reason instanceof ApiError && !reason.stage)
        reason.stage = pipelineStage.current;
      throw reason;
    }
    throw new DOMException('Aborted', 'AbortError');
  }
  useEffect(() => {
    abort.current = new AbortController();
    let disposed = false;
    async function initialize() {
      setLoading(true);
      setError('');
      try {
        setNotice(await api.notice(abort.current.signal));
        if (disposed || api.mock) return;
        let saved: Saved | null = null;
        try {
          const value: unknown = JSON.parse(
            sessionStorage.getItem(storageKey) || 'null',
          );
          if (
            value &&
            typeof value === 'object' &&
            'session' in value &&
            isSession(value.session) &&
            (!('jobId' in value) || typeof value.jobId === 'string')
          )
            saved = value as Saved;
          else forget();
        } catch {
          forget();
        }
        if (saved?.session?.token && saved.session.level === level) {
          setSession(saved.session);
          await refresh(saved.session);
          if (saved.jobId) {
            setBusy(true);
            await poll(saved.session, saved.jobId);
          }
        }
      } catch (reason) {
        if (!disposed) fail(reason, 'connecting');
      } finally {
        if (!disposed) {
          setLoading(false);
          setBusy(false);
        }
      }
    }
    initialize();
    return () => {
      disposed = true;
      abort.current.abort();
    };
  }, [attempt, api, level]);
  useEffect(() => {
    if (!quota || expired) return;
    const timer = setTimeout(
      () => {
        setExpired(true);
        forget();
        setError('Your session has expired. Start a new session to continue.');
      },
      Math.min(
        2147483647,
        Math.max(0, Date.parse(quota.expires_at) - Date.now()),
      ),
    );
    return () => clearTimeout(timer);
  }, [quota?.expires_at, expired]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  async function start() {
    if (!accepted || (!api.mock && !challenge)) return;
    setBusy(true);
    setError('');
    try {
      const created = await api.start(level, challenge, abort.current.signal);
      setSession(created);
      save(created);
      setEnded(false);
      setExpired(false);
      setFiles([]);
      setTurns([]);
      await refresh(created);
    } catch (reason) {
      fail(reason, 'connecting');
      setChallenge('');
      setAttempt((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  function addFiles(selected: File[]) {
    if (!session || !quota || busy) return;
    const queued = files.filter((file) => file.status === 'idle').length;
    const invalid = validateFiles(
      selected,
      level,
      Math.max(
        0,
        Math.min(uploadConfig.maxFiles, quota.docs_remaining) - queued,
      ),
      session.limits.upload_bytes,
      files.map((item) => item.file),
    );
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setFiles((current) => [
      ...current,
      ...selected.map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: 'idle' as const,
      })),
    ]);
  }
  async function upload() {
    if (!session || busy) return;
    setBusy(true);
    setError('');
    try {
      for (const item of files.filter((file) => file.status === 'idle')) {
        activeFileId.current = item.id;
        setJobStatus('Preparing document');
        setFiles((current) =>
          current.map((file) =>
            file.id === item.id ? { ...file, status: 'uploading' } : file,
          ),
        );
        try {
          const accepted = await api.ingest(
            session.token,
            item.file,
            abort.current.signal,
          );
          const job = await poll(session, accepted.job_id);
          setFiles((current) =>
            current.map((file) =>
              file.id === item.id
                ? { ...file, status: 'success', progress: 100 }
                : file,
            ),
          );
          setJobStatus(
            api.mock
              ? 'Mock document accepted · no indexing performed'
              : job.duplicate
                ? 'Duplicate document · no quota used'
                : 'Your notes are ready for questions.',
          );
        } catch (reason) {
          setFiles((current) =>
            current.map((file) =>
              file.id === item.id
                ? {
                    ...file,
                    status: 'error',
                    errorMessage: message(reason, 'uploading'),
                  }
                : file,
            ),
          );
          throw reason;
        }
      }
    } catch (reason) {
      fail(reason, asking ? 'answering' : 'uploading');
      try {
        await refresh(session);
      } catch {
        /* Preserve the original upload error. */
      }
    } finally {
      setBusy(false);
    }
  }
  async function resumeJob() {
    if (!session || !jobId || busy) return;
    setBusy(true);
    setError('');
    try {
      await poll(session, jobId);
      setFiles((current) =>
        current.map((file) =>
          file.id === activeFileId.current
            ? {
                ...file,
                status: 'success',
                progress: 100,
                errorMessage: undefined,
              }
            : file,
        ),
      );
    } catch (reason) {
      fail(reason, 'uploading');
    } finally {
      setBusy(false);
    }
  }
  async function ask(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !session ||
      !quota ||
      busy ||
      !question.trim() ||
      !quota.questions_remaining
    )
      return;
    const value = question;
    setQuestion('');
    setBusy(true);
    setAsking(true);
    setError('');
    setTurns((current) => [...current, { question: value }]);
    try {
      const result = await api.ask(
        session.token,
        value,
        level === 2 && processing,
        abort.current.signal,
      );
      if (result.session) updateQuota(session, result.session);
      else await refresh(session);
      setTurns((current) =>
        current.map((turn, index) =>
          index === current.length - 1 ? { ...turn, response: result } : turn,
        ),
      );
    } catch (reason) {
      fail(reason);
      setTurns((current) =>
        current.map((turn, index) =>
          index === current.length - 1
            ? { ...turn, error: message(reason) }
            : turn,
        ),
      );
      try {
        await refresh(session);
      } catch {
        /* The original error remains actionable. */
      }
    } finally {
      setAsking(false);
      setBusy(false);
    }
  }
  async function end() {
    if (!session || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.end(session.token, abort.current.signal);
      forget();
      setSession(null);
      setQuota(null);
      setFiles([]);
      setTurns([]);
      setJobId('');
      setEnded(true);
      setAccepted(false);
      setChallenge('');
      setConfirmEnd(false);
    } catch (reason) {
      fail(reason, 'ending');
    } finally {
      setBusy(false);
    }
  }
  const canAsk =
    session &&
    quota &&
    quota.docs_remaining < session.limits.documents &&
    !jobId &&
    !expired &&
    quota.status === 'active';
  return (
    <div className="space-y-6 pb-20">
      {api.mock && (
        <div className="notice">
          <Info size={20} aria-hidden="true" />
          <div>
            <strong>Local mock mode.</strong> Files stay in this page and are
            not read, uploaded or indexed. No model runs and no measured timings
            or answers are simulated. This preview is not connected to a live
            backend. Mock state resets on reload.
          </div>
        </div>
      )}
      {storageWarning && (
        <div className="notice">
          <CircleAlert size={20} aria-hidden="true" />
          <p>
            Tab storage is unavailable. Keep this page open to retain your
            session and end it explicitly when finished.
          </p>
        </div>
      )}
      {ended && (
        <div className="notice" role="status">
          <CircleCheck size={20} aria-hidden="true" />
          <p>
            {api.mock
              ? 'The mock session has ended.'
              : 'Your session has ended and the server has completed its live-data cleanup. Provider records and database backups may remain.'}
          </p>
        </div>
      )}
      {error && (
        <ErrorNotice message={error}>
          {!session && !notice && (
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry connection
            </Button>
          )}
          {expired && (
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => {
                setSession(null);
                setQuota(null);
                setFiles([]);
                setJobId('');
                setExpired(false);
                setError('');
                setAccepted(false);
                setChallenge('');
              }}
            >
              Start again
            </Button>
          )}
        </ErrorNotice>
      )}
      {loading ? (
        <div
          className="panel min-h-[380px] space-y-5"
          role="status"
          aria-busy="true"
          aria-label="Loading session"
        >
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-11 w-44 rounded-pill" />
        </div>
      ) : !session ? (
        <article className="panel max-w-3xl">
          <p className="eyebrow">01 / BEFORE YOU UPLOAD</p>
          <h2 className="mt-4 text-3xl">Read the data notice.</h2>
          <p className="mt-5 text-body leading-relaxed">
            {notice && publicNotice(notice.notice)}
          </p>
          <div className="mt-5 flex flex-wrap gap-4 text-body">
            <a
              className="inline-flex min-h-11 items-center underline"
              href={withBase('/privacy/')}
            >
              Privacy draft
            </a>
            <a
              className="inline-flex min-h-11 items-center underline"
              href={withBase('/cookies/')}
            >
              Storage and cookies draft
            </a>
          </div>
          <label className="mt-4 flex min-h-11 items-start gap-3 text-body">
            <input
              className="mt-1 size-5 shrink-0 accent-primary"
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              I have read the notice and will only use non-sensitive material I
              am permitted to share.
            </span>
          </label>
          {!api.mock &&
            accepted &&
            (notice?.turnstile_site_key ||
              import.meta.env.PUBLIC_TURNSTILE_SITE_KEY) && (
              <Turnstile
                key={attempt}
                siteKey={
                  notice?.turnstile_site_key ||
                  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY
                }
                action={notice?.turnstile_action || 'session_start'}
                onToken={setChallenge}
              />
            )}
          {!api.mock &&
            !notice?.turnstile_site_key &&
            !import.meta.env.PUBLIC_TURNSTILE_SITE_KEY && (
              <p className="mt-5 flex gap-2 text-body">
                <LockKeyhole size={18} aria-hidden="true" />
                The security check is not configured. A session cannot start
                yet.
              </p>
            )}
          <Button
            className="mt-6"
            disabled={!notice || busy || !accepted || (!api.mock && !challenge)}
            onClick={start}
          >
            {busy
              ? 'Starting session…'
              : api.mock
                ? 'Start mock session'
                : `Start ${level === 1 ? 'Naive' : 'Intermediate'} session`}
          </Button>
        </article>
      ) : (
        <>
          <div className="panel flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="text-product-label font-semibold">
                {level === 1 ? 'Naive' : 'Intermediate'} session{' '}
                {expired
                  ? 'expired'
                  : quota?.status === 'locked'
                    ? 'locked'
                    : 'active'}
              </p>
              <p className="mt-2 text-body text-muted-foreground">
                {quota
                  ? `${quota.docs_remaining} document slots · ${quota.questions_remaining} questions remaining`
                  : 'Loading quota…'}
              </p>
              <p className="mt-2 text-utility-nav text-muted-foreground">
                Expires at{' '}
                {quota ? new Date(quota.expires_at).toLocaleTimeString() : '…'}{' '}
                · {session.limits.idle_minutes} minutes idle,{' '}
                {session.limits.absolute_minutes} minutes maximum
              </p>
            </div>
            <Dialog
              open={confirmEnd}
              onOpenChange={(open) => {
                setConfirmEnd(open);
                if (open) setError('');
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" disabled={busy || expired}>
                  <Trash2 size={16} aria-hidden="true" />
                  End session
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>End this session?</DialogTitle>
                  <DialogDescription>
                    {api.mock
                      ? 'This clears the local mock session and displayed conversation. No remote data exists in mock mode.'
                      : 'This clears the conversation here and asks the server to delete live session files, vectors and history. Provider records and backups may remain.'}
                  </DialogDescription>
                </DialogHeader>
                {error && <ErrorNotice message={error} />}
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmEnd(false)}
                  >
                    Keep session
                  </Button>
                  <Button disabled={busy} onClick={end}>
                    {api.mock ? 'End mock session' : 'End and delete live data'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <article className="panel">
            <p className="eyebrow">02 / ADD YOUR NOTES</p>
            <h2 className="mb-6 mt-4 text-3xl">
              A small collection. Your questions.
            </h2>
            <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
              <div>
                <FileUpload
                  level={level}
                  files={files}
                  maxFiles={Math.min(
                    uploadConfig.maxFiles,
                    session.limits.documents,
                  )}
                  remainingFiles={Math.max(
                    0,
                    (quota?.docs_remaining ?? 0) -
                      files.filter((file) => file.status === 'idle').length,
                  )}
                  maxSizeMB={session.limits.upload_bytes / 1024 / 1024}
                  disabled={
                    busy || expired || quota?.status !== 'active' || !!jobId
                  }
                  onFilesAdded={addFiles}
                  onFileRemove={(id) =>
                    setFiles((current) =>
                      current.filter((file) => file.id !== id),
                    )
                  }
                />
                <Button
                  className="mt-4"
                  disabled={
                    busy ||
                    expired ||
                    !!jobId ||
                    !files.some((file) => file.status === 'idle') ||
                    quota?.status !== 'active'
                  }
                  onClick={upload}
                >
                  {busy && !asking
                    ? 'Processing documents…'
                    : 'Upload queued documents'}
                </Button>
                <p className="mt-4 text-body text-muted-foreground">
                  Up to {session.limits.pages} pages per document. Documents are
                  deleted when the session ends; cleanup can be delayed. Use
                  “End session” when finished.
                </p>
                {quota?.docs_remaining === 0 && (
                  <p className="mt-4 flex gap-2 text-body">
                    <CircleAlert size={18} aria-hidden="true" />
                    Document quota reached. You can continue asking questions.
                  </p>
                )}
              </div>
              <div className="rounded-card border border-border p-6">
                <p className="text-product-label font-semibold">
                  Processing details
                </p>
                <div className="mt-5">
                  <LatticeLoader
                    status={
                      !api.mock &&
                      busy &&
                      (asking ||
                        files.some((file) => file.status === 'uploading') ||
                        !!jobId)
                        ? 'working'
                        : 'idle'
                    }
                    label="Thinking through your notes"
                    showTimer={false}
                  />
                </div>
                <div
                  className="min-h-20 py-5"
                  role="status"
                  aria-busy={busy && !asking}
                >
                  {busy && !asking ? (
                    <>
                      <p className="text-body">
                        {jobStatus || 'Preparing document'}
                      </p>
                      <Skeleton className="mt-3 h-5 w-3/4" />
                    </>
                  ) : (
                    <p className="text-body">
                      {jobStatus || 'No documents processed in this page yet.'}
                    </p>
                  )}
                </div>
                {jobId && !busy && (
                  <Button
                    className="mt-4"
                    variant="outline"
                    onClick={resumeJob}
                  >
                    Check upload progress
                  </Button>
                )}
              </div>
            </div>
          </article>
          <article className="panel">
            <p className="eyebrow">03 / ASK YOUR NOTES</p>
            <h2 className="mt-4 text-3xl">Follow the evidence.</h2>
            <p className="mt-4 text-body text-muted-foreground">
              {level === 1
                ? 'Naive answers each question independently. The conversation below is kept for your reference.'
                : 'Intermediate can use recent conversation to resolve references. History is not evidence.'}{' '}
              This page’s transcript is cleared on reload; the session can
              resume in this tab.
            </p>
            <div className="my-6 space-y-6" aria-label="Conversation history">
              {turns.map((turn, index) => (
                <article key={index}>
                  <p className="mb-3 whitespace-pre-wrap break-words text-section-nav font-semibold">
                    {turn.question}
                  </p>
                  {turn.error ? (
                    <ErrorNotice message={turn.error} />
                  ) : (
                    <AnswerPanel
                      answer={turn.response}
                      pending={!turn.response}
                      mock={api.mock}
                    />
                  )}
                </article>
              ))}
            </div>
            <form onSubmit={ask}>
              <Label htmlFor={`question-${level}`}>Your question</Label>
              <Textarea
                id={`question-${level}`}
                className="mt-3 min-h-28"
                maxLength={2000}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={!canAsk || busy || quota?.questions_remaining === 0}
                aria-describedby={`question-help-${level}`}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                <p
                  id={`question-help-${level}`}
                  className="text-utility-nav text-muted-foreground"
                >
                  {!canAsk
                    ? 'Finish uploading a document to ask questions.'
                    : `${question.length}/2000 characters · ${quota?.questions_remaining} questions remaining`}
                </p>
                {level === 2 && (
                  <label className="flex min-h-11 items-center gap-3 text-body">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={processing}
                      onChange={(event) => setProcessing(event.target.checked)}
                      disabled={busy}
                    />
                    Resolve references and rewrite when needed
                  </label>
                )}
              </div>
              <Button
                className="mt-4"
                type="submit"
                disabled={
                  !canAsk ||
                  busy ||
                  !question.trim() ||
                  quota?.questions_remaining === 0
                }
              >
                {asking ? 'Generating answer…' : 'Ask question'}
              </Button>
            </form>
            {quota?.questions_remaining === 0 && (
              <p className="mt-5 flex gap-2 text-body">
                <CircleAlert size={18} aria-hidden="true" />
                All questions have been used. End the session to finish.
              </p>
            )}
          </article>
        </>
      )}
    </div>
  );
}
