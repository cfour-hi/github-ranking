const axios = require('axios');

const DEFAULT_MIN_INTERVAL_MS = 2100;
const DEFAULT_MAX_RETRIES = 3;
const SECONDARY_RATE_LIMIT_DELAY_MS = 60_000;
const RESET_BUFFER_MS = 1000;
const MAX_JITTER_MS = 500;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const readNonNegativeInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const isRateLimitError = (error) => {
  const response = error && error.response;
  if (!response || ![403, 429].includes(response.status)) {
    return false;
  }

  const headers = response.headers || {};
  const message = String(
    response.data && response.data.message ? response.data.message : ''
  ).toLowerCase();

  return (
    response.status === 429 ||
    headers['retry-after'] !== undefined ||
    String(headers['x-ratelimit-remaining']) === '0' ||
    message.includes('rate limit')
  );
};

const getRetryDelay = (error, retryCount, now, random) => {
  const headers = error.response.headers || {};
  const retryAfterSeconds = Number(headers['retry-after']);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000 + Math.floor(random() * MAX_JITTER_MS);
  }

  const resetSeconds = Number(headers['x-ratelimit-reset']);
  if (
    String(headers['x-ratelimit-remaining']) === '0' &&
    Number.isFinite(resetSeconds)
  ) {
    return (
      Math.max(resetSeconds * 1000 - now(), 0) +
      RESET_BUFFER_MS +
      Math.floor(random() * MAX_JITTER_MS)
    );
  }

  return SECONDARY_RATE_LIMIT_DELAY_MS * 2 ** retryCount;
};

class GitHubRequestQueue {
  constructor({
    client,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    getToken = () => process.env.GH_TOKEN,
    wait = sleep,
    now = Date.now,
    random = Math.random,
    logger = console,
  } = {}) {
    this.client =
      client ||
      axios.create({
        baseURL: 'https://api.github.com',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    this.minIntervalMs = minIntervalMs;
    this.maxRetries = maxRetries;
    this.getToken = getToken;
    this.wait = wait;
    this.now = now;
    this.random = random;
    this.logger = logger;
    this.lastStartedAt = null;
    this.tail = Promise.resolve();
  }

  get(url, config = {}) {
    const task = this.tail.then(() => this.execute(url, config));

    // A failed request must not permanently block later items in the queue.
    this.tail = task.catch(() => undefined);
    return task;
  }

  async waitForTurn() {
    if (this.lastStartedAt !== null) {
      const delay = Math.max(
        this.lastStartedAt + this.minIntervalMs - this.now(),
        0
      );
      if (delay > 0) {
        await this.wait(delay);
      }
    }
    this.lastStartedAt = this.now();
  }

  async execute(url, config) {
    const token = this.getToken();
    if (!token) {
      throw new Error('缺少 GH_TOKEN，无法调用 GitHub API。');
    }

    const requestConfig = {
      ...config,
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    };

    for (let retryCount = 0; ; retryCount += 1) {
      await this.waitForTurn();

      try {
        const response = await this.client.get(url, requestConfig);
        return response.data;
      } catch (error) {
        if (!isRateLimitError(error) || retryCount >= this.maxRetries) {
          throw error;
        }

        const delay = getRetryDelay(
          error,
          retryCount,
          this.now,
          this.random
        );
        this.logger.warn(
          `GitHub API 触发速率限制，${Math.ceil(delay / 1000)} 秒后重试（${
            retryCount + 1
          }/${this.maxRetries}）。`
        );
        await this.wait(delay);
      }
    }
  }
}

const request = new GitHubRequestQueue({
  minIntervalMs: readNonNegativeInteger(
    process.env.GITHUB_REQUEST_INTERVAL_MS,
    DEFAULT_MIN_INTERVAL_MS
  ),
  maxRetries: readNonNegativeInteger(
    process.env.GITHUB_MAX_RETRIES,
    DEFAULT_MAX_RETRIES
  ),
});

exports.GitHubRequestQueue = GitHubRequestQueue;
exports.getRetryDelay = getRetryDelay;
exports.isRateLimitError = isRateLimitError;
exports.request = request;
