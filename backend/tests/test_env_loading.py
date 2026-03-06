from __future__ import annotations

from pathlib import Path

from app.main import create_app


def _cors_allow_origins(app) -> list[str]:
    for middleware in app.user_middleware:
        if middleware.cls.__name__ == "CORSMiddleware":
            return list(middleware.kwargs.get("allow_origins", []))
    return []


def test_create_app_loads_env_file_for_cors(tmp_path, monkeypatch):
    storage_dir = tmp_path / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)

    env_path = tmp_path / ".env"
    env_path.write_text("CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000\n", encoding="utf-8")

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    app = create_app(
        database_url=f"sqlite:///{(storage_dir / 'app.db').as_posix()}",
        storage_dir=storage_dir,
    )

    assert _cors_allow_origins(app) == ["http://localhost:3000", "http://127.0.0.1:3000"]
