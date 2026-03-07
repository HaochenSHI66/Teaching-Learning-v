from pathlib import Path

from PIL import Image

from app.services.model_gateway import ModelGateway


def _make_image(path: Path, color: tuple[int, int, int]) -> Path:
    image = Image.new("RGB", (320, 200), color=color)
    image.save(path, format="PNG")
    return path


def test_gateway_builds_multimodal_slide_payload(tmp_path: Path) -> None:
    slide_image = _make_image(tmp_path / "slide.png", (245, 240, 232))
    gateway = ModelGateway(api_key="key", base_url="https://example.com/v1", model="gpt-4o")

    payload = gateway.build_slide_payload(
        prompt="请讲解这一页",
        slide_image_path=slide_image,
        extraction_text="Title: Gradient Descent",
    )

    content = payload["messages"][0]["content"]
    assert content[0]["type"] == "text"
    assert "Gradient Descent" in content[0]["text"]
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_gateway_builds_multimodal_roi_payload(tmp_path: Path) -> None:
    slide_image = _make_image(tmp_path / "slide.png", (240, 245, 232))
    roi_image = _make_image(tmp_path / "roi.png", (232, 240, 245))
    gateway = ModelGateway(api_key="key", base_url="https://example.com/v1", model="gpt-4o")

    payload = gateway.build_roi_payload(
        prompt="请解释框选区域",
        slide_image_path=slide_image,
        roi_image_path=roi_image,
        extraction_text="Figure Region 1",
    )

    content = payload["messages"][0]["content"]
    image_entries = [item for item in content if item["type"] == "image_url"]
    assert len(image_entries) == 2
    assert "Figure Region 1" in content[0]["text"]
