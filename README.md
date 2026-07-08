# 职场吵架模拟器 · 网页版

## 项目结构

```
workplace-simulator-web/
├── index.html          # 前端单文件（首页 + Battle + 结果页）
├── api/
│   └── chat.js         # Vercel Serverless Function - DeepSeek API 代理
├── vercel.json         # Vercel 路由配置
└── README.md           # 本文件
```

## 本地开发

```bash
# 1. 进入项目目录
cd workplace-simulator-web

# 2. 安装 Vercel CLI（如果还没装）
npm i -g vercel

# 3. 本地启动（会自动启动前端+后端）
vercel dev

# 4. 浏览器打开 http://localhost:3000
```

## 部署到 Vercel

### 方式一：Vercel CLI（推荐）

```bash
# 1. 登录 Vercel（首次需要）
vercel login

# 2. 部署
vercel --prod

# 3. 配置环境变量（在 Vercel Dashboard 或命令行）
vercel env add DEEPSEEK_API_KEY
# 然后输入你的 DeepSeek API Key

# 4. 重新部署使环境变量生效
vercel --prod
```

### 方式二：GitHub + Vercel Dashboard

1. 把代码 push 到 GitHub 仓库
2. 在 [Vercel Dashboard](https://vercel.com/dashboard) 点击 "Add New Project"
3. 选择你的 GitHub 仓库，一键导入
4. 在 Project Settings → Environment Variables 中添加 `DEEPSEEK_API_KEY`
5. 重新 Deploy

## 环境变量

| 变量名 | 说明 | 获取方式 |
|:---|:---|:---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | [DeepSeek 开放平台](https://platform.deepseek.com/) |

## 技术栈

- 前端：原生 HTML/CSS/JS（单文件，零依赖）
- 后端：Vercel Serverless Function（Node.js）
- AI：DeepSeek API（JSON Mode）
