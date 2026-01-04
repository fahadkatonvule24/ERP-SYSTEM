import os
import sys
from pathlib import Path
from datetime import datetime, timedelta

os.environ["DATABASE_URL"] = "sqlite:///./test_api.db"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["ALLOWED_ORIGINS"] = '["http://testserver"]'

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402
from app.database import Base, engine, SessionLocal  # noqa: E402
from app.main import seed_admin  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


# reset database for tests
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
seed_admin()

client = TestClient(app)


def test_login_and_refresh_flow():
    # seed_admin runs at startup; use default admin creds
    resp = client.post("/auth/token", data={"username": "admin@example.com", "password": "changeme"})
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body and "refresh_token" in body

    refresh_resp = client.post("/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert refresh_resp.status_code == 200
    refreshed = refresh_resp.json()
    assert refreshed["access_token"] != body["access_token"]
    assert refreshed["refresh_token"] != body["refresh_token"]


def test_refresh_rejects_revoked_token():
    resp = client.post("/auth/token", data={"username": "admin@example.com", "password": "changeme"})
    refresh_token = resp.json()["refresh_token"]
    # logout to revoke
    logout_resp = client.post("/auth/logout", json={"refresh_token": refresh_token})
    assert logout_resp.status_code == 204
    # attempt refresh should fail
    refresh_resp = client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert refresh_resp.status_code == 401
