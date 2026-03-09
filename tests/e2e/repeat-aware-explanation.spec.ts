import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, test } from "@playwright/test";

function createRepeatedPdf(): string {
  const dir = mkdtempSync(join(tmpdir(), "ppt-repeat-"));
  const fileName = `repeat-aware-${randomUUID()}.pdf`;
  const pdfPath = join(dir, fileName);
  const script = `
import fitz
from pathlib import Path

path = Path(r"""${pdfPath}""")
doc = fitz.open()

p1 = doc.new_page(width=1000, height=700)
p1.insert_text((64, 100), "Gradient Descent", fontsize=24)
p1.insert_text((64, 150), "- learning rate controls update size", fontsize=20)
p1.insert_text((64, 185), "- update rule moves opposite gradient", fontsize=20)

p2 = doc.new_page(width=1000, height=700)
p2.insert_text((64, 100), "Gradient Descent", fontsize=24)
p2.insert_text((64, 150), "- learning rate controls update size", fontsize=20)
p2.insert_text((64, 185), "- update rule moves opposite gradient", fontsize=20)
p2.insert_text((64, 220), "- convergence depends on step size", fontsize=20)

doc.save(path)
`;
  execFileSync("python", ["-c", script], { stdio: "inherit" });
  return pdfPath;
}

test("repeat-aware explanation shows collapsed repeated section on repeated slide", async ({ page }) => {
  const pdfPath = createRepeatedPdf();
  const fileName = basename(pdfPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles(pdfPath);

  await expect(page.locator("aside button").filter({ hasText: new RegExp(fileName) }).first()).toBeVisible({
    timeout: 30000,
  });

  await expect(page.locator(".rounded-full").filter({ hasText: /P1\/2/ })).toBeVisible({
    timeout: 30000,
  });

  const thumbs = page.locator("aside img");
  await expect(thumbs).toHaveCount(2, { timeout: 10000 });
  await thumbs.nth(1).click();

  await expect(page.locator(".rounded-full").filter({ hasText: /P2\/2/ })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText(/重复 \d+% · 来自第 1 页/)).toBeVisible({ timeout: 10000 });

  const repeatDetails = page.locator("details").filter({ has: page.getByText("重复部分讲解") }).first();
  await expect(repeatDetails).toBeVisible();
  await expect(repeatDetails).not.toHaveAttribute("open", /open/);

  await repeatDetails.locator("summary").click();
  await expect(repeatDetails).toHaveAttribute("open", "");
  await expect(repeatDetails).toContainText("第 1 页");
});
