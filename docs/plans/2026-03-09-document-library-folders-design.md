# Document Library Folders Design

## Goal
为文档库增加单层学科文件夹和拖拽迁移能力。用户可以把不同课程/科目的 PDF 放进不同文件夹，并像 Obsidian 一样在侧栏里通过拖动文档项完成迁移。当前阶段只做单层文件夹，不做多级嵌套。

## Why This Shape
现有系统的文档库是平铺列表，`Document` 没有归属信息，前端也没有树状或分组结构。直接上多级嵌套会把数据模型、拖拽状态和边界条件复杂度同时拉高。单层文件夹先解决核心需求：按学科整理、快速迁移、顺序持久化。

## Data Model
新增 `Folder` 表：
- `id`
- `name`
- `color`
- `sort_order`
- `created_at`

扩展 `Document`：
- `folder_id: str | None`
- `sort_order: int`

约束：
- 文档允许暂时无文件夹，后端会提供一个默认的 `未归类` 逻辑分组，不单独落表。
- 删除文件夹时，不删除文档；文件夹下文档自动回到 `未归类`。
- 只做单层，不引入 `parent_id`。

## API Shape
在现有 `documents` API 之外新增 `folders` API：
- `GET /api/v1/folders`：返回所有文件夹及其文档
- `POST /api/v1/folders`：创建文件夹
- `PATCH /api/v1/folders/{folder_id}`：重命名或改色
- `DELETE /api/v1/folders/{folder_id}`：删除文件夹并把文档移到未归类
- `POST /api/v1/folders/move-document`：把文档迁移到目标文件夹并更新排序

返回结构直接面向侧栏：每个文件夹带 `documents[]`，外加一个 `uncategorized` 分组，减少前端二次 regroup。

## Frontend Behavior
左侧资料库改成：
- 顶部上传按钮保留
- 文件夹列表可展开/收起
- 每个文件夹内显示文档项
- 文档项支持拖拽到其他文件夹
- 当前文档高亮仍然保留
- 删除文档按钮保留在文档项尾部

使用 `dnd-kit`：
- `SortableContext` 负责同文件夹内部排序
- 文件夹本身作为 droppable 容器
- 文档项作为 draggable item
- 首期不支持拖动文件夹排序，只支持文档迁移和同组排序

## Persistence Rules
拖拽结束后前端做 optimistic update，然后调用后端持久化：
- 同文件夹内拖动：只更新该文件夹文档顺序
- 跨文件夹拖动：更新 `folder_id + sort_order`
- 如果保存失败，前端回滚到服务端最新状态

## Migration Strategy
SQLite 启动时补列：
- 新建 `folder` 表
- `document.folder_id`
- `document.sort_order`

旧文档默认进入 `未归类` 逻辑分组，不需要一次性数据迁移脚本。

## Testing Strategy
后端：
- 文件夹 CRUD
- 删除文件夹后文档回到未归类
- 同组重排和跨组迁移
- 文档列表结构正确

前端：
- 侧栏按文件夹分组渲染
- 创建文件夹
- 拖拽文档到目标文件夹
- 删除文件夹后文档移动到未归类
- 当前文档切换、删除、上传不回归

## Out Of Scope
- 多级嵌套文件夹
- 拖动文件夹本身排序
- 标签系统
- 文档批量移动
- 服务端权限控制
