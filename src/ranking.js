const fs = require('fs');
const path = require('path');

const SEARCH_URL = 'https://api.github.com/search/repositories';
const STARS_THRESHOLD = 1000;
const PER_PAGE = 100;
const RANKING_FILE = path.resolve(__dirname, '..', 'ranking.json');

const buildQuery = (language) => {
  const qualifiers = ['is:public', `stars:>${STARS_THRESHOLD}`];
  if (language) {
    // Quote multi-word language names (e.g. "Jupyter Notebook"); otherwise
    // GitHub parses the extra words as separate search terms.
    qualifiers.push(`language:"${language}"`);
  }
  return qualifiers.join(' ');
};

const toRepositoryObj = (repo, index) => ({
  ranking: index + 1,
  id: repo.id,
  owner: {
    login: repo.owner.login,
  },
  name: repo.name,
  homepage: repo.homepage,
  topics: repo.topics,
  description: repo.description,
  stargazers_count: repo.stargazers_count,
  forks_count: repo.forks_count,
  language: repo.language,
});

const fetchRanking = async (request, { label, language }) => {
  const response = await request.get(SEARCH_URL, {
    label,
    params: {
      q: buildQuery(language),
      sort: 'stars',
      per_page: PER_PAGE,
    },
  });

  // GitHub sets incomplete_results when the search index times out. Publishing
  // such a response would replace a complete ranking with a truncated one, so
  // the whole update fails and the previous ranking.json is kept.
  if (response.incomplete_results) {
    throw new Error(
      `${label} 的搜索结果不完整（GitHub 索引超时），已中止本次更新以保留上一版 ranking.json。`
    );
  }

  return response.items.map(toRepositoryObj);
};

const writeRanking = async (ranking, filepath = RANKING_FILE) => {
  // Write to a temporary file first so an interrupted run never leaves a
  // truncated ranking.json behind.
  const tempFile = `${filepath}.tmp`;
  await fs.promises.writeFile(
    tempFile,
    `${JSON.stringify(ranking)}\n`,
    'utf-8'
  );
  await fs.promises.rename(tempFile, filepath);
};

const generateRanking = async ({
  request,
  languages,
  filepath = RANKING_FILE,
  logger = console,
  now = Date.now,
} = {}) => {
  if (!request || typeof request.get !== 'function') {
    throw new TypeError('request 必须提供 get 方法。');
  }

  if (!Array.isArray(languages)) {
    throw new TypeError('languages 必须是数组。');
  }

  const startedAt = now();
  const totalRankings = languages.length + 1;
  logger.log(`开始更新排行榜：总榜 + ${languages.length} 个语言榜。`);

  const ranking = {};
  ranking.all = await fetchRanking(request, { label: '总榜' });
  logger.log(`榜单进度 1/${totalRankings}：总榜（${ranking.all.length} 项）`);

  const pendingRankings = languages.map((language, index) =>
    fetchRanking(request, {
      label: `语言榜 ${language}`,
      language,
    }).then((items) => {
      logger.log(
        `榜单进度 ${index + 2}/${totalRankings}：${language}（${
          items.length
        } 项）`
      );
      return items;
    })
  );

  const rankings = await Promise.all(pendingRankings);
  languages.forEach((language, index) => {
    ranking[language] = rankings[index];
  });
  logger.log('全部远程数据获取完成。');

  await writeRanking(ranking, filepath);
  logger.log(
    `排行榜已写入 ${filepath}，总耗时 ${Math.round(
      (now() - startedAt) / 1000
    )} 秒。`
  );

  return ranking;
};

module.exports = {
  buildQuery,
  fetchRanking,
  generateRanking,
  toRepositoryObj,
  writeRanking,
};
