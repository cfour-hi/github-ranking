const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { request } = require('./utils/request');
const languages = require('../languages.json');
const { generateRanking } = require('./ranking');

generateRanking({ request, languages }).catch((error) => {
  request.abort(error);
  console.error(`排行榜更新失败：${error.message}`);
  process.exitCode = 1;
});
