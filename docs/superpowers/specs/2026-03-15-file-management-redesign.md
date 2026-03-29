# File Management Redesign Design
**Date:** 2026-03-15
**Project:** Teaching-Learning- PPT 学习助手

---

## 1. Goal

两项改动，解决文件多时侧栏难操作的问题：

1. **侧栏紧凑化**：把大文件卡片（~80-100px）换成单行紧凑行（~32px），密度提升 3x
2. **上传即归类**：上传文件时弹出文件夹选择 Modal，直接归入目标文件夹，不用事后拖拽

---

## 2. Architecture

```
document-library.tsx
  ├── SortableDocumentCard  ← 改为单行紧凑行，⋯ 菜单替代内嵌按钮
  ├── FolderDropzone        ← 内部列表从卡片换为行
  └── Upload handler        ← 选文件后拦截，弹出 FolderPickerModal

FolderPickerModal.tsx (新文件)
  └── 独立 Modal 组件，复用于：上传归类 + 文件移动

Backend: POST /api/v1/documents/upload
  └── 新增可选 folder_id 字段（FormData）
```

---

## 3. UI Changes

### 3.1 紧凑文件行（替换 SortableDocumentCard）

**布局（单行 ~32px）：**

```
[⠿] [📄] 文件名（截断）            [页数] [状态] [⋯]
```

- `⠿` 拖拽 handle，桌面端 hover 时显示（占位宽度保留，颜色透明→可见），不支持 touch 拖拽（现有行为）
- 文件名：`truncate` + `title` tooltip 显示完整名
- 状态：小色点（● 绿=ready / ● 黄=processing / ● 红=error）替代文字 badge
- `⋯` 操作菜单（dropdown）：
  - **打开 / 查看**（点击文件行本身也触发）
  - **生成解析**（原卡片上的按钮）
  - **移动到文件夹…**（打开 FolderPickerModal；确认后调用 `moveDocumentToFolder`，`targetIndex = targetFolder.documents.length`，即追加到目标文件夹末尾）
  - **删除**（原有逻辑）
- 当前选中文件：行背景高亮（现有 `active` 样式调色）

**保留功能：**
- dnd-kit 拖拽到文件夹（`FolderDropzone` + `FolderShelfChip` 逻辑不变）
- `DragPreviewCard` 保持现有大卡片样式（拖拽时 overlay，不需改动）
- 状态轮询（`pollDocumentReady`）
- 解析进度显示（`generationProgress` 通过 ⋯ 菜单入口触发，进度显示移到行内进度条或 toast）

**移除功能：**
- 卡片内嵌的"生成解析"按钮（移入 ⋯ 菜单）
- 卡片内嵌的笔记 toggle（笔记入口改为：点击文件行激活该文件时，笔记面板随之显示，和现有 active 文件绑定逻辑一致）

### 3.2 文件夹折叠头部

不变。仍使用 `FolderDropzone` 结构，只是内部 children 从大卡片换成紧凑行。

---

## 4. FolderPickerModal 组件

### 4.1 触发场景

| 场景 | 触发方式 | 初始选中 |
|------|---------|---------|
| 上传新文件 | 文件选择后，上传前 | 无（提示用户选） |
| 移动文件 | ⋯ 菜单 → 移动到文件夹… | 当前所在文件夹 |

### 4.2 Modal 内容

```
┌─────────────────────────────┐
│  📄 文件名.pdf               │
│  选择归属文件夹               │
│                             │
│  ○ 📁 期末复习               │
│  ● 📁 英语课件   ← 选中      │
│  ○ 📁 物理实验               │
│  ─────────────────          │
│  ○ 📂 未归类                 │
│  + 新建文件夹…               │
│                             │
│  [跳过]      [确认上传]       │
└─────────────────────────────┘
```

