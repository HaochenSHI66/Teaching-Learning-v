# PRD: 学习增强套件 — 知识图谱 + 闪卡复习 + 智能书签 + 笔记重构

## Introduction

当前 Teaching-Learning 应用的核心体验是「看 PPT → AI 解析 → 记笔记」，但笔记功能（单个 Markdown 大文本块）缺乏结构、与幻灯片脱节、难以回顾。本 PRD 规划四个相互关联的功能模块，将应用从「被动阅读工具」升级为「主动学习系统」：

1. **笔记重构** — 从单一文本块升级为结构化、按页关联、AI 辅助的笔记系统
2. **智能书签** — 标记重点/难点/待复习页，支持分类和快速筛选
3. **闪卡复习** — 基于解析和笔记自动生成闪卡，接入已有 SM-2 算法
4. **知识图谱** — 可视化概念关联与课程结构，辅助全局理解

## Goals

- 笔记系统可用性显著提升：支持按页记录、AI 自动生成、双向关联幻灯片
- 用户可在 2 次点击内标记/查找任意重点页
- 闪卡复习基于 SM-2 间隔重复，覆盖每页核心知识点
- 知识图谱覆盖整份文档的关键概念及其关联，可交互浏览
- 所有数据本地存储（SQLite），无需额外后端服务
- 导出兼容 Obsidian Markdown 格式

---

## Phase 1: 笔记重构 + 智能书签（核心体验）

### US-001: 按页笔记数据模型

**Description:** 作为开发者，我需要将笔记从「每文档一个大文本」重构为「每页一条笔记 + 文档级摘要」，使笔记与幻灯片建立关联。

**Acceptance Criteria:**
- [ ] 新增 `slide_note` 表：`id`, `document_id` (FK), `slide_id` (FK), `page_num`, `content_md`, `source` (manual/ai/mixed), `created_at`, `updated_at`
- [ ] 新增 `document_summary` 表：`id`, `document_id` (FK, UNIQUE), `content_md`, `created_at`, `updated_at`
- [ ] 保留原 `documentnotebook` 表做兼容，新增迁移逻辑将已有笔记按 `## Page X` 标题拆分到 `slide_note`
- [ ] API: `GET /api/v1/slide-notes/{document_id}` 返回该文档所有页笔记
- [ ] API: `PUT /api/v1/slide-notes/{slide_id}` 保存单页笔记
- [ ] API: `GET /api/v1/slide-notes/{slide_id}` 获取单页笔记
- [ ] Typecheck passes

### US-002: 笔记面板 UI 重构

**Description:** 作为用户，我希望笔记面板从「一整块编辑器」变为「当前页笔记 + 全文档大纲」的分栏结构，让我知道笔记对应哪页。

**Acceptance Criteria:**
- [ ] 笔记面板左侧为页导航缩略列表，显示每页是否有笔记（圆点指示器）
- [ ] 右侧为当前页笔记编辑区（Markdown 编辑 + 预览切换）
- [ ] 切换幻灯片时自动跟随到对应页笔记
- [ ] 页导航中可看到每页笔记的前 30 字预览
- [ ] 保留「全文档视图」Tab：将所有页笔记拼接为完整文档预览
- [ ] Typecheck passes
- [ ] 在浏览器中验证 UI

### US-003: AI 自动生成页笔记

**Description:** 作为用户，我希望点一个按钮就能把 AI 解析转化为结构化笔记，省去手动整理。

**Acceptance Criteria:**
- [ ] 每页笔记编辑区有「从解析生成」按钮
- [ ] 点击后将该页 `slideexplanation.markdown` 通过 LLM 精简为学习笔记格式（要点 + 关键术语 + 总结）
- [ ] 生成的笔记自动填入编辑区，`source` 标记为 `ai`
- [ ] 用户编辑后 `source` 变为 `mixed`
- [ ] 支持「全文档一键生成」：批量为所有未记笔记的页生成
- [ ] API: `POST /api/v1/slide-notes/{slide_id}/generate`
- [ ] API: `POST /api/v1/slide-notes/{document_id}/generate-all`
- [ ] Typecheck passes

### US-004: 智能书签 — 数据模型与 API

**Description:** 作为开发者，我需要为幻灯片添加书签/标签系统，支持分类标记。

**Acceptance Criteria:**
- [ ] 新增 `slide_bookmark` 表：`id`, `document_id` (FK), `slide_id` (FK), `page_num`, `tag` (enum: 'important'/'difficult'/'review'/'exam'), `note` (可选短文本), `created_at`
- [ ] 同一页可有多个不同 tag 的书签，但同一 tag 不重复
- [ ] API: `POST /api/v1/bookmarks` — 添加书签 `{slide_id, tag, note?}`
- [ ] API: `DELETE /api/v1/bookmarks/{bookmark_id}` — 删除书签
- [ ] API: `GET /api/v1/bookmarks/{document_id}` — 获取文档所有书签
- [ ] API: `GET /api/v1/bookmarks/{document_id}?tag=important` — 按标签筛选
- [ ] Typecheck passes

