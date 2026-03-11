import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CALCULUS_PDF_BASE64 =
  "JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjcuMQoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjcuMSk+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDwvRm9udDw8L2hlbHYgNSAwIFI+Pj4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYwMCA0MDBdL1JvdGF0ZSAwL1Jlc291cmNlcyAzIDAgUi9QYXJlbnQgMiAwIFIvQ29udGVudHNbNiAwIFIgNyAwIFIgOCAwIFJdPj4KZW5kb2JqCgo1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYS9FbmNvZGluZy9XaW5BbnNpRW5jb2Rpbmc+PgplbmRvYmoKCjYgMCBvYmoKPDwvTGVuZ3RoIDY0Pj4Kc3RyZWFtCgpxCkJUCjEgMCAwIDEgNzIgMzAwIFRtCi9oZWx2IDI0IFRmIFs8NDM2MTZjNjM3NTZjNzU3Mz5dVEoKRVQKUQoKZW5kc3RyZWFtCmVuZG9iagoKNyAwIG9iago8PC9MZW5ndGggNzA+PgpzdHJlYW0KCnEKQlQKMSAwIDAgMSA3MiAyNTAgVG0KL2hlbHYgMTggVGYgWzwyZDIwNzQ2ZjcwNjk2MzIwNmY2ZTY1Pl1USgpFVApRCgplbmRzdHJlYW0KZW5kb2JqCgo4IDAgb2JqCjw8L0xlbmd0aCA3MD4+CnN0cmVhbQoKcQpCVAoxIDAgMCAxIDcyIDIyMCBUbQovaGVsdiAxOCBUZiBbPDJkMjA3NDZmNzA2OTYzMjA3NDc3NmY+XVRKCkVUClEKCmVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA0MiAwMDAwMCBuIAowMDAwMDAwMTIwIDAwMDAwIG4gCjAwMDAwMDAxNzIgMDAwMDAgbiAKMDAwMDAwMDIxMyAwMDAwMCBuIAowMDAwMDAwMzMyIDAwMDAwIG4gCjAwMDAwMDA0MjEgMDAwMDAgbiAKMDAwMDAwMDUzNCAwMDAwMCBuIAowMDAwMDAwNjUzIDAwMDAwIG4gCgp0cmFpbGVyCjw8L1NpemUgOS9Sb290IDEgMCBSL0lEWzxDMzhEMzMwMUMyQkMxRkMyOTVDMzkwQzI4OUMzQjlDMj48QTJCNDdGMDA2MTFDNTAxODM5MTBGMTFGNTJFQzkyMTk+XT4+CnN0YXJ0eHJlZgo3NzIKJSVFT0YK";
const ALGEBRA_PDF_BASE64 =
  "JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjcuMQoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjcuMSk+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDwvRm9udDw8L2hlbHYgNSAwIFI+Pj4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYwMCA0MDBdL1JvdGF0ZSAwL1Jlc291cmNlcyAzIDAgUi9QYXJlbnQgMiAwIFIvQ29udGVudHNbNiAwIFIgNyAwIFIgOCAwIFJdPj4KZW5kb2JqCgo1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYS9FbmNvZGluZy9XaW5BbnNpRW5jb2Rpbmc+PgplbmRvYmoKCjYgMCBvYmoKPDwvTGVuZ3RoIDYyPj4Kc3RyZWFtCgpxCkJUCjEgMCAwIDEgNzIgMzAwIFRtCi9oZWx2IDI0IFRmIFs8NDE2YzY3NjU2MjcyNjE+XVRKCkVUClEKCmVuZHN0cmVhbQplbmRvYmoKCjcgMCBvYmoKPDwvTGVuZ3RoIDcwPj4Kc3RyZWFtCgpxCkJUCjEgMCAwIDEgNzIgMjUwIFRtCi9oZWx2IDE4IFRmIFs8MmQyMDc0NmY3MDY5NjMyMDZmNmU2NT5dVEoKRVQKUQoKZW5kc3RyZWFtCmVuZG9iagoKOCAwIG9iago8PC9MZW5ndGggNzA+PgpzdHJlYW0KCnEKQlQKMSAwIDAgMSA3MiAyMjAgVG0KL2hlbHYgMTggVGYgWzwyZDIwNzQ2ZjcwNjk2MzIwNzQ3NzZmPl1USgpFVApRCgplbmRzdHJlYW0KZW5kb2JqCgp4cmVmCjAgOQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNDIgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAyMTMgMDAwMDAgbiAKMDAwMDAwMDMzMiAwMDAwMCBuIAowMDAwMDAwNDIxIDAwMDAwIG4gCjAwMDAwMDA1MzIgMDAwMDAgbiAKMDAwMDAwMDY1MSAwMDAwMCBuIAoKdHJhaWxlcgo8PC9TaXplIDkvUm9vdCAxIDAgUi9JRFs8QzI5QTEzQzJCREMzOEZDMzk2MzA3M0MzOUY0QUMyOTc+PEJBMTY2NUM0NkY1RDBEN0Q4M0VGNzQ1Njg3OTI4MTY1Pl0+PgpzdGFydHhyZWYKNzcwCiUlRU9GCg==";

