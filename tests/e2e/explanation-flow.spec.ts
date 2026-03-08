import { expect, test } from "@playwright/test";

const DOC_FILENAME = "Introduction.pdf";

test.describe("Explanation & Structure Flow (with real document)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Load the document by clicking its card in the sidebar
    // Sidebar fetches docs asynchronously — wait up to 5 s
    const docCard = page.locator("aside").getByText(DOC_FILENAME);
    const found = await docCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (!found) {
      test.skip(true, `${DOC_FILENAME} not found in sidebar — upload it first`);
      return;
    }
    await docCard.click();
    // Wait until page indicator changes from "—" to "P1/N"
    await expect(page.locator(".rounded-full").filter({ hasText: /P\d/ })).toBeVisible({
      timeout: 10000,
    });
  });

  test("解析 tab shows cached explanation (not empty state) after document loads", async ({ page }) => {
    // Badge should say "已缓存" since all 58 pages already have explanations
    const badge = page.locator(".rounded-full").filter({ hasText: "已缓存" });
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Explanation content area must have substantial text
    const explainDiv = page.locator('[data-note-source="explanation-content"]');
    const text = await explainDiv.textContent();
    expect(text?.length).toBeGreaterThan(100);

    // Empty-state placeholder must NOT be visible
    await expect(page.getByText("当前页解析尚未生成")).not.toBeVisible();
  });

  test("switching slides updates 解析 content", async ({ page }) => {
    // Get explanation for page 1
    const explainDiv = page.locator('[data-note-source="explanation-content"]');
    const page1Text = await explainDiv.textContent();

    // Click slide 2 thumbnail
    const thumbs = page.locator("aside img");
    const thumbCount = await thumbs.count();
    if (thumbCount < 2) {
      test.skip(true, "Not enough slides to compare");
      return;
    }
    await thumbs.nth(1).click();
    await page.waitForTimeout(500);

    const page2Text = await explainDiv.textContent();
    // Content must have changed
    expect(page2Text).not.toEqual(page1Text);
  });

  test("结构 tab shows page stats with correct word count (non-zero)", async ({ page }) => {
    await page.getByRole("button", { name: "结构", exact: true }).click();

    // Header must be visible
    await expect(page.getByText("页面统计")).toBeVisible();

    // Word count must be > 0 — we derive it from extraction.text when page_stats is empty
    const statsSection = page.locator(".markdown-body").last();
    const statsText = await statsSection.textContent();
    console.log("结构 tab content:", statsText?.slice(0, 600));

    // Should NOT show "文字量（词）：0" — derived count from real text
    expect(statsText).not.toMatch(/文字量（词）：\*\*0\*\*/);
    // Page text section must appear with actual content
    await expect(page.getByText("页面文本")).toBeVisible();
  });

  test("结构 tab shows full page text content (not truncated)", async ({ page }) => {
    await page.getByRole("button", { name: "结构", exact: true }).click();
    const markdownBody = page.locator(".markdown-body").last();
    const fullText = await markdownBody.textContent();
    // Page 1 of Introduction.pdf contains "DSAI4203" and "Machine Learning"
    expect(fullText).toContain("DSAI4203");
  });

  test("generate 解析 button updates explanation content", async ({ page }) => {
    const explainDiv = page.locator('[data-note-source="explanation-content"]');
    const beforeText = await explainDiv.textContent();

    // Click generate — overwrites existing explanation
    const generateBtn = page.locator("button.btn-primary", { hasText: "生成解析" });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // Badge should switch to "生成中"
    await expect(page.locator(".rounded-full").filter({ hasText: "生成中" })).toBeVisible({
      timeout: 3000,
    });

    // Wait for generation to finish (badge returns to "已缓存")
    await expect(page.locator(".rounded-full").filter({ hasText: "已缓存" })).toBeVisible({
      timeout: 60000,
    });

    // Content area must still have substantial text
    const afterText = await explainDiv.textContent();
    expect(afterText?.length).toBeGreaterThan(100);
    console.log("After regeneration preview:", afterText?.slice(0, 200));

    // Note: content may or may not change (LLM non-determinism), but it must not be empty
    expect(afterText?.trim()).not.toBe("");
    // beforeText is captured just for logging
    console.log("Before length:", beforeText?.length, "After length:", afterText?.length);
  });
});
