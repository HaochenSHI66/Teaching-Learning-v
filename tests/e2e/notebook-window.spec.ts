import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function seedReadyNotebookDocument(
  filename: string,
  options?: {
    notebookMarkdown?: string;
    pageNum?: number;
    slideTitle?: string;
    explanationMarkdown?: string;
    explanationMeta?: Record<string, unknown>;
  },
) {
  const dbPath = join(process.cwd(), "backend", "storage", "app.db");
  const storageRoot = join(process.cwd(), "backend", "storage");

  execFileSync("python3", [
    "-c",
    `
import base64, json, os, sqlite3, sys, uuid
from datetime import datetime, timezone

db_path, storage_root, filename = sys.argv[1], sys.argv[2], sys.argv[3]
document_id = str(uuid.uuid4())
slide_id = str(uuid.uuid4())
extract_id = str(uuid.uuid4())
explanation_id = str(uuid.uuid4())
notebook_id = str(uuid.uuid4())
now = datetime.now(timezone.utc).isoformat()
png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAASwAAADICAIAAADdvUsCAAABNElEQVR4nO3TMQ0AAAjDMO5fNNDhHFQgE/TqjMydA6D1OgD8M2wB2AKwBWALwBaALQBbALYAbAHYArAFYAvAFoAtAFsAtgBsAdgCsAVgC8AWgC0AWwC2AGwB2AKwBWALwBaALQBbALYAbAHYArAFYAvAFoAtAFsAtgBsAdgCsAVgC8AWgC0AWwC2AGwB2AKwBWALwBaALQBbALYAbAHYArAFYAvAFoAtAFsAtgBsAdgCsAVgC8AWgC0AWwC2AGwB2AKwBWALwBaALQBbALYAbAHYArAFYAvAFoAtAFsAtgBsAdgCsAXgA9+yA2vY3e8NAAAAAElFTkSuQmCC")
notebook_markdown = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
page_num = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else 1
slide_title = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] else "Gradient Descent"
explanation_markdown = sys.argv[7] if len(sys.argv) > 7 and sys.argv[7] else None
explanation_meta = json.loads(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] else None

doc_dir = os.path.join(storage_root, document_id)
slides_dir = os.path.join(doc_dir, "slides")
thumbs_dir = os.path.join(doc_dir, "thumbnails")
os.makedirs(slides_dir, exist_ok=True)
os.makedirs(thumbs_dir, exist_ok=True)
with open(os.path.join(slides_dir, "slide_001.png"), "wb") as fh:
    fh.write(png)
with open(os.path.join(thumbs_dir, "thumb_001.png"), "wb") as fh:
    fh.write(png)

extract_payload = {
    "schema_version": 3,
    "page_num": page_num,
    "text": f"{slide_title} overview",
    "summary": f"{slide_title} overview",
    "title_candidates": [slide_title],
    "text_blocks": [{"id": "text-1", "type": "text", "bbox": [0, 0, 1, 1], "order": 0, "text": f"{slide_title} overview"}],
    "bullet_blocks": [],
    "figures": [],
    "tables": [],
    "equation_like_blocks": [],
    "code_like_blocks": [],
    "reading_order": ["text-1"],
    "page_stats": {"word_count": 3, "text_block_count": 1, "bullet_count": 0, "figure_count": 0},
    "repeat_analysis": None,
}
meta = {
    "render_mode": "repeat-aware",
    "content_type": "concept",
    "title": slide_title,
    "repeat_summary": {"repeat_pages": [], "repeated_ratio": 0.0, "has_repeat_section": False},
    "sections": {
        "translation_md": f"### 完整翻译与解释\\n\\n<mark>{slide_title}</mark> 用来说明当前页的核心内容。",
        "primary_md": "### 知识点总结\\n\\n这页主要介绍更新方向与学习率之间的关系。"
    }
}
if explanation_meta:
    meta = explanation_meta
markdown = explanation_markdown or f"## {slide_title}\\n\\n### 完整翻译与解释\\n\\n<mark>{slide_title}</mark> 用来说明当前页的核心内容。\\n\\n### 知识点总结\\n\\n这页主要介绍更新方向与学习率之间的关系。"

connection = sqlite3.connect(db_path)
connection.execute(
    "INSERT INTO document (id, filename, media_type, storage_path, folder_id, sort_order, status, page_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (document_id, filename, "application/pdf", document_id, None, 9999, "ready", 1, now),
)
connection.execute(
    "INSERT INTO slide (id, document_id, page_num, image_path, thumbnail_path, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)",
    (slide_id, document_id, page_num, "slides/slide_001.png", "thumbnails/thumb_001.png", 300, 200),
)
connection.execute(
    "INSERT INTO slideextract (id, slide_id, payload) VALUES (?, ?, ?)",
    (extract_id, slide_id, json.dumps(extract_payload)),
)
connection.execute(
    "INSERT INTO slideexplanation (id, document_id, slide_id, page_num, markdown, meta, version, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    (explanation_id, document_id, slide_id, page_num, markdown, json.dumps(meta), 4, now),
)
if notebook_markdown:
    connection.execute(
        "INSERT INTO documentnotebook (id, document_id, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (notebook_id, document_id, notebook_markdown, now, now),
    )
connection.commit()
connection.close()
`,
    dbPath,
    storageRoot,
    filename,
    options?.notebookMarkdown ?? "",
    String(options?.pageNum ?? 1),
    options?.slideTitle ?? "Gradient Descent",
    options?.explanationMarkdown ?? "",
    options?.explanationMeta ? JSON.stringify(options.explanationMeta) : "",
  ]);
}