function writeBinary(dir: string, name: string, base64: string): string {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name);
  writeFileSync(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

function seedReadyDocument(filename: string) {
  const dbPath = join(process.cwd(), "backend", "storage", "app.db");
  execFileSync("python3", [
    "-c",
    `
import sqlite3, sys, uuid
from datetime import datetime, timezone

db_path, filename = sys.argv[1], sys.argv[2]
connection = sqlite3.connect(db_path)
connection.execute(
    "INSERT INTO document (id, filename, media_type, storage_path, folder_id, sort_order, status, page_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (
        str(uuid.uuid4()),
        filename,
        "application/pdf",
        "",
        None,
        (connection.execute("SELECT COALESCE(MAX(sort_order), -1) FROM document WHERE folder_id IS NULL").fetchone()[0] or 0) + 1,
        "ready",
        1,
        datetime.now(timezone.utc).isoformat(),
    ),
)
connection.commit()
connection.close()
`,
    dbPath,
    filename,
  ]);
}

async function waitForSeededDocuments(page: Page, filenames: string[]) {
  await expect
    .poll(async () => {
      const response = await page.request.get("http://127.0.0.1:8000/api/v1/documents");
      const payload = await response.json();
      const existing = new Set((payload.documents ?? []).map((item: { filename?: string }) => item.filename));
      return filenames.every((filename) => existing.has(filename));
    }, { timeout: 15000 })
    .toBeTruthy();

  await page.reload();
  await page.waitForLoadState("networkidle");
}

async function dragToFolder(page: Page, documentName: string, folderName: string) {
  const source = page.getByTestId(`document-item-${documentName}`);
  const target = page.getByTestId(`folder-target-${folderName}`);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("Drag source or target is not visible");
  }
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
}

test("documents can be grouped into folders and dragged between groups", async ({ page }, testInfo) => {
  const fixtureDir = testInfo.outputPath("folder-fixtures");
  const suffix = `${Date.now()}`;
  const calculusName = `Calculus-${suffix}.pdf`;
  const algebraName = `Algebra-${suffix}.pdf`;
  const folderName = `Mathematics-${suffix}`;
  writeBinary(fixtureDir, calculusName, CALCULUS_PDF_BASE64);
  writeBinary(fixtureDir, algebraName, ALGEBRA_PDF_BASE64);
  seedReadyDocument(calculusName);
  seedReadyDocument(algebraName);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await waitForSeededDocuments(page, [calculusName, algebraName]);
  await expect(page.locator("aside")).toContainText(calculusName, { timeout: 15000 });
  await expect(page.locator("aside")).toContainText(algebraName, { timeout: 15000 });

  await page.getByRole("button", { name: "新建文件夹" }).click();
  await page.getByPlaceholder("文件夹名称").fill(folderName);
  await page.getByRole("button", { name: "创建文件夹" }).click();

  await expect(page.getByTestId(`folder-dropzone-${folderName}`)).toBeVisible();
  await dragToFolder(page, calculusName, folderName);

  await expect(page.getByTestId(`folder-dropzone-${folderName}`)).toContainText(calculusName);
  await expect(page.getByTestId("uncategorized-dropzone")).toContainText(algebraName);
  await expect(page.getByTestId("uncategorized-dropzone")).not.toContainText(calculusName);
});

test("dragging shows overlay preview and target highlight feedback", async ({ page }, testInfo) => {
  const fixtureDir = testInfo.outputPath("folder-fixtures-feedback");
  const suffix = `${Date.now()}`;
  const calculusName = `Calculus-Feedback-${suffix}.pdf`;
  const folderName = `Feedback-${suffix}`;
  writeBinary(fixtureDir, calculusName, CALCULUS_PDF_BASE64);
  seedReadyDocument(calculusName);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await waitForSeededDocuments(page, [calculusName]);
  await expect(page.locator("aside")).toContainText(calculusName, { timeout: 15000 });

  await page.getByRole("button", { name: "新建文件夹" }).click();
  await page.getByPlaceholder("文件夹名称").fill(folderName);
  await page.getByRole("button", { name: "创建文件夹" }).click();

  const source = page.getByTestId(`document-item-${calculusName}`);
  const target = page.getByTestId(`folder-target-${folderName}`);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("Drag source or target is not visible");
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 20, sourceBox.y + 18, { steps: 6 });

  await expect(page.getByTestId("document-drag-overlay")).toBeVisible();
  await expect(source).toHaveAttribute("data-drag-state", "source");

  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 12,
  });
  await expect(target).toHaveAttribute("data-drag-over", "true");

  await page.mouse.up();

  await expect(page.getByTestId("document-drag-overlay")).toHaveCount(0);
  await expect(page.getByTestId(`folder-dropzone-${folderName}`)).toContainText(calculusName);
});
