from __future__ import annotations

import json
import time
from pathlib import Path
from urllib import request
from urllib.error import HTTPError

from playwright.sync_api import Page, expect, sync_playwright

APP_URL = "http://127.0.0.1:3000"
API_URL = "http://127.0.0.1:8000"
OUTPUT_DIR = Path("/Users/shihaochen/github/Teaching-Learning-/output/playwright")
TEMP_UPLOAD = Path("/tmp/ppt-ui-smoke-upload.png")
TEMP_FILENAME = "ppt-ui-smoke-upload.png"


class SmokeFailure(RuntimeError):
    pass


def ensure_temp_upload() -> None:
    cleanup_temp_documents()

    try:
        documents = json.loads(request.urlopen(f"{API_URL}/api/v1/documents").read().decode("utf-8"))["documents"]
    except HTTPError as exc:
        raise SmokeFailure(f"failed to fetch documents for upload fixture: {exc}") from exc

    ready_doc = next((doc for doc in documents if doc["status"] == "ready"), None)
    require(ready_doc is not None, "no ready document available to prepare upload fixture")

    slides_payload = json.loads(
        request.urlopen(f"{API_URL}/api/v1/documents/{ready_doc['id']}/slides").read().decode("utf-8")
    )
    slide = slides_payload["slides"][0]
    image_url = slide["image_url"]
    if image_url.startswith("/"):
        image_url = f"{API_URL}{image_url}"

    TEMP_UPLOAD.write_bytes(request.urlopen(image_url).read())


def get_ready_document_filename(*, exclude_filename: str | None = None) -> str:
    try:
        documents = json.loads(request.urlopen(f"{API_URL}/api/v1/documents").read().decode("utf-8"))["documents"]
    except HTTPError as exc:
        raise SmokeFailure(f"failed to fetch documents for ready fixture: {exc}") from exc

    for document in documents:
        if document["status"] != "ready":
            continue
        if exclude_filename and document["filename"] == exclude_filename:
            continue
        return str(document["filename"])
    raise SmokeFailure("no ready document available for smoke test")


def cleanup_temp_documents() -> None:
    try:
        documents = json.loads(request.urlopen(f"{API_URL}/api/v1/documents").read().decode("utf-8"))["documents"]
    except HTTPError as exc:
        raise SmokeFailure(f"failed to fetch documents for cleanup: {exc}") from exc

    for document in documents:
        if document["filename"] != TEMP_FILENAME:
            continue
        req = request.Request(f"{API_URL}/api/v1/documents/{document['id']}", method="DELETE")
        request.urlopen(req).read()


def log(message: str) -> None:
    print(f"[smoke] {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def wait_for_endpoint(
    page: Page,
    responses: list[tuple[str, str, int]],
    *,
    from_index: int,
    method: str,
    path_fragment: str,
    status: int = 200,
    timeout: int = 20_000,
) -> None:
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if any(
            response_method == method and path_fragment in response_url and response_status == status
            for response_method, response_url, response_status in responses[from_index:]
        ):
            return
        page.wait_for_timeout(150)
    raise SmokeFailure(f"timed out waiting for {method} {path_fragment} -> {status}")


def open_ready_document(page: Page, filename: str) -> None:
    card = page.locator("article", has_text=filename).first
    expect(card).to_be_visible(timeout=15_000)
    card.locator("button").first.click()
    page.wait_for_load_state("networkidle")
    expect(page.locator("text=当前页：")).to_be_visible(timeout=15_000)


def select_note_preview_text(page: Page) -> None:
    selected = page.evaluate(
        """
        () => {
          const root = document.querySelector('[data-note-source="explanation-content"]');
          const target = root?.querySelector('h1, h2, h3, p, li');
          if (!target) return '';
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(target);
          selection.removeAllRanges();
          selection.addRange(range);
          return selection.toString();
        }
        """
    )
    require(bool(selected), "failed to select preview text for notes append test")


def draw_roi(page: Page) -> None:
    slide_image = page.locator("img[draggable='false']").first
    expect(slide_image).to_be_visible(timeout=15_000)
    box = slide_image.bounding_box()
    require(box is not None, "slide image has no bounding box")
    start_x = box["x"] + box["width"] * 0.2
    start_y = box["y"] + box["height"] * 0.2
    end_x = box["x"] + box["width"] * 0.6
    end_y = box["y"] + box["height"] * 0.55
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(end_x, end_y, steps=10)
    page.mouse.up()