async function waitForSeededDocument(page: import("@playwright/test").Page, filename: string) {
  await expect
    .poll(async () => {
      const response = await page.request.get("http://127.0.0.1:8000/api/v1/documents");
      const payload = await response.json();
      return payload.documents?.some((item: { filename?: string }) => item.filename === filename) ?? false;
    }, { timeout: 15000 })
    .toBeTruthy();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.getByTestId(`document-item-${filename}`).count()) {
      return;
    }
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
  await expect(page.getByTestId(`document-item-${filename}`)).toHaveCount(1, { timeout: 15000 });
}

test("document notebook opens as floating window while AI panel stays visible", async ({ page }) => {
  const filename = `Notebook-${Date.now()}.pdf`;
  seedReadyNotebookDocument(filename);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await waitForSeededDocument(page, filename);
  await page.getByTestId(`document-item-${filename}`).getByRole("button").first().click();
  const notebookToggle = page.getByTestId(`document-item-${filename}`).getByRole("button", { name: "笔记" });

  await expect(page.getByRole("button", { name: "解析", exact: true })).toBeVisible();
  await expect(page.getByText("P1/1")).toBeVisible({ timeout: 15000 });
  await expect(notebookToggle).toBeVisible({ timeout: 15000 });

  await notebookToggle.click();

  await expect(page.getByRole("button", { name: "解析", exact: true })).toBeVisible();
  await expect(page.getByTestId("notebook-window")).toBeVisible();
  await expect(page.getByTestId("notebook-window")).toContainText("笔记本");

  await page.getByRole("button", { name: "收起笔记本" }).click();
  await expect(page.getByTestId("notebook-dock")).toBeVisible();
});

test("autogen notebook switches to preview and renders mark highlights", async ({ page }) => {
  const filename = `Notebook-Autogen-${Date.now()}.pdf`;
  seedReadyNotebookDocument(filename);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await waitForSeededDocument(page, filename);

  const card = page.getByTestId(`document-item-${filename}`);
  await card.getByRole("button").first().click();
  await expect(page.getByText("P1/1")).toBeVisible({ timeout: 15000 });

  await card.getByRole("button", { name: "笔记" }).click();
  await expect(page.getByTestId("notebook-window")).toBeVisible();

  await page.getByRole("button", { name: "结构化" }).click();
  await expect(page.getByRole("button", { name: "预览" })).toHaveClass(/btn-segment-active/, {
    timeout: 15000,
  });
  await expect(page.locator('[data-testid="notebook-window"] mark').first()).toBeVisible({
    timeout: 15000,
  });
});