- 文件夹列表从 `FolderLibrary` state 读取（已在父组件加载，无需额外请求）；modal 仅消费每个文件夹的 `id` 和 `name`
- 支持键盘：↑↓ 导航，Enter 确认，Esc 关闭（等同跳过）
- "新建文件夹…"：inline 展开输入框，`POST /api/v1/folders`，创建后自动选中
- "跳过"：关闭 modal，`folder_id = null`，继续上传到未归类
- "确认上传" / "确认移动"：点击后按钮立即 disabled（防重复提交），执行对应操作后关闭 modal

### 4.3 Props Interface

```typescript
type FolderPickerModalProps = {
  isOpen: boolean
  filename: string
  folders: FolderGroup[]
  initialFolderId?: string | null   // 移动场景用
  mode: "upload" | "move"
  onConfirm: (folderId: string | null) => void
  onClose: () => void
}
```

---

## 5. Upload Flow Changes

### 5.1 现有流程

```
用户选文件 → onUpload(file) → POST /upload → 刷新列表
```

### 5.2 新流程

```
用户选文件 → 弹出 FolderPickerModal
  ├── 用户选文件夹 + 确认 → POST /upload (with folder_id) → 刷新列表
  └── 用户跳过 / Esc    → POST /upload (no folder_id) → 刷新列表
```

**document-library.tsx 改动：**
- 新增 state：`pendingUploadFile: File | null`，`showFolderPicker: boolean`
- `onUpload(file)` 改为：若 `showFolderPicker` 已为 `true`（modal 已开），忽略新文件（防止快速双击覆盖）；否则设置 `pendingUploadFile = file`，`showFolderPicker = true`
- `handleFolderPickerConfirm(folderId)` 关闭 modal，调用实际上传逻辑（带 `folder_id`），清空 `pendingUploadFile`

**useUpload.ts 改动：**
- `handleUpload(file, folderId?: string | null)` 新增可选参数 `folderId`
- 调用 `uploadDocument(file, folderId)` 时透传

### 5.3 Backend: POST /api/v1/documents/upload

**现有 FormData 字段：** `file` (required)

**新增字段：** `folder_id` (optional, string UUID | 省略或空字符串 = null)

```python
# documents.py
@router.post("/upload")
async def upload_document(
    file: UploadFile,
    folder_id: str | None = Form(default=None),  # 新增
    db: Session = Depends(get_session),
    ...
):
    # 验证 folder_id 存在
    if folder_id:
        folder = db.get(Folder, folder_id)
        if not folder:
            raise HTTPException(status_code=422, detail="folder_id does not exist")
    doc = Document(
        ...
        folder_id=folder_id or None,  # 空字符串也处理为 null
    )
```

**FormData 拼装规则（前端）：**
- 用户选了文件夹：`form.append("folder_id", folderId)`
- 用户跳过：**不 append** `folder_id`（勿传字符串 `"null"`）

---

## 6. Files to Change

| File | Type | Change |
|------|------|--------|
| `frontend/components/document-library.tsx` | Modify | 替换 `SortableDocumentCard` 为紧凑行；新增 upload 拦截逻辑；引入 `FolderPickerModal` |
| `frontend/components/folder-picker-modal.tsx` | Create | 新建 Modal 组件（~120 行） |
| `frontend/lib/api.ts` | Modify | `uploadDocument` 函数新增 `folderId?: string \| null` 参数 |
| `frontend/hooks/useUpload.ts` | Modify | `handleUpload` 新增 `folderId` 参数，透传给 `uploadDocument` |
| `backend/app/api/documents.py` | Modify | `upload_document` 接口新增 `folder_id: str \| None = Form(None)`，加 422 校验 |

---

## 7. Out of Scope

- AI 自动推断文件夹（根据文件名/内容）— 可后续迭代
- 批量上传同时选文件夹
- 文件夹颜色在 Modal 中显示（简化，只显示名称）
- 拖拽排序在紧凑行模式下的视觉优化（逻辑保留，视觉微调低优先级）
