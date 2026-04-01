import os
os.environ.setdefault("JWT_SECRET", "test-secret-for-unit-tests")

import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session
from app.main import create_app
from app.models import Document