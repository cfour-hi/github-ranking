const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  buildQuery,
  fetchRanking,
  generateRanking,
  toRepositoryObj,
  writeRanking,
} = require('../src/ranking');

const createRepo = (overrides = {}) => ({
  id: 1,
  owner: { login: 'octocat' },
  name: 'hello-world',
  homepage: null,
  topics: ['demo'],
  description: '示例仓库',
  stargazers_count: 2000,
  forks_count: 10,
  language: 'JavaScript',
  ...overrides,
});

const createTempDir = () =>
  fs.promises.mkdtemp(path.join(os.tmpdir(), 'github-ranking-'));

const removeTempDir = (dir) =>
  fs.promises.rm(dir, { recursive: true, force: true });

test('builds search queries with an optional quoted language', () => {
  assert.equal(buildQuery(), 'is:public stars:>1000');
  assert.equal(
    buildQuery('JavaScript'),
    'is:public stars:>1000 language:"JavaScript"'
  );
  assert.equal(
    buildQuery('Jupyter Notebook'),
    'is:public stars:>1000 language:"Jupyter Notebook"'
  );
});

test('maps a repository to a ranking entry with its position', () => {
  const objects = [createRepo(), createRepo({ id: 2, name: 'second' })].map(
    toRepositoryObj
  );

  assert.deepEqual(objects[0], {
    ranking: 1,
    id: 1,
    owner: { login: 'octocat' },
    name: 'hello-world',
    homepage: null,
    topics: ['demo'],
    description: '示例仓库',
    stargazers_count: 2000,
    forks_count: 10,
    language: 'JavaScript',
  });
  assert.equal(objects[1].ranking, 2);
});

test('requests the search API with the expected parameters', async () => {
  const calls = [];
  const request = {
    get: async (url, config) => {
      calls.push({ url, config });
      return { incomplete_results: false, items: [createRepo()] };
    },
  };

  const items = await fetchRanking(request, {
    label: '语言榜 Rust',
    language: 'Rust',
  });

  assert.equal(items.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/search/repositories');
  assert.deepEqual(calls[0].config.params, {
    q: 'is:public stars:>1000 language:"Rust"',
    sort: 'stars',
    per_page: 100,
  });
});

test('rejects incomplete search results instead of returning truncated data', async () => {
  const request = {
    get: async () => ({ incomplete_results: true, items: [createRepo()] }),
  };

  await assert.rejects(
    fetchRanking(request, { label: '语言榜 Python', language: 'Python' }),
    /Python.*不完整/
  );
});

test('keeps the previous ranking file when a search result is incomplete', async () => {
  const dir = await createTempDir();

  try {
    const filepath = path.join(dir, 'ranking.json');
    const previous = { all: [createRepo({ id: 9 })] };
    await fs.promises.writeFile(
      filepath,
      `${JSON.stringify(previous)}\n`,
      'utf-8'
    );

    const request = {
      get: async (_url, config) => ({
        incomplete_results: config.label === '语言榜 Rust',
        items: [createRepo()],
      }),
    };

    await assert.rejects(
      generateRanking({
        request,
        languages: ['Python', 'Rust'],
        filepath,
        logger: { log: () => undefined },
        now: () => 0,
      }),
      /Rust.*不完整/
    );

    assert.deepEqual(
      JSON.parse(await fs.promises.readFile(filepath, 'utf-8')),
      previous
    );
  } finally {
    await removeTempDir(dir);
  }
});

test('writes ranking.json atomically with a trailing newline', async () => {
  const dir = await createTempDir();

  try {
    const filepath = path.join(dir, 'ranking.json');
    await fs.promises.writeFile(filepath, 'stale', 'utf-8');
    const ranking = { all: [createRepo()] };

    await writeRanking(ranking, filepath);

    assert.equal(
      await fs.promises.readFile(filepath, 'utf-8'),
      `${JSON.stringify(ranking)}\n`
    );
    assert.deepEqual(await fs.promises.readdir(dir), ['ranking.json']);
  } finally {
    await removeTempDir(dir);
  }
});

test('generates every ranking in language order and writes the file', async () => {
  const dir = await createTempDir();

  try {
    const calls = [];
    const logs = [];
    const request = {
      get: async (_url, config) => {
        calls.push(config.params.q);
        return { incomplete_results: false, items: [createRepo()] };
      },
    };
    const filepath = path.join(dir, 'ranking.json');
    const logger = {
      log: (message) => logs.push(message),
      warn: () => undefined,
    };

    const ranking = await generateRanking({
      request,
      languages: ['Python', 'Rust'],
      filepath,
      logger,
      now: () => 0,
    });

    assert.deepEqual(Object.keys(ranking), ['all', 'Python', 'Rust']);
    assert.deepEqual(calls, [
      'is:public stars:>1000',
      'is:public stars:>1000 language:"Python"',
      'is:public stars:>1000 language:"Rust"',
    ]);
    assert.equal(ranking.all[0].ranking, 1);
    assert.deepEqual(
      JSON.parse(await fs.promises.readFile(filepath, 'utf-8')),
      ranking
    );
    assert.ok(logs.some((message) => message.includes('总榜')));
  } finally {
    await removeTempDir(dir);
  }
});

test('rejects invalid arguments', async () => {
  await assert.rejects(generateRanking({ languages: 'Rust' }), TypeError);
  await assert.rejects(
    generateRanking({ request: {}, languages: [] }),
    TypeError
  );
});
