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

const formatRateLimit = (headers = {}) => {
  const remaining = headers['x-ratelimit-remaining'];
  const limit = headers['x-ratelimit-limit'];
  const resource = headers['x-ratelimit-resource'];

  if (remaining === undefined || limit === undefined) {
    return '';
  }

  return `，额度 ${remaining}/${limit}${resource ? `（${resource}）` : ''}`;
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
    this.requestCount = 0;
  }

  get(url, config = {}) {
    const requestId = (this.requestCount += 1);
    const task = this.tail.then(() => this.execute(requestId, url, config));

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

  log(level, message) {
    const writer = this.logger[level] || this.logger.log;
    if (typeof writer === 'function') {
      writer.call(this.logger, message);
    }
  }

  async execute(requestId, url, config) {
    const token = this.getToken();
    if (!token) {
      throw new Error('缺少 GH_TOKEN，无法调用 GitHub API。');
    }

    const { label = url, ...axiosConfig } = config;
    const requestConfig = {
      ...axiosConfig,
      headers: {
        ...(axiosConfig.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    };

    for (let retryCount = 0; ; retryCount += 1) {
      await this.waitForTurn();
      const startedAt = this.now();
      this.log(
        'info',
        `[GitHub API] 开始 #${requestId} ${label}（尝试 ${retryCount + 1}）`
      );

      try {
        const response = await this.client.get(url, requestConfig);
        this.log(
          'info',
          `[GitHub API] 完成 #${requestId} ${label}，耗时 ${
            this.now() - startedAt
          }ms${formatRateLimit(response.headers)}`
        );
        return response.data;
      } catch (error) {
        if (!isRateLimitError(error) || retryCount >= this.maxRetries) {
          const status = error.response && error.response.status;
          this.log(
            'error',
            `[GitHub API] 失败 #${requestId} ${label}${
              status ? `，HTTP ${status}` : ''
            }：${error.message}`
          );
          throw error;
        }

        const delay = getRetryDelay(
          error,
          retryCount,
          this.now,
          this.random
        );
        this.log(
          'warn',
          `[GitHub API] #${requestId} ${label} 触发速率限制，${Math.ceil(
            delay / 1000
          )} 秒后重试（${
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
exports.formatRateLimit = formatRateLimit;
exports.getRetryDelay = getRetryDelay;
exports.isRateLimitError = isRateLimitError;
exports.request = request;
