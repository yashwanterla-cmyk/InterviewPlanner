import json
import os
from typing import Annotated, Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b"


class AIServiceError(Exception):
    pass


class _GeneratedOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


InterviewDifficulty = Literal["Beginner", "Intermediate", "Advanced"]
FeedbackText = Annotated[str, Field(min_length=3, max_length=500)]
ResourceTitle = Annotated[str, Field(min_length=2, max_length=180)]


class GeneratedQuestion(_GeneratedOutput):
    question: str = Field(min_length=10, max_length=1000)
    category: str = Field(min_length=2, max_length=80)
    difficulty: InterviewDifficulty


class GeneratedTask(_GeneratedOutput):
    day: int = Field(ge=1, le=30)
    topic: str = Field(min_length=2, max_length=180)
    task: str = Field(min_length=5, max_length=800)
    resources: list[ResourceTitle] = Field(min_length=1, max_length=4)


class GeneratedEvaluation(_GeneratedOutput):
    overall_score: float = Field(ge=0, le=10, allow_inf_nan=False)
    technical_accuracy: float = Field(ge=0, le=10, allow_inf_nan=False)
    relevance: float = Field(ge=0, le=10, allow_inf_nan=False)
    clarity: float = Field(ge=0, le=10, allow_inf_nan=False)
    completeness: float = Field(ge=0, le=10, allow_inf_nan=False)
    strengths: list[FeedbackText] = Field(min_length=1, max_length=6)
    weaknesses: list[FeedbackText] = Field(min_length=1, max_length=6)
    improved_answer: str = Field(min_length=10, max_length=4000)
    recommendations: list[FeedbackText] = Field(min_length=1, max_length=6)


def _generate_json(prompt: str) -> Any:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise AIServiceError("AI is not configured. Add GROQ_API_KEY to backend/.env and restart the API.")

    model = os.getenv("GROQ_MODEL", DEFAULT_GROQ_MODEL).strip() or DEFAULT_GROQ_MODEL
    try:
        response = httpx.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a helpful interview coach. Always respond with a valid JSON object.",
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.4,
                "response_format": {"type": "json_object"},
            },
            timeout=45.0,
        )
    except (httpx.TimeoutException, TimeoutError) as exc:
        raise AIServiceError("The request to Groq timed out. Please try again.") from exc
    except (httpx.HTTPError, ConnectionError) as exc:
        raise AIServiceError("Could not connect to Groq. Check the backend network connection and retry.") from exc

    if response.status_code in {401, 403}:
        raise AIServiceError("Groq rejected the API key. Check GROQ_API_KEY in backend/.env.")
    if response.status_code == 429:
        raise AIServiceError("Groq is rate-limiting requests. Please wait a moment and retry.")
    if 400 <= response.status_code < 500:
        raise AIServiceError("Groq rejected this request. Check GROQ_MODEL and retry.")
    if response.status_code >= 500:
        raise AIServiceError("Groq is temporarily unavailable. Please try again shortly.")

    try:
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIServiceError("The AI provider returned an unexpected response. Please try again.") from exc

    if not isinstance(content, str) or not content.strip():
        raise AIServiceError("The AI provider returned an empty response. Please try again.")

    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise AIServiceError("The AI provider returned invalid JSON. Please retry.") from exc


def generate_questions(role: str, interview_type: str, difficulty: str, count: int, skills: str) -> list[GeneratedQuestion]:
    prompt = f"""Create exactly {count} original, realistic interview questions.
Role: {role}. Interview type: {interview_type}. Difficulty: {difficulty}.
Candidate skills: {skills or "not provided"}.
Return a JSON object with a single key "questions" whose value is an array of {count} objects.
Each object must have exactly these keys: "question", "category", "difficulty".
Keep category concise (for example Data Structures, Communication, System Design).
Set every item's difficulty to "{difficulty}". Return only valid JSON."""
    data = _generate_json(prompt)
    raw_questions = data.get("questions") if isinstance(data, dict) else data
    try:
        questions = TypeAdapter(list[GeneratedQuestion]).validate_python(raw_questions)
    except ValidationError as exc:
        raise AIServiceError("The AI returned questions in an unexpected format. Please retry.") from exc
    if len(questions) != count:
        raise AIServiceError("The AI did not return the requested number of questions. Please retry.")
    if any(question.difficulty != difficulty for question in questions):
        raise AIServiceError("The AI returned questions with a different difficulty. Please retry.")
    return questions


def evaluate_answer(role: str, question: str, category: str, difficulty: str, answer: str) -> GeneratedEvaluation:
    prompt = f"""Evaluate this interview answer fairly and constructively. Do not assume facts not in the answer.
Role: {role}; difficulty: {difficulty}; question category: {category}.
Question: {question}
Candidate answer: {answer}
Return one JSON object with these exact keys: overall_score, technical_accuracy, relevance, clarity, completeness (all 0-10 numbers),
strengths (non-empty array of strings), weaknesses (non-empty array of strings), improved_answer (string),
recommendations (non-empty array of specific strings). Score the actual answer, not an ideal candidate.
For HR questions, interpret technical_accuracy as correctness of the response content."""
    try:
        return GeneratedEvaluation.model_validate(_generate_json(prompt))
    except ValidationError as exc:
        raise AIServiceError("The AI returned feedback in an unexpected format. No evaluation was saved; please retry.") from exc


def generate_study_tasks(role: str, skills: str, weak_areas: str, difficulty: str, days: int) -> list[GeneratedTask]:
    prompt = f"""Create a practical {days}-day interview preparation schedule.
Role: {role}; current skills: {skills or "not specified"}; weak areas: {weak_areas or "not specified"};
difficulty: {difficulty}.
Return a JSON object with a single key "tasks" whose value is an array of exactly {days} objects.
Each object must have exactly these keys: "day" (integer 1 through {days}), "topic", "task", and "resources" (1-4 short titles
of useful official documentation or reputable learning materials relevant to the task). Make every day distinct,
actionable, and role-specific. Return only valid JSON."""
    data = _generate_json(prompt)
    raw_tasks = data.get("tasks") if isinstance(data, dict) else data
    try:
        tasks = TypeAdapter(list[GeneratedTask]).validate_python(raw_tasks)
    except ValidationError as exc:
        raise AIServiceError("The AI returned a study plan in an unexpected format. Please retry.") from exc
    if len(tasks) != days or sorted(item.day for item in tasks) != list(range(1, days + 1)):
        raise AIServiceError("The AI returned an incomplete schedule. No plan was saved; please retry.")
    return tasks
