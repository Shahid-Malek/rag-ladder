import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApi, ApiError, defaultLimits } from '../src/lib/api.ts';

const quota = {
  docs_remaining: 1,
  questions_remaining: 9,
  expires_at: new Date(Date.now() + 60000).toISOString(),
  status: 'active',
};
const session = {
  session_id: 'test-session',
  token: 'test.token',
  level: 1,
  limits: defaultLimits,
  expires_at: quota.expires_at,
  notice: 'Test data notice',
};

test('live requests use the exact session contract and bearer authentication', async () => {
  const original = globalThis.fetch,
    requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/notice'))
      return Response.json({
        notice: 'Notice',
        turnstile_site_key: 'public-key',
        turnstile_action: 'session_start',
      });
    if (url.endsWith('/session') && init.method === 'POST')
      return Response.json(session);
    if (url.endsWith('/session') && init.method === 'DELETE')
      return Response.json({ status: 'ended' });
    if (url.endsWith('/session'))
      return Response.json({ ...quota, session: quota });
    if (url.endsWith('/ingest'))
      return Response.json({ job_id: 'job-1' }, { status: 202 });
    if (url.endsWith('/ingest/job-1'))
      return Response.json({
        status: 'done',
        chunks: 3,
        flagged_chunks: 0,
        duplicate: false,
        error_code: null,
        session: quota,
      });
    return Response.json({
      answer: 'Test answer [chunk-1]',
      original_question: 'Question?',
      rewritten_query: null,
      rewritten_queries: [],
      citations: ['chunk-1'],
      citation_valid: true,
      invalid_citations: [],
      missing_citations: false,
      retrieved_chunks: [
        { chunk_id: 'chunk-1', text: 'Test source', pages: [1] },
      ],
      trace: { retrieval_seconds: 0.1, timings: { answer: 0.2 } },
      session: quota,
    });
  };
  try {
    const api = createApi('https://api.example/');
    await api.notice();
    await api.start(1, 'challenge');
    await api.status(session.token);
    await api.ingest(
      session.token,
      new File(['%PDF-test'], 'notes.pdf', { type: 'application/pdf' }),
    );
    const job = await api.job(session.token, 'job-1');
    assert.equal(job.status, 'done');
    const answer = await api.ask(session.token, 'Question?', false);
    assert.equal(answer.retrieved_chunks[0].text, 'Test source');
    await api.end(session.token);
    const create = requests.find(
      (request) =>
        request.init.method === 'POST' && request.url.endsWith('/session'),
    );
    assert.deepEqual(JSON.parse(create.init.body), {
      level: 1,
      turnstile_token: 'challenge',
      notice_accepted: true,
    });
    const upload = requests.find((request) => request.url.endsWith('/ingest'));
    assert.deepEqual([...upload.init.body.keys()], ['file']);
    assert.equal(
      upload.init.headers.get('Content-Type'),
      null,
      'Browser must choose the multipart boundary',
    );
    assert.equal(upload.init.headers.get('Authorization'), 'Bearer test.token');
    assert.equal(upload.init.credentials, 'omit');
    assert.equal(
      requests.some((request) => request.init.headers.has('X-API-Key')),
      false,
    );
    const ask = requests.find((request) => request.url.endsWith('/ask'));
    assert.deepEqual(JSON.parse(ask.init.body), {
      question: 'Question?',
      query_processing: false,
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('rate limits and failed ingest bodies retain actionable metadata', async () => {
  const original = globalThis.fetch;
  try {
    const api = createApi('https://api.example');
    globalThis.fetch = async () =>
      Response.json(
        { error_code: 'rate_limited', detail: 'Slow down' },
        { status: 429, headers: { 'Retry-After': '10' } },
      );
    await assert.rejects(
      api.ask('token', 'Question?', true),
      (error) =>
        error instanceof ApiError &&
        error.status === 429 &&
        error.retryAfter === 10,
    );
    globalThis.fetch = async () =>
      Response.json(
        {
          status: 'failed',
          error_code: 'no_text_found',
          error_detail: 'No text',
          error_status: 422,
          session: quota,
        },
        { status: 422 },
      );
    await assert.rejects(
      api.job('token', 'job'),
      (error) =>
        error.code === 'no_text_found' &&
        error.job.session.docs_remaining === 1,
    );
    globalThis.fetch = async () => {
      throw new TypeError('Connection failed');
    };
    await assert.rejects(
      api.status('token'),
      (error) => error.code === 'network_error',
    );
    globalThis.fetch = async () =>
      Response.json({ answer: '<script>invalid</script>' });
    await assert.rejects(
      api.ask('token', 'Question?', false),
      (error) => error.code === 'invalid_response',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('mock mode never calls the network or reads file contents, and enforces quotas', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Unexpected network call');
  };
  try {
    const api = createApi();
    const session = await api.start(2, '');
    const file = new File(['placeholder'], 'notes.pdf', {
      type: 'application/pdf',
    });
    file.arrayBuffer = () => {
      throw new Error('File was read');
    };
    await api.ingest(session.token, file);
    await api.ingest(session.token, file);
    await assert.rejects(
      api.ingest(session.token, file),
      (error) => error.code === 'quota_exceeded',
    );
    for (let i = 0; i < 10; i++) {
      const answer = await api.ask(session.token, `Question ${i}`, true);
      assert.equal(answer.answer, null);
      assert.deepEqual(answer.trace, {});
    }
    await assert.rejects(
      api.ask(session.token, 'One more', true),
      (error) => error.code === 'quota_exceeded',
    );
    await api.end(session.token);
    await assert.rejects(
      api.status(session.token),
      (error) => error.code === 'session_expired',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('timeouts and code/stage responses retain categories for safe frontend explanations', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new DOMException('private upstream detail', 'TimeoutError');
    };
    await assert.rejects(
      createApi('https://api.test').notice(),
      (error) => error instanceof ApiError && error.code === 'timeout',
    );
    globalThis.fetch = async () =>
      Response.json(
        {
          code: 'server_failure',
          stage: 'chunking',
          detail: 'private upstream detail',
        },
        { status: 503 },
      );
    await assert.rejects(
      createApi('https://api.test').notice(),
      (error) =>
        error instanceof ApiError &&
        error.code === 'server_failure' &&
        error.stage === 'chunking',
    );
  } finally {
    globalThis.fetch = original;
  }
});