def run_smoke() -> None:
    ensure_temp_upload()
    ready_doc = get_ready_document_filename(exclude_filename=TEMP_FILENAME)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 980})
        page.on("console", lambda msg: print(f"[console:{msg.type}] {msg.text}"))
        responses: list[tuple[str, str, int]] = []
        page.on(
            "response",
            lambda response: responses.append((response.request.method, response.url, response.status)),
        )

        log("open app")
        page.goto(APP_URL, wait_until="networkidle")
        page.screenshot(path=str(OUTPUT_DIR / "smoke-home.png"), full_page=True)
        expect(page.get_by_text("PPT 学习工作台")).to_be_visible()

        log("upload temp document")
        with page.expect_response(
            lambda response: response.request.method == "POST"
            and "/api/v1/documents/upload" in response.url
            and response.status == 202,
            timeout=20_000,
        ):
            page.locator("input[type='file']").set_input_files(str(TEMP_UPLOAD))

        temp_card = page.locator("article", has_text=TEMP_FILENAME).first
        expect(temp_card).to_be_visible(timeout=20_000)
        expect(temp_card.get_by_text("ready")).to_be_visible(timeout=20_000)

        log("delete temp document")
        page.once("dialog", lambda dialog: dialog.accept())
        response_index = len(responses)
        temp_card.get_by_role("button", name="删除").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="DELETE",
            path_fragment="/api/v1/documents/",
        )
        expect(temp_card).to_have_count(0, timeout=20_000)

        log("load ready document")
        open_ready_document(page, ready_doc)
        page.screenshot(path=str(OUTPUT_DIR / "smoke-loaded-document.png"), full_page=True)

        log("verify extraction panel and generation controls")
        doc_card = page.locator("article", has_text=ready_doc).first
        expect(doc_card.get_by_role("button", name="整份生成讲解")).to_be_visible(timeout=15_000)
        page.get_by_role("button", name="讲解", exact=True).click()
        expect(page.get_by_role("button", name="生成本页讲解")).to_be_visible(timeout=15_000)
        expect(page.get_by_text("Current Page Extraction")).to_be_visible(timeout=15_000)

        log("regenerate current page explanation")
        response_index = len(responses)
        page.get_by_role("button", name="生成本页讲解").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment="/explanations/generate",
        )

        log("regenerate document explanations")
        response_index = len(responses)
        doc_card.get_by_role("button", name="整份生成讲解").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment=f"/api/v1/documents/",
        )

        log("ask question in chat")
        page.get_by_role("button", name="问答").click()
        question_box = page.get_by_placeholder("输入追问，Ctrl/⌘+Enter 发送")
        question_box.fill("用一句话总结这一页。")
        response_index = len(responses)
        page.get_by_role("button", name="发送问题").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment="/api/v1/chat",
        )
        expect(page.get_by_text("用一句话总结这一页。", exact=True).first).to_be_visible(timeout=20_000)
        require(page.locator("article").count() >= 2, "chat assistant response did not render")

        log("explain ROI")
        draw_roi(page)
        roi_button = page.get_by_role("button", name="解释框选区域")
        expect(roi_button).to_be_enabled(timeout=10_000)
        response_index = len(responses)
        roi_button.click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment="/api/v1/chat/roi",
        )
        require(page.locator("article").count() >= 3, "ROI response did not render")
        page.get_by_role("button", name="讲解", exact=True).click()
        select_note_preview_text(page)

        log("notes generation and append")
        page.get_by_role("button", name="笔记").click()
        response_index = len(responses)
        page.get_by_role("button", name="自动生成笔记").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment="/api/v1/notes/autogen",
        )
        notes_editor = page.locator("textarea").last
        expect(notes_editor).not_to_have_value("", timeout=20_000)
        page.get_by_role("button", name="添加选中解释").click()
        expect(notes_editor).to_contain_text("## 选中摘录", timeout=10_000)
        page.get_by_role("button", name="格式化笔记").click()
        require(notes_editor.input_value().startswith("# "), "formatted notes should start with a markdown heading")

        log("notes and explanation export")
        response_index = len(responses)
        page.get_by_role("button", name="导出会话笔记").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment="/api/v1/notes/export",
        )
        response_index = len(responses)
        page.get_by_role("button", name="导出全部讲解MD").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="GET",
            path_fragment="/explanations/export",
        )

        log("quiz generation and grading")
        page.get_by_role("button", name="练习").click()
        response_index = len(responses)
        page.get_by_role("button", name="生成本页小测").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment="/api/v1/quizzes/generate",
        )
        expect(page.get_by_role("button", name="提交并批改")).to_be_enabled(timeout=20_000)
        response_index = len(responses)
        page.get_by_role("button", name="提交并批改").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment="/api/v1/quizzes/",
        )
        expect(page.get_by_text("批改结果将显示在这里。")).to_have_count(0, timeout=10_000)

        log("review queue and completion")
        page.get_by_role("button", name="复习").click()
        response_index = len(responses)
        page.get_by_role("button", name="刷新复习队列与分析").click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="GET",
            path_fragment="/api/v1/review/",
        )
        expect(page.get_by_text("复习间隔：").first).to_be_visible(timeout=20_000)
        response_index = len(responses)
        page.get_by_role("button", name="完全掌握").first.click()
        wait_for_endpoint(
            page,
            responses,
            from_index=response_index,
            method="POST",
            path_fragment="/api/v1/review/",
        )

        page.screenshot(path=str(OUTPUT_DIR / "smoke-review.png"), full_page=True)
        browser.close()


if __name__ == "__main__":
    run_smoke()
    log("all smoke checks passed")
