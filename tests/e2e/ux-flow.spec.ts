import { expect, test } from "@playwright/test";

test.describe("Layout & Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("sidebar is visible on load and has hamburger toggle", async ({ page }) => {
    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible();

    // Hamburger button exists with correct aria-label
    const hamburger = page.locator('button[aria-label="收起侧栏"]');
    await expect(hamburger).toBeVisible();

    // Three horizontal bars (spans) inside hamburger
    const bars = hamburger.locator("span");
    await expect(bars).toHaveCount(3);
  });

  test("sidebar completely hides when toggled (no bar shown)", async ({ page }) => {
    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible();

    const hamburger = page.locator('button[aria-label="收起侧栏"]');
    await hamburger.click();

    // Sidebar should have w-0 → effectively zero width
    await expect(sidebar).toHaveCSS("width", "0px");

    // Toggle back
    const reopen = page.locator('button[aria-label="展开侧栏"]');
    await reopen.click();
    await expect(sidebar).not.toHaveCSS("width", "0px");
  });

  test("header shows title", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("幻灯片研习台");
  });

  test("header status chip shows initial upload prompt", async ({ page }) => {
    // Status chip shows initial "请先上传" message since upload.statusText starts with that
    const statusChip = page.locator(".rounded-full").filter({ hasText: "请先上传" });
    await expect(statusChip).toBeVisible();
  });

  test("quiz and review tabs are absent from AI panel", async ({ page }) => {
    // Check all buttons on page — 测验 and 复习 must not appear anywhere
    await expect(page.getByRole("button", { name: "测验" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "复习" })).toHaveCount(0);
  });
});

test.describe("AI Panel Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("panel shows correct tabs: 解析, 结构, 追问", async ({ page }) => {
    // Tabs exist in the tab bar (exact match avoids picking up '生成解析' button)
    await expect(page.getByRole("button", { name: "解析", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "结构", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "追问", exact: true })).toBeVisible();
    // 测验 and 复习 must not exist
    await expect(page.getByRole("button", { name: "测验" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "复习" })).toHaveCount(0);
  });

  test("switching to 结构 tab shows structure section", async ({ page }) => {
    await page.getByRole("button", { name: "结构" }).click();
    // No document loaded — shows empty-state note
    await expect(page.getByText("当前页尚未提取出结构化内容")).toBeVisible();
  });

  test("switching to 追问 tab shows chat input", async ({ page }) => {
    await page.getByRole("button", { name: "追问" }).click();
    const chatTextarea = page.getByPlaceholder("输入问题，Ctrl/⌘+Enter 发送");
    await expect(chatTextarea).toBeVisible();
    // Textarea is disabled because no slide is selected — this is correct UX
    await expect(chatTextarea).toBeDisabled();
  });
});

test.describe("Note Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("笔记 tab is removed from AI panel tabs", async ({ page }) => {
    // 笔记 should not appear as a tab button in the AI panel
    const notesTabBtn = page.getByRole("button", { name: "笔记" });
    await expect(notesTabBtn).toHaveCount(0);
  });

  test("note mode toggle button only appears for active document", async ({ page }) => {
    // With no document loaded, sidebar doc cards have no 笔记 button
    const noteBtn = page.locator("aside button", { hasText: "笔记" });
    await expect(noteBtn).toHaveCount(0);
  });
});

test.describe("UX Logic Verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("sidebar description is present and academic", async ({ page }) => {
    // Old AI-flavored text must not be present
    await expect(page.getByText("你的学习资料库")).toHaveCount(0);
    // New concise description
    await expect(page.getByText("上传文档后自动生成解析缓存")).toBeVisible();
  });

  test("document library label is shown", async ({ page }) => {
    await expect(page.getByText("文档库")).toBeVisible();
  });

  test("解析 tab shows correct empty state placeholder", async ({ page }) => {
    // Should show "当前页解析尚未生成" not the old "当前页 AI 解析"
    await expect(page.getByText("当前页解析尚未生成")).toBeVisible();
    await expect(page.getByText("当前页 AI 解析")).toHaveCount(0);
  });
});

test.describe("Interaction Correctness", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("hamburger button aria-label flips after click", async ({ page }) => {
    const closeBtn = page.locator('button[aria-label="收起侧栏"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    const openBtn = page.locator('button[aria-label="展开侧栏"]');
    await expect(openBtn).toBeVisible();
  });

  test("chat textarea is visible and disabled when no document is loaded", async ({ page }) => {
    await page.getByRole("button", { name: "追问" }).click();
    const textarea = page.getByPlaceholder("输入问题，Ctrl/⌘+Enter 发送");
    await expect(textarea).toBeVisible();
    // Correctly disabled when no slide is selected — expected behavior
    await expect(textarea).toBeDisabled();
  });

  test("send button is disabled when no document is loaded", async ({ page }) => {
    await page.getByRole("button", { name: "追问" }).click();
    const sendBtn = page.getByRole("button", { name: "发送" });
    await expect(sendBtn).toBeDisabled();
  });

  test("page indicator shows — when no slide is selected", async ({ page }) => {
    const pageIndicator = page.locator(".rounded-full").filter({ hasText: "—" });
    await expect(pageIndicator).toBeVisible();
  });

  test("解析 generate button is disabled when no document is loaded", async ({ page }) => {
    // The AI panel's "生成解析" button (not the sidebar doc card button)
    const generateBtn = page.locator("button.btn-primary", { hasText: "生成解析" });
    await expect(generateBtn).toBeDisabled();
  });

  test("ROI explain button is disabled when no slide is selected", async ({ page }) => {
    await page.getByRole("button", { name: "追问" }).click();
    const roiBtn = page.getByRole("button", { name: "解析框选区域" });
    await expect(roiBtn).toBeDisabled();
  });
});
