# GitHub Ranking

按 Star 数生成的 GitHub 开源仓库排行榜数据集。项目每天通过 GitHub Actions 调用 GitHub Search API，生成全站总榜以及 27 个编程语言/技术栈排行榜，并写入 [`ranking.json`](./ranking.json)。

[![Update ranking](https://github.com/cfour-hi/github-ranking/actions/workflows/update.yml/badge.svg)](https://github.com/cfour-hi/github-ranking/actions/workflows/update.yml)
[![Test](https://github.com/cfour-hi/github-ranking/actions/workflows/test.yml/badge.svg)](https://github.com/cfour-hi/github-ranking/actions/workflows/test.yml)
![ranking.json updated](https://img.shields.io/github/last-commit/cfour-hi/github-ranking/main?path=ranking.json&label=ranking.json)

## 目录

- [快速开始](#快速开始)
- [排行规则](#排行规则)
- [数据结构](#数据结构)
- [数据更新机制](#数据更新机制)
- [本地开发](#本地开发)
- [自定义语言榜](#自定义语言榜)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [使用说明与限制](#使用说明与限制)

## 快速开始

- 仓库内文件：[`ranking.json`](./ranking.json)
- Raw JSON：<https://raw.githubusercontent.com/cfour-hi/github-ranking/main/ranking.json>
- 语言配置：[`languages.json`](./languages.json)

`ranking.json` 是单行 JSON（约 1.3 MB），以榜单名称为键：`all` 表示总榜，其余键对应 `languages.json` 中的语言。

### 获取总榜前 10 名

```bash
curl -sL https://raw.githubusercontent.com/cfour-hi/github-ranking/main/ranking.json \
  | jq '.all[:10]'
```

### 获取某个语言榜

```bash
curl -sL https://raw.githubusercontent.com/cfour-hi/github-ranking/main/ranking.json \
  | jq '.Python'
```

### 整理成简短列表

```bash
curl -sL https://raw.githubusercontent.com/cfour-hi/github-ranking/main/ranking.json \
  | jq -r '.Go[:5][] | "\(.ranking). \(.owner.login)/\(.name) ⭐ \(.stargazers_count)"'
```

### Python 示例

```python
import json
import urllib.request

url = "https://raw.githubusercontent.com/cfour-hi/github-ranking/main/ranking.json"
with urllib.request.urlopen(url, timeout=30) as response:
    data = json.load(response)

for repo in data["Rust"][:5]:
    print(
        repo["ranking"],
        f'{repo["owner"]["login"]}/{repo["name"]}',
        repo["stargazers_count"],
    )
```

## 排行规则

每次更新会分别执行以下查询（1 次总榜 + 27 次语言榜，共 28 次搜索请求）：

- 总榜：公开、Star 数大于 1,000 的仓库；
- 语言榜：在总榜条件上增加指定语言（`language:"<名称>"`）；
- 排序：按 Star 数降序；
- 数量：每个榜单最多 100 个仓库。

当前包含 27 个语言/技术栈（以 [`languages.json`](./languages.json) 为准）：JavaScript、HTML、CSS、Python、TypeScript、Shell、Java、C#、C++、C、PHP、PowerShell、Go、Rust、Kotlin、Ruby、Lua、Dart、Swift、Scala、Elixir、Objective-C、Haskell、Clojure、SCSS、Vue、TeX。

为保证榜单完整性，满足条件仓库不足 100 项的冷门语言已从配置中移除（按 2026-11 的抓取数据）。若后续某语言数量跌破 100，其数组会短于 100 项，可再次精简配置；需要更多语言时重新加回 `languages.json` 即可。

## 数据结构

`ranking.json` 是以榜单名称为键的 JSON 对象：`all` 为总榜，其余键来自 `languages.json`，键的顺序为 `all` 在前、随后按配置顺序排列。

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
      "topics": [
        "awesome-list",
        "free",
        "programming",
        "tutorial-code",
        "tutorial-exercises",
        "tutorials"
      ],
      "description": "Master programming by recreating your favorite technologies from scratch.",
      "stargazers_count": 561919,
      "forks_count": 52584,
      "language": "Markdown"
    }
  ],
  "JavaScript": [],
  "Python": []
}
```

> 示例为某次抓取快照，Star、Fork、描述等数值会随更新变化，仅用于说明字段结构。

字段说明：

| 字段               | 类型           | 说明                                                                  |
| ------------------ | -------------- | --------------------------------------------------------------------- |
| `ranking`          | number         | 仓库在当前榜单中的名次，从 1 开始                                     |
| `id`               | number         | GitHub 仓库 ID                                                        |
| `owner.login`      | string         | 仓库所有者的 GitHub 登录名                                            |
| `name`             | string         | 仓库名称；完整地址可由 `https://github.com/{owner.login}/{name}` 组成 |
| `homepage`         | string \| null | 仓库配置的主页地址（可能为空字符串）                                  |
| `topics`           | string[]       | 仓库主题标签（可能为空数组）                                          |
| `description`      | string \| null | 仓库简介                                                              |
| `stargazers_count` | number         | 抓取时的 Star 数                                                      |
| `forks_count`      | number         | 抓取时的 Fork 数                                                      |
| `language`         | string \| null | GitHub 识别的主要语言                                                 |

其他约定：

- 每个数组按 `stargazers_count` 降序排列，`ranking` 即数组下标 + 1；
- 榜单内的 `language` 为 GitHub 返回值，可能与榜单键大小写不同或为 `null`；
- 配置变化后，在下一次成功更新之前，`ranking.json` 中可能仍保留旧的榜单键。

## 数据更新机制

数据由 [`.github/workflows/update.yml`](./.github/workflows/update.yml) 更新，支持两种触发方式：

- 定时触发：每天 `00:00 UTC`（北京时间 `08:00`）执行（GitHub Actions 可能有几分钟调度延迟）；
- 手动触发：在 GitHub Actions 页面选择该工作流后点击 `Run workflow`（`workflow_dispatch`）。

每次运行依次执行：安装依赖（`pnpm install --frozen-lockfile`）→ 运行测试 → 抓取排行榜 → 通过 [`push.sh`](./push.sh) 提交并推送 `ranking.json`。

失败与安全策略：

- GitHub 搜索索引超时会返回 `incomplete_results`；此时本次更新整体失败，**不写入、不提交**，仓库保留上一版 `ranking.json`；
- 请求按 2.1 秒间隔串行执行并自动重试速率限制错误，任一请求最终失败会取消队列中尚未发送的请求；
- `ranking.json` 通过临时文件 + rename 原子写入，中断不会产生截断文件；
- `push.sh` 只提交 `ranking.json`，无变化时跳过；提交信息为 `auto update YYYY-MM-DD`，提交身份为 `github-actions[bot]`；
- Actions 均固定到完整 commit SHA，依赖与 Actions 的更新由 [Dependabot](./.github/dependabot.yml) 每周检查（`packageManager` 中的 pnpm 版本需手动升级）。

工作流需要在仓库的 Actions secrets 中配置 `GH_TOKEN`。该令牌同时用于读取 GitHub API、检出仓库以及推送更新，因此必须具备相应仓库的写入权限。若在自己的仓库中启用，请先确认默认分支、令牌权限与分支保护规则一致。

## 本地开发

### 环境要求

- Node.js 22 或更高版本（CI 使用 Node.js 24）；
- pnpm 12（版本由 `package.json` 的 `packageManager` 字段固定；可用 `npm install -g pnpm@12.18.0` 安装，若 Node 内置 Corepack 也可用 `corepack enable pnpm`）；
- 一个可调用 GitHub Search API 的访问令牌。

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置令牌

在项目根目录创建 `.env`：

```dotenv
GH_TOKEN=你的_GitHub_Token
```

`.env`（以及 `.env.*`）已被 Git 忽略，请勿将令牌提交到仓库或写入公开日志。GitHub Actions 中无需 `.env`，直接通过仓库 secret 提供 `GH_TOKEN` 即可。

### 3. 生成排行榜

```bash
pnpm start
```

等价于 `node src/index.js`。无论从哪个目录执行，都会覆盖项目根目录的 `ranking.json`。执行过程需要访问 `api.github.com`；请求失败时优先检查令牌是否有效、GitHub 速率限制是否耗尽。

### 4. 运行测试

```bash
pnpm test
```

使用 Node.js 内置 test runner，不访问网络，覆盖请求排队与取消、速率限制重试、环境变量解析、查询构造、字段映射、原子写文件与失败保留旧数据等行为。GitHub Actions 会在代码相关改动（`push`/`pull_request`，见 [`.github/workflows/test.yml`](./.github/workflows/test.yml)）以及每次数据更新前自动运行测试。

### 5. 格式化代码

```bash
pnpm format        # 写入格式
pnpm format:check  # 仅校验（CI 使用）
```

Prettier 版本固定在 `package.json` 中，`ranking.json` 与锁文件不会被格式化。

### 环境变量

除 `GH_TOKEN` 外，[`src/utils/request.js`](./src/utils/request.js) 还会读取以下可选变量，用于调整请求节奏：

| 变量                         | 默认值 | 说明                                       |
| ---------------------------- | ------ | ------------------------------------------ |
| `GITHUB_REQUEST_INTERVAL_MS` | `2100` | 两次 GitHub API 请求之间的最小间隔（毫秒） |
| `GITHUB_MAX_RETRIES`         | `3`    | 命中 GitHub 速率限制时的最大重试次数       |

GitHub Search API 对认证用户的限制约为每分钟 30 次，因此默认按 2.1 秒间隔串行请求。

## 自定义语言榜

编辑 [`languages.json`](./languages.json)，增加、删除或调整语言名称，然后重新运行 `pnpm start`：

```json
["JavaScript", "Python", "Rust"]
```

语言名称会以 `language:"<名称>"` 的形式传给 GitHub Search API 的 `language:` 限定符，建议使用 GitHub 可识别的规范名称；输出对象的键顺序与 `languages.json` 一致。

## 项目结构

```text
.
├── .github/
│   ├── dependabot.yml           # Actions 与 pnpm 依赖自动更新
│   └── workflows/
│       ├── test.yml             # 代码改动时运行格式检查与测试
│       └── update.yml           # 定时与手动更新工作流
├── .editorconfig                # 编辑器基础配置
├── .gitignore                   # 忽略 node_modules、.env 与临时文件
├── .prettierignore              # 格式化时忽略数据与锁文件
├── .prettierrc                  # Prettier 配置
├── .vscode/
│   └── settings.json            # 保存时使用 Prettier 格式化
├── src/
│   ├── index.js                 # 入口：加载环境变量并触发生成
│   ├── ranking.js               # 查询构造、字段映射与写文件
│   └── utils/request.js         # GitHub API 客户端、限速、重试与取消
├── test/
│   ├── ranking.test.js          # 排行榜生成逻辑测试
│   └── request.test.js          # 请求模块测试
├── languages.json               # 需要生成排行榜的语言列表
├── ranking.json                 # 生成后的排行榜数据
├── push.sh                      # 提交并推送数据更新
├── package.json                 # 依赖与 scripts
└── pnpm-lock.yaml               # 锁定的依赖版本
```

## 常见问题

**数据多久更新一次？**

每天一次（`00:00 UTC`，北京时间 `08:00` 左右），GitHub Actions 调度可能有几分钟延迟。需要立即刷新时可在 Actions 页面手动触发工作流。

**为什么某个语言不在榜单里？**

满足 `is:public stars:>1000` 的仓库不足 100 项的语言被移除以保证榜单完整性。如果希望恢复，只需把它加回 [`languages.json`](./languages.json)。

**某天数据没有更新怎么办？**

打开 Actions 页面查看 `Update ranking` 运行记录：令牌失效、速率限制或搜索结果不完整都会导致本次更新失败，仓库会保留上一版数据。修复后在 Actions 页面重新运行即可。

**能否只更新某个语言？**

可以：编辑 `languages.json` 只保留需要的语言，然后本地执行 `pnpm start`。注意自动更新使用仓库中的配置。

**数据包含私有仓库吗？**

不包含。查询限定 `is:public`，只覆盖公开仓库。

## 使用说明与限制

- 排名是某次抓取时的快照，Star、Fork、描述等字段会随仓库状态变化；
- 数据源只包含公开且 Star 数大于 1,000 的仓库，不代表项目质量、安全性或维护活跃度；
- GitHub Search API 的搜索结果、语言识别与索引更新可能存在延迟；
- `ranking.json` 为单行 JSON，适合程序读取但不便于直接阅读或查看 git diff，比较数据时建议用 `jq` 或脚本处理；
- 消费 Raw JSON 的应用应设置合理缓存与失败回退，避免把 GitHub 或 Raw 内容服务的短暂不可用传递给终端用户；
- 仓库重命名、转移或删除后，旧快照中的 `owner.login`、`name` 等信息可能暂时失效；
- 榜单内的 `language` 字段使用 GitHub 返回的语言名称，可能与榜单键不完全一致（可能存在大小写差异或为 `null`），按该字段过滤时需注意；
- Star 数相同的仓库，其先后顺序由 GitHub 搜索结果决定，因此 `ranking` 名次可能在两次更新之间发生变化。
