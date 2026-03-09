from types import SimpleNamespace

from app.services.repetition import analyze_repeat_window


def _asset(page_num: int, blocks: list[tuple[str, str]]) -> SimpleNamespace:
    payload_blocks = [
        {
            "id": block_id,
            "type": "text",
            "bbox": [0.0, 0.0, 10.0, 10.0],
            "text": text,
            "order": index + 1,
        }
        for index, (block_id, text) in enumerate(blocks)
    ]
    return SimpleNamespace(
        page_num=page_num,
        extract_payload={
            "summary": payload_blocks[0]["text"] if payload_blocks else "",
            "title_candidates": [],
            "text_blocks": payload_blocks,
            "bullet_blocks": [],
            "figures": [],
            "tables": [],
            "equation_like_blocks": [],
            "code_like_blocks": [],
            "reading_order": [item["id"] for item in payload_blocks],
            "page_stats": {"text_block_count": len(payload_blocks), "word_count": 20},
        },
    )


def test_analyze_repeat_window_marks_repeated_and_new_blocks() -> None:
    assets = [
        _asset(
            1,
            [
                ("text-1-1", "gradient descent updates parameters using a learning rate"),
                ("text-1-2", "the update rule moves opposite to the gradient direction"),
            ],
        ),
        _asset(
            2,
            [
                ("text-2-1", "gradient descent updates parameters using a learning rate"),
                ("text-2-2", "the update rule moves opposite to the gradient direction"),
                ("text-2-3", "convergence depends on the step size that we choose"),
            ],
        ),
    ]

    analyze_repeat_window(assets, window_size=3, repeated_ratio_threshold=0.30)

    repeat_analysis = assets[1].extract_payload["repeat_analysis"]
    assert repeat_analysis["status"] == "ready"
    assert repeat_analysis["repeat_pages"] == [1]
    assert repeat_analysis["repeated_block_ids"] == ["text-2-1", "text-2-2"]
    assert repeat_analysis["new_block_ids"] == ["text-2-3"]
    assert repeat_analysis["repeated_ratio"] > 0.30
