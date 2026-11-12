const assert = require('assert/strict');
const test = require('node:test');

const {
  GitHubRequestQueue,
  RequestQueueAbortedError,
  formatRateLimit,
  getRetryDelay,
  isRateLimitError,
  readNonNegativeInteger,
} = require('../src/utils/request');

test('queues requests serially and spaces their start times', async () => {
  let currentTime = 0;
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const startTimes = [];

  const queue = new GitHubRequestQueue({
    client: {
      get: async () => {
        startTimes.push(currentTime);
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        activeRequests -= 1;
        return { data: { ok: true } };
      },
    },
    minIntervalMs: 2100,
    getToken: () => 'token',
    wait: async (milliseconds) => {
      currentTime += milliseconds;
    },
    now: () => currentTime,
    logger: {},
  });

  await Promise.all([
    queue.get('/one'),
    queue.get('/two'),
    queue.get('/three'),
  ]);

  assert.deepEqual(startTimes, [0, 2100, 4200]);
  assert.equal(maxActiveRequests, 1);
});

test('honors Retry-After before retrying a rate-limited request', async () => {
  let attempts = 0;
  const waits = [];
  const warnings = [];
  const queue = new GitHubRequestQueue({
    client: {
      get: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('rate limited');
          error.response = {
            status: 429,
            headers: { 'retry-after': '2' },
            data: { message: 'rate limit exceeded' },
          };
          throw error;
        }
        return { data: { ok: true } };
      },
    },
    minIntervalMs: 0,
    getToken: () => 'token',
    wait: async (milliseconds) => waits.push(milliseconds),
    random: () => 0,
    logger: {
      warn: (message) => warnings.push(message),
      info: () => undefined,
    },
  });

  const result = await queue.get('/retry');

  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(warnings.length, 1);
  assert.equal(queue.aborted, false);
});

test('cancels the remaining queue after a later request fails', async () => {
  const calls = [];
  const queue = new GitHubRequestQueue({
    client: {
      get: async (url) => {
        calls.push(url);
        if (url === '/two') {
          throw new Error('boom');
        }
        return { data: { ok: true } };
      },
    },
    minIntervalMs: 0,
    getToken: () => 'token',
    wait: async () => undefined,
    logger: {},
  });

  const results = await Promise.allSettled([
    queue.get('/one'),
    queue.get('/two'),
    queue.get('/three'),
  ]);

  assert.equal(queue.aborted, true);
  assert.deepEqual(calls, ['/one', '/two']);
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.message, 'boom');
  assert.equal(results[2].status, 'rejected');
  assert.ok(results[2].reason instanceof RequestQueueAbortedError);
  assert.equal(results[2].reason.cause.message, 'boom');
});

test('abort() rejects queued requests without calling the client', async () => {
  const calls = [];
  const queue = new GitHubRequestQueue({
    client: {
      get: async (url) => {
        calls.push(url);
        return { data: { ok: true } };
      },
    },
    minIntervalMs: 0,
    getToken: () => 'token',
    wait: async () => undefined,
    logger: {},
  });

  const first = queue.get('/one');
  const second = queue.get('/two');
  queue.abort(new Error('shutdown'));

  await assert.rejects(first, RequestQueueAbortedError);
  await assert.rejects(second, RequestQueueAbortedError);
  assert.deepEqual(calls, []);
  assert.equal(queue.aborted, true);
});

test('abort() cancels an in-flight request via its AbortSignal', async () => {
  let receivedSignal;
  const queue = new GitHubRequestQueue({
    client: {
      get: (_url, config) =>
        new Promise((_resolve, reject) => {
          receivedSignal = config.signal;
          config.signal.addEventListener('abort', () =>
            reject(new Error('client aborted'))
          );
        }),
    },
    minIntervalMs: 0,
    getToken: () => 'token',
    wait: async () => undefined,
    logger: {},
  });

  const pending = queue.get('/slow');
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, false);

  queue.abort(new Error('shutdown'));

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof RequestQueueAbortedError);
    assert.equal(error.cause.message, 'shutdown');
    return true;
  });
  assert.equal(receivedSignal.aborted, true);
});

