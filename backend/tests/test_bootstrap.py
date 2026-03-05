from importlib import import_module


def test_can_import_fastapi_app() -> None:
    module = import_module("app.main")
    assert hasattr(module, "app")
