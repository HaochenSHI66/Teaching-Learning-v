<div align="center">

# 📖 幻灯片研习台

### AI 驱动的 PPT 分屏学习助手，上传 PDF/PPT 自动生成结构化讲解

[**在线体验 →**](https://learn.shc66.com)

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python)](https://python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<!-- 截图占位：主界面 — 左侧 PPT 页面 + 右侧 AI 结构化讲解卡片 -->
<!-- ![主界面截图](docs/screenshots/main.png) -->

</div>

---

## 🤔 为什么做这个？

上课看 PPT 看不懂，课后复习没有讲解，翻教材效率低——这是很多学生的痛点。

**幻灯片研习台**让你上传课件，AI 自动逐页生成结构化讲解，像有个私人助教随时帮你拆解每一页 PPT。

---

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 📤 **PDF/PPT 上传** | 拖拽上传，自动渲染为高清页面 |
| 🤖 **AI 结构化讲解** | 双模型管线（视觉 + 文本），每页 4-8 个知识点，卡片式渲染 |
| 🔗 **概念知识图谱** | LLM 自动提取学科概念，可视化概念关系网络 |
| 💬 **追问对话** | 基于当前页上下文的自由追问 |
| 🔍 **框选讲解** | 框选 PPT 区域，AI 重点解释选中内容 |
| 🃏 **闪卡复习** | 自动生成复习卡片，巩固核心知识 |
| 📝 **笔记导出** | 导出 HTML/PDF 格式学习笔记 |
| 📁 **文档管理** | 文件夹分类、拖拽排序、书签标记 |
| 🛡️ **管理后台** | 用户管理、使用统计、系统监控 |
| 👥 **多用户** | JWT 认证，用户数据隔离 |
| 🌓 **主题切换** | 暗色 / 亮色主题，自动或手动 |
| 🌐 **公网部署** | Cloudflare Tunnel 一键穿透到公网 |

### 讲解亮点

- 术语**中英对照**（**中文 (English)**）
- 重点高亮 + Callout 提示框（重点 / 提示 / 注意 / 说明）
- KaTeX 数学公式渲染
- 代码块语法高亮

---

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 15 · React 19 · TypeScript · Tailwind CSS |
| 后端 | FastAPI · SQLModel · SQLite (WAL) |
| AI | 通义千问 — qwen3-vl-flash (视觉) + qwen-plus-latest (文本) |
| 部署 | Cloudflare Tunnel (内网穿透) |
| 桌面 | Electron (macOS) |

---

## 📂 项目结构

```
Teaching-Learning-/
├── backend/                # FastAPI 后端
│   ├── app/
│   │   ├── api/            # API 路由 (documents, chat, admin, auth...)
│   │   ├── services/       # 核心服务 (explanation_engine, dual_pipeline, json_renderer...)
│   │   └── models.py       # 数据模型
│   └── storage/            # 数据库 + 上传文件
├── frontend/               # Next.js 前端
│   ├── app/                # 页面 (主页, 登录, 管理后台)
│   ├── components/         # React 组件 (StructuredContent, AIPanel, SlideViewer...)
│   ├── hooks/              # 自定义 Hooks
│   └── lib/                # API 客户端, 工具函数
├── desktop/                # Electron 桌面应用
├── scripts/                # 运维脚本 (serve.sh, backup-db.sh...)
└── docs/                   # 设计文档
```

---

## 🚀 快速开始

### 前置要求

- Python 3.11+、Node.js 18+、[uv](https://docs.astral.sh/uv/)
- 通义千问 API Key（[申请地址](https://dashscope.console.aliyun.com/)）

### 1. 克隆项目

```bash
git clone https://github.com/Steven668866/Teaching-Learning-.git
cd Teaching-Learning-
```

### 2. 后端

```bash
cd backend
uv sync
cp .env.example .env
# 编辑 .env，填入通义千问 API Key
```

### 3. 前端

```bash
cd frontend
npm install
```

### 4. 启动

```bash
# 本地模式（localhost:3000，无需登录）
./scripts/serve.sh local

# 公网模式（Cloudflare Tunnel，需登录）
./scripts/serve.sh public
```

访问 http://localhost:3000 即可使用。

---

## 🌐 部署

| 模式 | 命令 | 说明 |
|------|------|------|
| 本地 | `./scripts/serve.sh local` | localhost:3000，无需登录 |
| 公网 | `./scripts/serve.sh public` | Cloudflare Tunnel 穿透，需登录认证 |

公网模式需要：
- Cloudflare 账号 + 域名
- 配置 Tunnel token（参见 [Cloudflare Tunnel 文档](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)）

---

## 🖼️ 界面预览

<!-- 在此放置截图或 GIF -->
<!-- ![主界面](docs/screenshots/main.png) -->
<!-- ![AI 讲解面板](docs/screenshots/explanation.png) -->
<!-- ![知识图谱](docs/screenshots/knowledge-graph.png) -->
<!-- ![暗色主题](docs/screenshots/dark-theme.png) -->

> 截图待补充。主界面为左右分屏布局：左侧 PPT 页面浏览，右侧 AI 结构化讲解卡片。

---

## 🗺️ 路线图

- [x] PDF/PPT 上传与渲染
- [x] 双模型管线结构化讲解
- [x] 概念知识图谱
- [x] 框选讲解
- [x] 闪卡复习
- [x] 笔记导出
- [x] 管理后台
- [x] Cloudflare Tunnel 公网部署
- [ ] 移动端适配
- [ ] 更多 AI 模型支持
- [ ] 协作学习功能

---

## 🤝 参与贡献

欢迎提 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -m 'feat: 添加 xxx 功能'`)
4. 推送到分支 (`git push origin feature/xxx`)
5. 创建 Pull Request

---

## 📄 许可证

[MIT License](LICENSE)

---

<div align="center">

**如果觉得有用，请给个 ⭐ Star！**

</div>