### US-005: 智能书签 — UI 集成

**Description:** 作为用户，我希望在幻灯片上快速标记重点/难点，并能一键筛选只看标记页。

**Acceptance Criteria:**
- [ ] 幻灯片查看器右上角显示书签按钮组（4 个图标：重点/难点/待复习/考试）
- [ ] 点击切换标记状态，已标记的图标高亮
- [ ] 幻灯片缩略图列表中，已标记的页显示对应颜色圆点（重点=红, 难点=橙, 复习=蓝, 考试=紫）
- [ ] 缩略图列表顶部新增筛选栏：全部 | 重点 | 难点 | 待复习 | 考试
- [ ] 选择筛选器后只显示对应标记的页，可快速跳转
- [ ] Typecheck passes
- [ ] 在浏览器中验证 UI

### US-006: 笔记导出（Obsidian 兼容）

**Description:** 作为 Obsidian 用户，我希望导出的笔记是按页分节、带双链格式的 Markdown。

**Acceptance Criteria:**
- [ ] 导出按钮生成单个 `.md` 文件
- [ ] 格式：`# 文档名\n## Page 1: [标题候选]\n笔记内容\n\n---\n## Page 2: ...`
- [ ] 书签标记以 Obsidian tag 格式嵌入：`#重点` `#难点` `#待复习` `#考试`
- [ ] 关键术语以 `[[术语]]` 双链格式标记（为后续知识图谱铺垫）
- [ ] API: `POST /api/v1/slide-notes/{document_id}/export`
- [ ] Typecheck passes

---

## Phase 2: 闪卡复习系统

### US-007: 闪卡自动生成

**Description:** 作为用户，我希望 AI 从每页解析/笔记中自动提取 Q&A 闪卡。

**Acceptance Criteria:**
- [ ] 新增 `flashcard` 表：`id`, `document_id` (FK), `slide_id` (FK), `front_md` (问题), `back_md` (答案), `source` (auto/manual), `created_at`
- [ ] API: `POST /api/v1/flashcards/{slide_id}/generate` — AI 从该页解析生成 3-5 张闪卡
- [ ] API: `POST /api/v1/flashcards/{document_id}/generate-all` — 批量生成
- [ ] API: `GET /api/v1/flashcards/{document_id}` — 获取文档所有闪卡
- [ ] API: `POST /api/v1/flashcards` — 手动创建闪卡
- [ ] API: `DELETE /api/v1/flashcards/{flashcard_id}` — 删除闪卡
- [ ] 生成的闪卡类型包含：定义题、概念对比题、填空题
- [ ] Typecheck passes

### US-008: 闪卡复习界面

**Description:** 作为用户，我希望有专门的复习模式，翻卡片、评分、按间隔重复安排下次复习。

**Acceptance Criteria:**
- [ ] 新增「复习」Tab 或浮窗入口
- [ ] 复习界面：显示卡片正面 → 点击翻转 → 显示背面 → 评分按钮（忘了/模糊/记住/简单 → 对应 SM-2 quality 0/2/3/5）
- [ ] 评分后调用已有 `reviewitem` 的 SM-2 算法更新 `interval_days`, `easiness`, `due_at`
- [ ] 将 `flashcard` 与 `reviewitem` 关联：`reviewitem.source_ref = flashcard:{flashcard_id}`
- [ ] 首页显示「今日待复习 N 张」提示
- [ ] 复习完成后显示本次统计（总数、记住率、下次最早复习日期）
- [ ] Typecheck passes
- [ ] 在浏览器中验证 UI

### US-009: 闪卡掌握度统计

**Description:** 作为用户，我希望看到每页/每文档的掌握度，知道哪些内容还没掌握。

**Acceptance Criteria:**
- [ ] API: `GET /api/v1/flashcards/{document_id}/stats` — 返回每页的闪卡数、已掌握数（easiness > 2.5 且 interval > 7）、待复习数
- [ ] 幻灯片缩略图列表中显示掌握度进度条（绿=已掌握, 黄=学习中, 红=未开始）
- [ ] 文档列表页显示整体掌握百分比
- [ ] Typecheck passes
- [ ] 在浏览器中验证 UI

---

## Phase 3: 知识图谱

### US-010: 概念提取

**Description:** 作为开发者，我需要从所有页的解析中提取关键概念及其关系。

**Acceptance Criteria:**
- [ ] 新增 `concept` 表：`id`, `document_id` (FK), `name`, `description`, `slide_ids` (JSON array), `created_at`
- [ ] 新增 `concept_relation` 表：`id`, `document_id` (FK), `source_id` (FK→concept), `target_id` (FK→concept), `relation_type` (prerequisite/related/part_of/contrast), `created_at`
- [ ] API: `POST /api/v1/knowledge-graph/{document_id}/generate` — 从所有 slideexplanation 批量提取概念和关系
- [ ] API: `GET /api/v1/knowledge-graph/{document_id}` — 返回 `{nodes: Concept[], edges: ConceptRelation[]}`
- [ ] LLM prompt 提取结果为结构化 JSON
- [ ] Typecheck passes

