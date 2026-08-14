require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { request } = require('./utils/request');
const languages = require('../languages.json');

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

const getAllRanking = () =>
  request.get('https://api.github.com/search/repositories', {
    label: '总榜',
    params: {
      q: `is:public stars:>1000`,
      sort: 'stars',
      per_page: 100,
    },
  });

const run = async () => {
  const startedAt = Date.now();
  console.log(`开始更新排行榜：总榜 + ${languages.length} 个语言榜。`);

  const languageMap = {};
  languageMap.all = (await getAllRanking()).items.map(toRepositoryObj);
  console.log(`榜单进度 1/${languages.length + 1}：总榜（${languageMap.all.length} 项）`);

  const parallelRequests = [];
  for (let i = 0; i < languages.length; i += 1) {
    const language = languages[i];
    parallelRequests.push(
      request.get('https://api.github.com/search/repositories', {
        label: `语言榜 ${language}`,
        params: {
          q: `is:public stars:>1000 language:${language}`,
          sort: 'stars',
          per_page: 100,
        },
      }).then((response) => {
        console.log(
          `榜单进度 ${i + 2}/${languages.length + 1}：${language}（${
            response.items.length
          } 项）`
        );
        return response;
      })
    );
  }

  const repositories = await Promise.all(parallelRequests);
  for (let i = 0; i < repositories.length; i += 1) {
    languageMap[languages[i]] = repositories[i].items.map(toRepositoryObj);
  }
  console.log('全部远程数据获取完成。');

  const filepath = path.resolve(process.cwd(), 'ranking.json');
  await fs.promises.writeFile(filepath, JSON.stringify(languageMap), 'utf-8');
  console.log(
    `排行榜已写入 ${filepath}，总耗时 ${Math.round(
      (Date.now() - startedAt) / 1000
    )} 秒。`
  );
};

run().catch((error) => {
  console.error(`排行榜更新失败：${error.message}`);
  process.exitCode = 1;
});
