# PPT 分屏讲解学习助手 Design

## 目标

构建一个面向单人学习场景的 MVP：支持上传 PDF/PPT/图片资料，自动生成逐页内容，在分屏界面中按页讲解并支持追问，最后把讲解导出为 Markdown 笔记。

## 范围

### In Scope (MVP)
- 文档上传与存储
- PDF/PPT/图片的页级切分（PPT 在 MVP 中先降级为静态图片渲染占位）
- 页列表与缩略图读取 API
- 绑定当前页的讲解与问答 API
- Markdown 笔记导出 API
- 前端分屏阅读 + AI 面板（讲解/问答/笔记）

### Out of Scope (后续迭代)
- 区域级框选解释
- 真正的异步队列系统（Celery/RQ）
- 向量检索与跨页 RAG
- 小测自动判分与复习计划

## 架构

- `frontend/`：Next.js + React + Tailwind，负责分屏交互和会话 UI。
- `backend/`：FastAPI，负责文档、页、会话、消息、笔记接口。
- `backend/app/services/`：切页渲染、讲解生成、笔记导出。
- `storage/`（本地目录）：原始文件与页图像。
- SQLite（开发态）作为持久化，schema 与 Postgres 兼容。

## 数据流

1. 上传文档后落盘并创建 `documents`。
2. 触发预处理：渲染页图，并写入 `slides` 与 `slide_extracts`。
3. 前端翻页时请求当前页讲解。
4. 聊天接口读取 `slide_extracts` + 对话上下文生成回答。
5. 导出笔记时聚合每页讲解，生成 Markdown。

## 错误处理

- 上传类型不支持返回 400。
- 文档未解析完成返回 409。
- 会话或页不存在返回 404。
- 模型不可用时降级为模板讲解并返回 `degraded=true`。

## 测试策略

- 后端 API：pytest + httpx（上传、切页、问答、导出）。
- 服务层：讲解引擎模板输出稳定性测试。
- 前端：先保证构建和基本交互，下一阶段补组件测试。

## 交付标准

- 本地 `docker compose up` 后可完成完整 MVP 学习流程。
- `pytest` 通过。
- README 提供运行和 API 说明。
