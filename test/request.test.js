const assert = require('assert/strict');
const test = require('node:test');

const {
  GitHubRequestQueue,
  getRetryDelay,
  isRateLimitError,
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
  });

  await Promise.all([queue.get('/one'), queue.get('/two'), queue.get('/three')]);

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
    logger: { warn: (message) => warnings.push(message) },
  });

  const result = await queue.get('/retry');

  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(warnings.length, 1);
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
  assert.equal(getRetryDelay(error, 0, () => 100_000, () => 0), 4000);
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
    logger: { warn: () => undefined },
  });

  await assert.rejects(queue.get('/forbidden'), forbidden);
  assert.equal(attempts, 1);
});
