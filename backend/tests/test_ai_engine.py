import json

import httpx
import pytest
from pydantic import ValidationError

from backend import ai_engine


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def install_fake_groq(monkeypatch, content=None, status_code=200, failure=None):
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        if failure is not None:
            raise failure
        return FakeResponse(
            status_code=status_code,
            payload={"choices": [{"message": {"content": content}}]},
        )

    monkeypatch.setattr(ai_engine.httpx, "post", fake_post)
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setenv("GROQ_MODEL", "openai/gpt-oss-20b")
    return calls


def test_question_generation_uses_groq_json_mode_and_rejects_wrong_difficulty(monkeypatch):
    calls = install_fake_groq(
        monkeypatch,
        content=json.dumps({
            "questions": [{
                "question": "Explain how you would test a Python API.",
                "category": "Testing",
                "difficulty": "Advanced",
            }]
        }),
    )

    with pytest.raises(ai_engine.AIServiceError, match="different difficulty"):
        ai_engine.generate_questions("Python Developer", "Technical", "Beginner", 1, "Python")

    assert calls[0]["url"] == ai_engine.GROQ_API_URL
    assert calls[0]["headers"]["Authorization"] == "Bearer test-groq-key"
    assert calls[0]["json"]["model"] == "openai/gpt-oss-20b"
    assert calls[0]["json"]["response_format"] == {"type": "json_object"}


def test_question_generation_parses_json_text_and_strips_fields(monkeypatch):
    install_fake_groq(
        monkeypatch,
        content=json.dumps({
            "questions": [{
                "question": "  Explain how you would test a Python API.  ",
                "category": "  Testing  ",
                "difficulty": "Intermediate",
            }]
        }),
    )

    result = ai_engine.generate_questions("Python Developer", "Technical", "Intermediate", 1, "")

    assert result[0].question == "Explain how you would test a Python API."
    assert result[0].category == "Testing"


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("", "empty response"),
        ("not JSON", "invalid JSON"),
    ],
)
def test_invalid_provider_text_is_reported_without_fallback(monkeypatch, content, message):
    install_fake_groq(monkeypatch, content=content)

    with pytest.raises(ai_engine.AIServiceError, match=message):
        ai_engine.generate_questions("Python Developer", "Technical", "Beginner", 1, "")


def test_evaluation_rejects_non_finite_scores_and_unexpected_fields(monkeypatch):
    install_fake_groq(
        monkeypatch,
        content=json.dumps({
            "overall_score": 8,
            "technical_accuracy": 5,
            "relevance": 5,
            "clarity": 5,
            "completeness": 5,
            "strengths": ["Clear explanation"],
            "weaknesses": ["Add an example"],
            "improved_answer": "A more complete answer with a relevant example.",
            "recommendations": ["Explain the trade-off."],
            "unrequested_field": "ignore this",
        }),
    )

    with pytest.raises(ai_engine.AIServiceError, match="unexpected format"):
        ai_engine.evaluate_answer(
            "Python Developer",
            "How would you test this API?",
            "Testing",
            "Intermediate",
            "I would use unit tests.",
        )


def test_generated_models_reject_extra_fields_and_blank_feedback():
    with pytest.raises(ValidationError):
        ai_engine.GeneratedQuestion.model_validate(
            {
                "question": "Explain how you would test a Python API.",
                "category": "Testing",
                "difficulty": "Beginner",
                "unexpected": "field",
            }
        )

    with pytest.raises(ValidationError):
        ai_engine.GeneratedEvaluation.model_validate(
            {
                "overall_score": float("nan"),
                "technical_accuracy": 5,
                "relevance": 5,
                "clarity": 5,
                "completeness": 5,
                "strengths": ["   "],
                "weaknesses": ["Add an example"],
                "improved_answer": "A more complete answer with a relevant example.",
                "recommendations": ["Explain the trade-off."],
            }
        )


def test_study_plan_rejects_duplicate_days(monkeypatch):
    install_fake_groq(
        monkeypatch,
        content=json.dumps({
            "tasks": [
                {"day": 1, "topic": "Testing", "task": "Write focused unit tests.", "resources": ["pytest documentation"]},
                {"day": 1, "topic": "Review", "task": "Review API design decisions.", "resources": ["FastAPI documentation"]},
            ]
        }),
    )

    with pytest.raises(ai_engine.AIServiceError, match="incomplete schedule"):
        ai_engine.generate_study_tasks("Python Developer", "Python", "", "Beginner", 2)


def test_provider_errors_are_reported_with_actionable_messages(monkeypatch):
    status_scenarios = [
        (401, "rejected the API key"),
        (403, "rejected the API key"),
        (429, "rate-limiting"),
        (400, "rejected this request"),
        (503, "temporarily unavailable"),
    ]
    for status_code, message in status_scenarios:
        install_fake_groq(monkeypatch, status_code=status_code, content="{}")
        with pytest.raises(ai_engine.AIServiceError, match=message):
            ai_engine.generate_questions("Python Developer", "Technical", "Beginner", 1, "")

    install_fake_groq(monkeypatch, failure=httpx.ReadTimeout("timed out"))
    with pytest.raises(ai_engine.AIServiceError, match="timed out"):
        ai_engine.generate_questions("Python Developer", "Technical", "Beginner", 1, "")

    install_fake_groq(monkeypatch, failure=httpx.ConnectError("network down"))
    with pytest.raises(ai_engine.AIServiceError, match="Could not connect to Groq"):
        ai_engine.generate_questions("Python Developer", "Technical", "Beginner", 1, "")


def test_missing_api_key_fails_before_http_call(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    with pytest.raises(ai_engine.AIServiceError, match="not configured"):
        ai_engine.generate_questions("Python Developer", "Technical", "Beginner", 1, "")
