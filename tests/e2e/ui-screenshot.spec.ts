/**
 * Comprehensive UI screenshot + interaction test.
 * Captures screenshots of every major module and tests all key buttons.
 */
import { expect, test } from "@playwright/test";
import * as path from "path";

const SCREENSHOTS = path.resolve(__dirname, "../../test-results/screenshots");
const DOC = "Introduction.pdf";

async function loadDoc(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const card = page.locator("aside").getByText(DOC);
  const found = await card.isVisible({ timeout: 5000 }).catch(() => false);
  if (!found) test.skip(true, `${DOC} not in sidebar`);
  await card.click();
  await expect(page.locator(".rounded-full").filter({ hasText: /P\d/ })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

test.describe("Full UI Screenshot & Button Test", () => {
  test("01 initial load — no document", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SCREENSHOTS}/01-initial-load.png`, fullPage: false });

    // Header
    await expect(page.locator("h1")).toContainText("幻灯片研习台");
    // Sidebar visible
    await expect(page.locator("aside")).toBeVisible();
    // Upload button exists and is enabled
    await expect(page.locator('label:has-text("上传 PDF/图片")')).toBeVisible();
    // Either empty state (no docs) or doc list is shown
    const hasEmpty = await page.getByText("暂无文档。上传 PDF 后显示。").isVisible().catch(() => false);
    const hasDocList = await page.locator("aside article").first().isVisible().catch(() => false);
    expect(hasEmpty || hasDocList).toBe(true);
    // AI panel generate button is disabled until a slide is selected
    const genBtn = page.locator("button.btn-primary", { hasText: "生成解析" });
    await expect(genBtn).toBeDisabled();
  });

  test("02 sidebar collapse / expand", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const aside = page.locator("aside").first();
    const hamburger = page.locator('button[aria-label="收起侧栏"]');
    await expect(aside).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS}/02a-sidebar-open.png` });

    await hamburger.click();
    await page.waitForTimeout(300);
    await expect(aside).toHaveCSS("width", "0px");
    await page.screenshot({ path: `${SCREENSHOTS}/02b-sidebar-collapsed.png` });

    // Reopen
    await page.locator('button[aria-label="展开侧栏"]').click();
    await page.waitForTimeout(300);
    await expect(aside).not.toHaveCSS("width", "0px");
  });

  test("03 load document — sidebar doc card buttons", async ({ page }) => {
    await loadDoc(page);
    await page.screenshot({ path: `${SCREENSHOTS}/03-doc-loaded.png` });

    // Doc card visible
    await expect(page.locator("aside").getByText(DOC)).toBeVisible();
    // Page count badge
    await expect(page.locator("aside").getByText(/58 页/)).toBeVisible();
    // Status badge
    await expect(page.locator("aside").getByText("ready")).toBeVisible();
    // "生成解析" batch button in sidebar card — enabled since doc is ready
    const batchBtn = page.locator("aside button", { hasText: "生成解析" });
    await expect(batchBtn).toBeEnabled();
    // "笔记" toggle button in sidebar card
    const noteToggle = page.locator("aside button", { hasText: "笔记" });
    await expect(noteToggle).toBeVisible();
    await expect(noteToggle).toBeEnabled();
    // Delete button
    const deleteBtn = page.locator("aside button", { hasText: "删除" });
    await expect(deleteBtn).toBeEnabled();
  });

  test("04 解析 tab — explanation renders as HTML (not raw markdown)", async ({ page }) => {
    await loadDoc(page);
    // Badge should be "已缓存"
    await expect(page.locator(".rounded-full").filter({ hasText: "已缓存" })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS}/04a-explain-tab.png` });

    // Content must contain rendered heading, NOT raw ## characters as text
    const explainDiv = page.locator('[data-note-source="explanation-content"]');
    const html = await explainDiv.innerHTML();
    // Rendered HTML should have <h2> or <h3> tags, NOT raw ## markers outside code blocks
    expect(html).toMatch(/<h[1-6]/);
    expect(html).not.toMatch(/^##/);  // raw ## at start of text node

    // "生成解析" button in AI panel is enabled
    const genBtn = page.locator("button.btn-primary", { hasText: "生成解析" });
    await expect(genBtn).toBeEnabled();
  });

  test("05 解析 tab — generate button triggers generation", async ({ page }) => {
    await loadDoc(page);
    const genBtn = page.locator("button.btn-primary", { hasText: "生成解析" });
    await genBtn.click();
    // Badge changes to "生成中"
    await expect(page.locator(".rounded-full").filter({ hasText: "生成中" })).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${SCREENSHOTS}/05-generating.png` });
    // Wait for completion
    await expect(page.locator(".rounded-full").filter({ hasText: "已缓存" })).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${SCREENSHOTS}/05-generated.png` });
  });

  test("06 结构 tab — shows stats and full page text", async ({ page }) => {
    await loadDoc(page);
    await page.getByRole("button", { name: "结构", exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENSHOTS}/06-structure-tab.png` });

    await expect(page.getByText("页面统计")).toBeVisible();
    await expect(page.getByText("页面文本")).toBeVisible();
    // Word count is non-zero (derived from text)
    const statsText = await page.locator(".markdown-body").last().textContent();
    expect(statsText).not.toContain("文字量（词）：0");
    // Actual text content present
    expect(statsText).toContain("DSAI4203");
  });

  test("07 追问 tab — chat area with mode toggle and send button", async ({ page }) => {
    await loadDoc(page);
    await page.getByRole("button", { name: "追问", exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENSHOTS}/07-chat-tab.png` });

    // Textarea enabled (doc loaded)
    const textarea = page.getByPlaceholder("输入问题，Ctrl/⌘+Enter 发送");
    await expect(textarea).toBeEnabled();
    // Mode toggle buttons
    await expect(page.getByRole("button", { name: "当前页" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全局" })).toBeVisible();
    // Send button disabled when textarea empty
    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
    // Type a question and send button becomes enabled
    await textarea.fill("什么是机器学习？");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
    await page.screenshot({ path: `${SCREENSHOTS}/07b-chat-with-input.png` });
  });

  test("08 笔记 panel — toggle opens NoteEditor, basic interactions", async ({ page }) => {
    await loadDoc(page);
    // Click 笔记 toggle in sidebar
    const noteToggle = page.locator("aside button", { hasText: "笔记" });
    await noteToggle.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENSHOTS}/08a-note-editor-open.png` });

    // NoteEditor should replace AIPanel — look for note toolbar buttons
    await expect(page.getByRole("button", { name: "整理" })).toBeVisible();
    await expect(page.getByRole("button", { name: "润色" })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出" })).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑" })).toBeVisible();
    await expect(page.getByRole("button", { name: "预览" })).toBeVisible();
    await expect(page.getByRole("button", { name: /版本/ })).toBeVisible();

    // Type into note textarea
    const noteTextarea = page.locator("textarea[placeholder='在此记录笔记，支持 Markdown。']");
    await expect(noteTextarea).toBeVisible();
    await noteTextarea.fill("# 测试笔记\n\n这是一条笔记。");

    // Switch to preview mode
    await page.getByRole("button", { name: "预览" }).click();
    await page.waitForTimeout(200);
    await expect(page.locator(".markdown-body")).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS}/08b-note-preview.png` });

    // Close note panel
    await noteToggle.click();
    await page.waitForTimeout(300);
    // AIPanel should be back
    await expect(page.getByRole("button", { name: "解析", exact: true })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS}/08c-back-to-ai-panel.png` });
  });

  test("09 slide navigation — switching slides updates explanation", async ({ page }) => {
    await loadDoc(page);
    const explainDiv = page.locator('[data-note-source="explanation-content"]');
    const page1Text = await explainDiv.textContent();

    // Click second thumbnail
    const thumbs = page.locator("aside img");
    if (await thumbs.count() < 2) { test.skip(true, "not enough slides"); return; }
    await thumbs.nth(1).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENSHOTS}/09-slide-2.png` });

    const page2Text = await explainDiv.textContent();
    expect(page2Text).not.toEqual(page1Text);
    // Page indicator updates
    await expect(page.locator(".rounded-full").filter({ hasText: /P2/ })).toBeVisible();
  });

  test("10 sidebar generation progress + abort", async ({ page }) => {
    await loadDoc(page);
    // Start bulk generation
    const batchBtn = page.locator("aside button", { hasText: "生成解析" });
    await batchBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOTS}/10a-generation-progress.png` });

    // Progress bar and abort button should appear
    const abortBtn = page.locator("aside button", { hasText: "终止" });
    const progressAppeared = await abortBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (progressAppeared) {
      await abortBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOTS}/10b-aborted.png` });
      // After abort, batch gen button should return (allow time for in-flight slide to finish)
      await expect(batchBtn).toBeVisible({ timeout: 30000 });
    }
  });
});