### US-011: 知识图谱可视化

**Description:** 作为用户，我希望看到整份文档的概念关系图，点击节点跳转到对应页。

**Acceptance Criteria:**
- [ ] 新增「图谱」Tab 或独立视图
- [ ] 使用 force-directed graph 布局渲染节点和边
- [ ] 节点大小按关联页数加权（出现次数多=更大）
- [ ] 节点颜色按关系类型区分
- [ ] 鼠标悬浮节点显示：概念名、描述、出现在第 X/Y/Z 页
- [ ] 点击节点跳转到对应幻灯片（如果多页，显示页列表弹窗）
- [ ] 支持搜索/高亮某个概念
- [ ] 支持缩放和拖拽
- [ ] Typecheck passes
- [ ] 在浏览器中验证 UI

### US-012: 图谱与笔记联动

**Description:** 作为用户，我希望在笔记中引用的概念能在图谱上高亮，反之亦然。

**Acceptance Criteria:**
- [ ] 笔记中 `[[概念名]]` 格式自动识别为概念引用
- [ ] 打开图谱时，当前页笔记中引用的概念高亮显示
- [ ] 在图谱上点击概念时，右侧显示相关笔记片段
- [ ] Typecheck passes
- [ ] 在浏览器中验证 UI

---

## Functional Requirements

- FR-1: `slide_note` 表支持每页独立笔记，与 `slide` 一对一关联
- FR-2: `slide_bookmark` 表支持 4 种标签类型，同页不同标签可并存
- FR-3: `flashcard` 表与已有 `reviewitem` 通过 `source_ref` 关联
- FR-4: `concept` 和 `concept_relation` 表支持 4 种关系类型
- FR-5: 所有 AI 生成功能通过已有 `model_gateway` 调用，不引入新的 AI 服务
- FR-6: 笔记面板支持按页和全文档两种视图切换
- FR-7: 书签筛选在幻灯片缩略图列表中实现，不改变整体布局
- FR-8: 闪卡复习使用已有 SM-2 算法实现（`reviewitem` 表）
- FR-9: 知识图谱前端使用 D3.js 或 react-force-graph 渲染
- FR-10: 导出 Markdown 兼容 Obsidian 格式（双链 `[[]]` + tag `#`）
- FR-11: 数据迁移：启动时自动将 `documentnotebook` 拆分到 `slide_note`
- FR-12: 所有新 API 遵循已有 `/api/v1/` 路径规范

## Non-Goals

- 不做多人协作/同步
- 不做云端备份或账号系统
- 不做跨文档知识图谱（仅单文档内）
- 不做移动端适配
- 不做通知/提醒推送（复习提醒仅在打开应用时显示）
- 不做 AI 自动评分（闪卡由用户自评）

## Technical Considerations

- **数据库迁移**：使用已有的 `backfill_columns` 模式，在 `init_db()` 中添加新表创建和数据迁移
- **AI 调用**：复用 `model_gateway.py` 的 `generate_chat_completion()`，新增 prompt 模板
- **前端状态**：笔记和书签数据通过 React state 管理，与现有 `useChat` hook 模式一致
- **图谱渲染**：推荐 `@react-force-graph/2d`（轻量，~50KB gzip），备选 D3.js
- **性能**：闪卡和概念提取为异步任务，大文档（50+ 页）需显示进度

## Success Metrics

- Phase 1 完成后：笔记使用率提升（每份文档平均页笔记数 > 5）
- 书签标记操作 < 1 秒，筛选切换 < 0.5 秒
- 闪卡生成 < 10 秒/页，复习界面翻卡响应 < 100ms
- 知识图谱渲染 < 3 秒（50 页文档，~100 个概念节点）
- 导出的 Markdown 在 Obsidian 中正确渲染双链和标签

## Open Questions

1. 是否需要支持手动编辑知识图谱（添加/删除节点和边）？
2. 闪卡是否支持图片（从幻灯片截取图示区域作为题目）？
3. 是否需要「学习计划」功能（根据掌握度自动安排每日复习量）？
4. 书签标签是否需要支持用户自定义（当前为固定 4 种）？

---

## Delivery Timeline

| Phase | Scope | User Stories |
|-------|-------|-------------|
| **Phase 1** | 笔记重构 + 智能书签 | US-001 ~ US-006 |
| **Phase 2** | 闪卡复习系统 | US-007 ~ US-009 |
| **Phase 3** | 知识图谱 | US-010 ~ US-012 |

Phase 1 为最高优先级，解决当前笔记鸡肋的核心问题。Phase 2 复用已有 SM-2 基础设施。Phase 3 依赖前两期数据积累。