test("selected explanation text can be inserted into notebook with source reference", async ({ page }) => {
  const filename = `Notebook-Selection-${Date.now()}.pdf`;
  seedReadyNotebookDocument(filename);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await waitForSeededDocument(page, filename);

  const card = page.getByTestId(`document-item-${filename}`);
  await card.getByRole("button").first().click();
  await expect(page.getByText("P1/1")).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const target = document.querySelector('[data-note-source="explanation-content"] .markdown-body p');
    if (!target) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await expect(page.getByRole("button", { name: "摘录至笔记" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "摘录至笔记" }).click();

  await expect(page.getByTestId("notebook-window")).toBeVisible({ timeout: 10000 });
  const textarea = page.getByTestId("notebook-window").locator("textarea");
  await expect(textarea).toContainText("### 摘录");
  await expect(textarea).toContainText("_来源：第 1 页 · 当前页解析_");
});

test("selected explanation text appends inside the last existing page section without duplicating the heading", async ({ page }) => {
  const filename = `Notebook-LastPage-${Date.now()}.pdf`;
  seedReadyNotebookDocument(filename, {
    pageNum: 2,
    slideTitle: "Matrix Rank",
    notebookMarkdown: `# ${filename} 笔记本

## 第 1 页 · Introduction

### 核心内容
- 第一页摘要

## 第 2 页 · Matrix Rank

### 核心内容
- 现有第二页内容`,
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await waitForSeededDocument(page, filename);

  const card = page.getByTestId(`document-item-${filename}`);
  await card.getByRole("button").first().click();
  await expect(page.getByText("P2/1")).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const target = document.querySelector('[data-note-source="explanation-content"] .markdown-body p');
    if (!target) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await expect(page.getByRole("button", { name: "摘录至笔记" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "摘录至笔记" }).click();

  const textarea = page.getByTestId("notebook-window").locator("textarea");
  await expect(textarea).toContainText("### 摘录");
  await expect(textarea).toContainText("_来源：第 2 页 · 当前页解析_");
  await expect(textarea).toHaveValue(/## 第 2 页 · Matrix Rank/);
  await expect(textarea).not.toHaveValue(/## 第 2 页 · Matrix Rank[\s\S]*## 第 2 页 · Matrix Rank/);
});

test("notebook shows page outline and can jump to another page section", async ({ page }) => {
  const filename = `Notebook-Outline-${Date.now()}.pdf`;
  seedReadyNotebookDocument(filename, {
    notebookMarkdown: `# ${filename} 笔记本

## 第 1 页 · Introduction

### 核心内容
${Array.from({ length: 30 }, (_, index) => `- 第一部分内容 ${index + 1}`).join("\n")}

## 第 2 页 · Matrix Rank

### 核心内容
<mark>秩（Rank）</mark> 描述线性无关方向的数量。`,
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await waitForSeededDocument(page, filename);

  const card = page.getByTestId(`document-item-${filename}`);
  await card.getByRole("button").first().click();
  await expect(page.getByText("P1/1")).toBeVisible({ timeout: 15000 });

  await card.getByRole("button", { name: "笔记" }).click();
  await page.getByRole("button", { name: "预览" }).click();

  await expect(page.getByTestId("notebook-outline")).toBeVisible();
  await expect(page.getByTestId("notebook-outline")).toContainText("P1");
  await expect(page.getByTestId("notebook-outline")).toContainText("P2");

  const before = await page.getByTestId("notebook-preview").evaluate((node) => node.scrollTop);
  await page.getByRole("button", { name: "P2" }).click();
  await expect
    .poll(async () => page.getByTestId("notebook-preview").evaluate((node) => node.scrollTop))
    .toBeGreaterThan(before + 20);
});
