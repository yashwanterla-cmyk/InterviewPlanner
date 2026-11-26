from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend import ai_engine, auth as auth_module, main as main_module
from backend import database as database_module
from backend.database import Base, get_db
from backend.main import app


@pytest.fixture()
def client(monkeypatch):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestSession = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


def register(client: TestClient, email: str = "candidate@example.com") -> str:
    response = client.post(
        "/api/auth/register",
        json={"full_name": "Test Candidate", "email": email, "password": "secure-pass-123"},
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_registration_login_and_profile(client):
    token = register(client)
    duplicate = client.post(
        "/api/auth/register",
        json={"full_name": "Test Candidate", "email": "candidate@example.com", "password": "secure-pass-123"},
    )
    assert duplicate.status_code == 409

    login = client.post("/api/auth/login", json={"email": "candidate@example.com", "password": "secure-pass-123"})
    assert login.status_code == 200
    assert login.json()["user"]["email"] == "candidate@example.com"
    assert client.post("/api/auth/login", json={"email": "candidate@example.com", "password": "wrong-pass"}).status_code == 401

    saved = client.put(
        "/api/profile",
        headers=auth(token),
        json={
            "full_name": "Taylor Candidate",
            "education": "B.Tech Computer Science",
            "skills": "Python, SQL",
            "experience_level": "Entry level",
            "preferred_role": "Python Developer",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["skills"] == "Python, SQL"
    assert client.get("/api/profile").status_code == 401


def test_google_sign_in_creates_and_reuses_user(client, monkeypatch):
    identity = {
        "sub": "google-sub-123",
        "email": "google@example.com",
        "name": "Google Candidate",
        "picture_url": "https://example.com/avatar.png",
    }
    monkeypatch.setattr(main_module, "verify_google_id_token", lambda _credential: identity)

    first = client.post("/api/auth/google", json={"credential": "a" * 24})
    assert first.status_code == 200
    assert first.json()["user"]["full_name"] == "Google Candidate"
    assert first.json()["user"]["picture_url"] == identity["picture_url"]

    again = client.post("/api/auth/google", json={"credential": "b" * 24})
    assert again.status_code == 200
    assert again.json()["user"]["id"] == first.json()["user"]["id"]
    assert client.get("/api/profile", headers=auth(first.json()["access_token"])).json()["email"] == identity["email"]


def test_google_sign_in_links_existing_verified_email(client, monkeypatch):
    token = register(client, "linked@example.com")
    monkeypatch.setattr(
        main_module,
        "verify_google_id_token",
        lambda _credential: {
            "sub": "google-sub-linked",
            "email": "linked@example.com",
            "name": "Linked Candidate",
            "picture_url": "",
        },
    )
    response = client.post("/api/auth/google", json={"credential": "c" * 24})
    assert response.status_code == 200
    local_login = client.post(
        "/api/auth/login",
        json={"email": "linked@example.com", "password": "secure-pass-123"},
    )
    assert response.json()["user"]["id"] == local_login.json()["user"]["id"]
    assert client.get("/api/profile", headers=auth(token)).json()["email"] == "linked@example.com"


def test_google_token_verification_rejects_unverified_or_wrong_issuer(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(
        auth_module.id_token,
        "verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "iss": "https://not-google.example",
            "sub": "subject",
            "email": "person@example.com",
            "email_verified": True,
            "name": "Candidate",
        },
    )
    with pytest.raises(HTTPException) as wrong_issuer:
        auth_module.verify_google_id_token("opaque-credential")
    assert wrong_issuer.value.status_code == 401

    monkeypatch.setattr(
        auth_module.id_token,
        "verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "iss": "accounts.google.com",
            "sub": "subject",
            "email": "person@example.com",
            "email_verified": False,
            "name": "Candidate",
        },
    )
    with pytest.raises(HTTPException) as unverified:
        auth_module.verify_google_id_token("opaque-credential")
    assert unverified.value.status_code == 401

    monkeypatch.setattr(
        auth_module.id_token,
        "verify_oauth2_token",
        lambda _credential, _request, audience: {
            "iss": "https://accounts.google.com",
            "sub": "verified-subject",
            "email": "Person@Example.com",
            "email_verified": True,
            "name": "Verified Candidate",
        } if audience == "client-id.apps.googleusercontent.com" else {},
    )
    identity = auth_module.verify_google_id_token("opaque-credential")
    assert identity["sub"] == "verified-subject"
    assert identity["email"] == "person@example.com"

    def expired_token(*_args, **_kwargs):
        raise ValueError("expired")

    monkeypatch.setattr(auth_module.id_token, "verify_oauth2_token", expired_token)
    with pytest.raises(HTTPException) as expired:
        auth_module.verify_google_id_token("expired-credential")
    assert expired.value.status_code == 401


def test_google_sign_in_reports_missing_configuration(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    config = client.get("/api/auth/google/config")
    assert config.status_code == 200
    assert config.json() == {"enabled": False, "client_id": None}
    response = client.post("/api/auth/google", json={"credential": "opaque-credential-with-valid-length"})
    assert response.status_code == 503
    assert "GOOGLE_CLIENT_ID" in response.json()["detail"]


def test_logout_revokes_token_and_expired_tokens_are_rejected(client):
    token = register(client)
    headers = auth(token)
    profile = client.get("/api/profile", headers=headers)
    assert profile.status_code == 200
    assert profile.headers["cache-control"] == "no-store"
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/profile", headers=headers).status_code == 401
    assert client.post("/api/auth/logout", headers=headers).status_code == 401

    expired = jwt.encode(
        {
            "sub": "1",
            "jti": "expired-token",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        auth_module.JWT_SECRET,
        algorithm=auth_module.JWT_ALGORITHM,
    )
    assert client.get("/api/profile", headers=auth(expired)).status_code == 401


def test_existing_sqlite_user_table_gets_google_columns(monkeypatch):
    legacy_engine = create_engine("sqlite://")
    with legacy_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, full_name VARCHAR(120), "
            "email VARCHAR(255), password_hash VARCHAR(255), created_at DATETIME)"
        )
    monkeypatch.setattr(database_module, "engine", legacy_engine)

    database_module.initialize_database()

    columns = {column["name"] for column in inspect(legacy_engine).get_columns("users")}
    assert {"google_sub", "picture_url"}.issubset(columns)
    legacy_engine.dispose()


def test_interview_evaluation_completion_analytics_and_history(client, monkeypatch):
    token = register(client)
    monkeypatch.setattr(
        ai_engine,
        "generate_questions",
        lambda role, kind, difficulty, count, skills: [
            ai_engine.GeneratedQuestion(question=f"Explain concept {index} in {role}.", category="Python", difficulty=difficulty)
            for index in range(count)
        ],
    )
    monkeypatch.setattr(
        ai_engine,
        "evaluate_answer",
        lambda *args: ai_engine.GeneratedEvaluation(
            overall_score=8,
            technical_accuracy=8,
            relevance=8,
            clarity=7,
            completeness=8,
            strengths=["Clear example"],
            weaknesses=["Add more detail"],
            improved_answer="A more complete answer with a relevant example.",
            recommendations=["Explain the trade-off."],
        ),
    )
    headers = auth(token)
    created = client.post(
        "/api/interviews",
        headers=headers,
        json={"role": "Python Developer", "interview_type": "Technical", "difficulty": "Intermediate", "question_count": 3},
    )
    assert created.status_code == 201
    interview = created.json()
    assert len(interview["questions"]) == 3
    assert client.post(f"/api/interviews/{interview['id']}/complete", headers=headers).status_code == 409

    for question in interview["questions"]:
        evaluated = client.post(
            f"/api/interviews/{interview['id']}/questions/{question['id']}/answer",
            headers=headers,
            json={"response": "I would use a dictionary to look up each value efficiently."},
        )
        assert evaluated.status_code == 200
        assert evaluated.json()["overall_score"] == 8
        assert evaluated.json()["improved_answer"]

    completed = client.post(f"/api/interviews/{interview['id']}/complete", headers=headers)
    assert completed.status_code == 200
    assert completed.json()["average_score"] == 8
    assert completed.json()["status"] == "completed"
    analytics = client.get("/api/analytics", headers=headers).json()
    assert analytics["interviews_completed"] == 1
    assert analytics["type_scores"] == [{"interview_type": "Technical", "score": 8.0, "count": 3}]
    history = client.get("/api/interviews", headers=headers)
    assert history.status_code == 200
    assert history.json()[0]["questions"][0]["evaluation"]["overall_score"] == 8
    assert client.get(f"/api/interviews/{interview['id']}", headers=auth(register(client, "other@example.com"))).status_code == 404


def test_ai_unavailable_does_not_create_interview(client, monkeypatch):
    token = register(client)

    def unavailable(*_args):
        raise ai_engine.AIServiceError("AI is not configured.")

    monkeypatch.setattr(ai_engine, "generate_questions", unavailable)
    response = client.post(
        "/api/interviews",
        headers=auth(token),
        json={"role": "Python Developer", "interview_type": "Technical", "difficulty": "Beginner", "question_count": 3},
    )
    assert response.status_code == 503
    assert client.get("/api/interviews", headers=auth(token)).json() == []


def test_invalid_ai_evaluation_is_not_saved(client, monkeypatch):
    token = register(client)
    monkeypatch.setattr(
        ai_engine,
        "generate_questions",
        lambda role, kind, difficulty, count, skills: [
            ai_engine.GeneratedQuestion(
                question=f"Explain concept {index} in {role}.",
                category="Python",
                difficulty=difficulty,
            )
            for index in range(count)
        ],
    )
    interview = client.post(
        "/api/interviews",
        headers=auth(token),
        json={"role": "Python Developer", "interview_type": "Technical", "difficulty": "Beginner", "question_count": 3},
    ).json()

    def invalid_evaluation(*_args):
        raise ai_engine.AIServiceError("The AI returned feedback in an unexpected format.")

    monkeypatch.setattr(ai_engine, "evaluate_answer", invalid_evaluation)
    question = interview["questions"][0]
    response = client.post(
        f"/api/interviews/{interview['id']}/questions/{question['id']}/answer",
        headers=auth(token),
        json={"response": "A reasonable answer."},
    )

    assert response.status_code == 503
    saved_interview = client.get(f"/api/interviews/{interview['id']}", headers=auth(token)).json()
    assert saved_interview["questions"][0]["answer"] is None
    assert saved_interview["questions"][0]["evaluation"] is None


def test_study_plan_generation_and_task_persistence(client, monkeypatch):
    token = register(client)
    monkeypatch.setattr(
        ai_engine,
        "generate_study_tasks",
        lambda role, skills, weak_areas, difficulty, days: [
            ai_engine.GeneratedTask(
                day=day,
                topic=f"Topic {day}",
                task=f"Practice a focused {role} exercise for day {day}.",
                resources=["Official Python documentation"],
            )
            for day in range(1, days + 1)
        ],
    )
    headers = auth(token)
    response = client.post(
        "/api/study-plans",
        headers=headers,
        json={"role": "Python Developer", "days": 3, "difficulty": "Intermediate", "skills": "Python", "weak_areas": "Testing"},
    )
    assert response.status_code == 201
    plan = response.json()
    assert len(plan["tasks"]) == 3
    assert plan["tasks"][0]["resources"] == ["Official Python documentation"]
    updated = client.patch(f"/api/study-tasks/{plan['tasks'][0]['id']}", headers=headers, json={"completed": True})
    assert updated.status_code == 200
    assert updated.json()["tasks"][0]["completed"] is True
    assert client.get("/api/study-plans/latest", headers=headers).json()["tasks"][0]["completed"] is True
