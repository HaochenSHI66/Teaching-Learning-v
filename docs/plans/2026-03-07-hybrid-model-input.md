# Hybrid Model Input Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace template-only explanations with a real multimodal generation path that uses slide screenshots plus deterministic extraction, while preserving cached upload-time explanations and server-only prompt handling.

**Architecture:** Add a provider-agnostic `ModelGateway` that calls an OpenAI-compatible multimodal endpoint using `API_KEY`, `BASE_URL`, and `MODEL`. Route upload-time generation, single-page regeneration, and ROI explanation through the gateway, but keep the existing deterministic template builders as degraded fallback.

**Tech Stack:** FastAPI, SQLModel, PyMuPDF, httpx, Next.js 15, pytest, Playwright smoke

---

### Task 1: Add A Real Model Gateway

**Files:**
- Create: `/Users/shihaochen/github/Teaching-Learning-/backend/app/services/model_gateway.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/pyproject.toml`
- Test: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_model_gateway.py`

**Step 1: Write the failing test**

```python
def test_gateway_builds_multimodal_chat_payload(tmp_path):
    payload = build_slide_chat_payload(...)
    assert payload["messages"][0]["content"][0]["type"] == "text"
    assert payload["messages"][0]["content"][1]["type"] == "image_url"
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_model_gateway.py`

Expected: FAIL because the gateway does not exist yet.

**Step 3: Write minimal implementation**

```python
class ModelGateway:
    def generate_markdown(...):
        response = httpx.post(...)
        return extract_markdown(response.json())
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_model_gateway.py`

Expected: PASS

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/services/model_gateway.py backend/pyproject.toml backend/tests/test_model_gateway.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add multimodal model gateway"
```

### Task 2: Route Slide Explanations Through The Gateway With Fallback

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/services/explanation_engine.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/services/explanation_cache.py`
- Test: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_cached_explanations_and_notes.py`

**Step 1: Write the failing test**

```python
def test_slide_generation_uses_gateway_and_falls_back_when_gateway_fails(...):
    gateway = FailingGateway()
    markdown, degraded = generate_slide_markdown(..., gateway=gateway)
    assert degraded is True
    assert "Prompt Contract" not in markdown
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_cached_explanations_and_notes.py -k gateway`

Expected: FAIL because the generation path is still template-only.

**Step 3: Write minimal implementation**

```python
try:
    markdown = gateway.generate_slide_explanation(...)
    degraded = False
except Exception:
    markdown = build_cached_slide_explanation(...)
    degraded = True
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_cached_explanations_and_notes.py -k gateway`

Expected: PASS

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/services/explanation_engine.py backend/app/services/explanation_cache.py backend/tests/test_cached_explanations_and_notes.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: route slide explanations through model gateway"
```

### Task 3: Upgrade Upload-Time And Regeneration Flows

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/api/documents.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_documents_api.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_end_to_end_flow.py`

**Step 1: Write the failing test**

```python
def test_upload_generates_cached_explanations_via_gateway_or_fallback(...):
    explanations = client.get(f"/api/v1/documents/{doc_id}/explanations").json()
    assert explanations["explanations"]
```

Add a regeneration test that patches the gateway and verifies overwrite.

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_documents_api.py tests/test_end_to_end_flow.py`

Expected: FAIL while the upload flow still ignores the gateway.

**Step 3: Write minimal implementation**

```python
markdown, degraded = generate_slide_markdown_from_assets(...)
session.add(SlideExplanation(markdown=markdown))
```

Apply the same helper to single-slide regeneration and document-wide regeneration.

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_documents_api.py tests/test_end_to_end_flow.py`

Expected: PASS

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/api/documents.py backend/tests/test_documents_api.py backend/tests/test_end_to_end_flow.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: use gateway for upload and regeneration flows"
```

### Task 4: Upgrade ROI To Multimodal Input

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/api/chat.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/services/explanation_engine.py`
- Test: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_learning_flow_api.py`

**Step 1: Write the failing test**

```python
def test_roi_chat_uses_roi_crop_and_full_slide_context(...):
    response = client.post("/api/v1/chat/roi", json=payload)
    assert response.status_code == 200
```

Patch the gateway in the test and assert that both crop and full-slide inputs were prepared.

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_learning_flow_api.py -k roi`

Expected: FAIL because ROI is still deterministic only.

**Step 3: Write minimal implementation**

```python
markdown = gateway.generate_roi_explanation(
    crop_path=...,
    slide_path=...,
    extraction_text=...,
)
```

Fallback remains the current deterministic ROI explanation builder.

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_learning_flow_api.py -k roi`

Expected: PASS

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/api/chat.py backend/app/services/explanation_engine.py backend/tests/test_learning_flow_api.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add multimodal roi explanations"
```

### Task 5: Verify Frontend Compatibility

**Files:**
- Verify: `/Users/shihaochen/github/Teaching-Learning-/frontend`
- Verify: `/Users/shihaochen/github/Teaching-Learning-/scripts/playwright_smoke.py`

**Step 1: Run backend test suite**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q`

Expected: all tests pass

**Step 2: Run frontend production build**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/frontend && npm run build`

Expected: successful build with no type regressions

**Step 3: Run browser smoke**

Run: `cd /Users/shihaochen/github/Teaching-Learning- && python scripts/playwright_smoke.py`

Expected: `all smoke checks passed`

**Step 4: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add scripts/playwright_smoke.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "test: verify multimodal explanation workflow"
```
