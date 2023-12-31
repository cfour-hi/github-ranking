const axios = require('axios');

const request = axios.create({
  baseURL: 'https://api.github.com',
});

request.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  return config;
});

request.interceptors.response.use(
  (res) => res.data,
  (err) => Promise.reject(err)
);

exports.request = request;