test('abort() during a rate-limit wait stops retrying', async () => {
  let attempts = 0;
  let releaseWait;
  const queue = new GitHubRequestQueue({
    client: {
      get: async () => {
        attempts += 1;
        const error = new Error('rate limited');
        error.response = {
          status: 429,
          headers: { 'retry-after': '10' },
          data: { message: 'rate limit exceeded' },
        };
        throw error;
      },
    },
    minIntervalMs: 0,
    getToken: () => 'token',
    wait: () =>
      new Promise((resolve) => {
        releaseWait = resolve;
      }),
    random: () => 0,
    logger: {},
  });

  const pending = queue.get('/retry');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(attempts, 1);

  queue.abort(new Error('shutdown'));
  releaseWait();

  await assert.rejects(pending, RequestQueueAbortedError);
  assert.equal(attempts, 1);
});

test('abort() is idempotent and keeps the first cause', async () => {
  const queue = new GitHubRequestQueue({
    client: { get: async () => ({ data: { ok: true } }) },
    minIntervalMs: 0,
    getToken: () => 'token',
    wait: async () => undefined,
    logger: {},
  });

  queue.abort(new Error('first'));
  queue.abort(new Error('second'));

  await assert.rejects(queue.get('/x'), (error) => {
    assert.ok(error instanceof RequestQueueAbortedError);
    assert.equal(error.cause.message, 'first');
    return true;
  });
});

test('logs completion time and rate limit headers without exposing token', async () => {
  const messages = [];
  const queue = new GitHubRequestQueue({
    client: {
      get: async (_url, config) => {
        assert.equal(config.label, undefined);
        return {
          data: { ok: true },
          headers: {
            'x-ratelimit-remaining': '29',
            'x-ratelimit-limit': '30',
            'x-ratelimit-resource': 'search',
          },
        };
      },
    },
    minIntervalMs: 0,
    getToken: () => 'secret-token',
    logger: { info: (message) => messages.push(message) },
  });

  await queue.get('/search/repositories', { label: '语言榜 Rust' });

  assert.equal(messages.length, 2);
  assert.match(messages[0], /开始 #1 语言榜 Rust/);
  assert.match(messages[1], /额度 29\/30（search）/);
  assert.equal(messages.join(' ').includes('secret-token'), false);
});

test('formats no rate limit text when headers are unavailable', () => {
  assert.equal(formatRateLimit({}), '');
});

test('falls back to defaults when a numeric env value is empty', () => {
  assert.equal(readNonNegativeInteger('', 2100), 2100);
  assert.equal(readNonNegativeInteger('   ', 2100), 2100);
  assert.equal(readNonNegativeInteger(undefined, 3), 3);
  assert.equal(readNonNegativeInteger('0', 3), 0);
  assert.equal(readNonNegativeInteger('abc', 3), 3);
});

test('uses the reset header for an exhausted primary limit', () => {
  const error = {
    response: {
      status: 403,
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '103',
      },
      data: { message: 'API rate limit exceeded' },
    },
  };

  assert.equal(isRateLimitError(error), true);
  assert.equal(
    getRetryDelay(
      error,
      0,
      () => 100_000,
      () => 0
    ),
    4000
  );
});

test('does not retry unrelated forbidden responses', async () => {
  let attempts = 0;
  const forbidden = new Error('forbidden');
  forbidden.response = {
    status: 403,
    headers: {},
    data: { message: 'Resource not accessible by integration' },
  };
  const queue = new GitHubRequestQueue({
    client: {
      get: async () => {
        attempts += 1;
        throw forbidden;
      },
    },
    minIntervalMs: 0,
    getToken: () => 'token',
    wait: async () => undefined,
    logger: {},
  });

  await assert.rejects(queue.get('/forbidden'), forbidden);
  assert.equal(attempts, 1);
});
