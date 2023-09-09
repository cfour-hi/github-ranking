const fs = require('fs');
const path = require('path');
const { request } = require('./utils/request');
const languages = require('../languages.json');

const toRepositoryObj = (repo) => ({
  id: repo.id,
  owner: repo.owner.login,
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
    params: {
      q: `is:public stars:>1000`,
      sort: 'stars',
      per_page: 100,
    },
  });

const run = async () => {
  console.log('执行中...');

  const languageMap = {};
  languageMap.all = (await getAllRanking()).items.map(toRepositoryObj);
  console.log('完成：全部排行榜');

  const parallelRequests = [];
  for (let i = 0; i < languages.length; i += 1) {
    const language = languages[i];
    parallelRequests.push(
      request.get('https://api.github.com/search/repositories', {
        params: {
          q: `is:public stars:>1000 language:${language}`,
          sort: 'stars',
          per_page: 100,
        },
      })
    );
  }

  const repositories = await Promise.all(parallelRequests);
  for (let i = 0; i < repositories.length; i += 1) {
    languageMap[languages[i]] = repositories[i].items.map(toRepositoryObj);
  }
  console.log('完成：语言类排行榜');

  const filepath = path.resolve(
    process.cwd(),
    `data/${new Date().toISOString().split('T')[0]}.json`
  );

  fs.writeFile(filepath, JSON.stringify(languageMap), 'utf-8', (err) => {
    if (err) {
      console.error('写入文件时出错：', err);
      return;
    }
    console.log('JSON 对象已成功写入文件！');
  });
};

run();
