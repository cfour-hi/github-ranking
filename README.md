# GitHub Ranking

按 Star 数生成的 GitHub 开源仓库排行榜数据集。项目每天通过 GitHub Actions 调用 GitHub Search API，生成全站总榜以及 40 种编程语言的排行榜，并将结果写入 [`ranking.json`](./ranking.json)。

## 数据入口

- 仓库内文件：[`ranking.json`](./ranking.json)
- Raw JSON：<https://raw.githubusercontent.com/cfour-hi/github-ranking/main/ranking.json>
- 语言配置：[`languages.json`](./languages.json)

例如，获取总榜前 10 名：

```bash
curl -sL https://raw.githubusercontent.com/cfour-hi/github-ranking/main/ranking.json \
  | jq '.all[:10]'
```

获取 Python 排行榜：

```bash
curl -sL https://raw.githubusercontent.com/cfour-hi/github-ranking/main/ranking.json \
  | jq '.Python'
```

## 排行规则

每次更新会分别执行以下查询：

- 总榜：公开、Star 数大于 1,000 的仓库；
- 语言榜：在总榜条件上增加指定语言；
- 排序：按 Star 数降序；
- 数量：每个榜单最多 100 个仓库。

榜单内容来自 GitHub Search API 的实时搜索结果。部分语言满足条件的仓库不足 100 个，因此对应数组可能少于 100 项。

## 数据结构

`ranking.json` 是一个以榜单名称为键的 JSON 对象：`all` 表示总榜，其余键来自 `languages.json`。

```json
{
  "all": [
    {
      "ranking": 1,
      "id": 132750724,
      "owner": {
        "login": "codecrafters-io"
      },
      "name": "build-your-own-x",
      "homepage": "https://codecrafters.io",
      "topics": ["awesome-list", "programming"],
      "description": "Master programming by recreating your favorite technologies from scratch.",
      "stargazers_count": 489050,
      "forks_count": 46103,
      "language": "Markdown"
    }
  ],
  "JavaScript": [],
  "Python": []
}
```

字段说明：

| 字段               | 类型           | 说明                                                                  |
| ------------------ | -------------- | --------------------------------------------------------------------- |
| `ranking`          | number         | 仓库在当前榜单中的名次，从 1 开始                                     |
| `id`               | number         | GitHub 仓库 ID                                                        |
| `owner.login`      | string         | 仓库所有者的 GitHub 登录名                                            |
| `name`             | string         | 仓库名称；完整地址可由 `https://github.com/{owner.login}/{name}` 组成 |
| `homepage`         | string \| null | 仓库配置的主页地址                                                    |
| `topics`           | string[]       | 仓库主题标签                                                          |
| `description`      | string \| null | 仓库简介                                                              |
| `stargazers_count` | number         | 抓取时的 Star 数                                                      |
| `forks_count`      | number         | 抓取时的 Fork 数                                                      |
| `language`         | string \| null | GitHub 识别的主要语言                                                 |

## 本地生成

### 环境要求

- Node.js 16 或更高版本；
- Yarn 1.x；
- 一个可调用 GitHub API 的访问令牌。

### 1. 安装依赖

```bash
yarn install
```

### 2. 配置令牌

在项目根目录创建 `.env`：

```dotenv
GH_TOKEN=你的_GitHub_Token
```

`.env` 已被 Git 忽略。请勿将访问令牌提交到仓库或写入公开日志。

### 3. 生成排行榜

```bash
node src/index.js
```

命令会请求总榜和全部语言榜，并覆盖项目根目录的 `ranking.json`。执行过程中需要访问 `api.github.com`；如果请求失败，请优先检查令牌是否有效以及 GitHub API 的速率限制。

## 自定义语言榜

编辑 [`languages.json`](./languages.json)，增加、删除或调整语言名称，然后重新运行生成命令：

```json
["JavaScript", "Python", "Rust"]
```

语言名称会直接传给 GitHub Search API 的 `language:` 限定符，建议使用 GitHub 可识别的规范名称。输出对象会保留 `languages.json` 中的顺序。

## 自动更新

仓库提供了两个 GitHub Actions 工作流：

- [定时更新](./.github/workflows/schedule.yml)：每天 `00:00 UTC`（北京时间 `08:00`）执行；
- [手动更新](./.github/workflows/manual.yml)：可从 GitHub Actions 页面直接手动触发。

工作流需要在仓库的 Actions secrets 中配置 `GH_TOKEN`。该令牌同时用于读取 GitHub API、检出仓库以及将更新后的 `ranking.json` 推送到 `main` 分支，因此必须具备相应的仓库写入权限。

`push.sh` 会提交工作区中的全部变更，提交信息格式为 `auto update YYYY-MM-DD`。如需在自己的仓库中启用自动更新，请先确认默认分支、令牌权限和分支保护规则与工作流配置一致。

## 项目结构

```text
.
├── .github/workflows/   # 定时与手动更新工作流
├── src/
│   ├── index.js         # 排行榜抓取与文件生成入口
│   └── utils/request.js # GitHub API 客户端及鉴权配置
├── languages.json       # 需要生成排行榜的语言列表
├── ranking.json         # 生成后的排行榜数据
└── push.sh              # 自动提交并推送数据更新
```

## 使用说明与限制

- 排名是某次抓取时的快照，Star、Fork、描述等字段会随 GitHub 上的仓库状态变化；
- 数据源只包含公开且 Star 数大于 1,000 的仓库，不代表项目质量、安全性或维护活跃度；
- GitHub Search API 的搜索结果、语言识别和索引更新可能存在延迟；
- 消费 Raw JSON 的应用应设置合理缓存和失败回退，避免把 GitHub 或 Raw 内容服务的短暂不可用传递给终端用户；
- 仓库重命名、转移或删除后，旧快照中的 `owner.login`、`name` 等信息可能暂时失效。

## License

项目的 `package.json` 将许可证声明为 MIT。仓库目前未包含独立的许可证正文文件；再分发或用于正式项目之前，请向维护者确认许可条款。
