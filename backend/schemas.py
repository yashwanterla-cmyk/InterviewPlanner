from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


Role = Literal["Python Developer", "Java Developer", "Web Developer", "Data Scientist", "AI/ML Engineer", "Software Engineer"]
InterviewType = Literal["Technical", "HR", "Behavioral", "Mixed"]
Difficulty = Literal["Beginner", "Intermediate", "Advanced"]


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=20, max_length=10000)


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    picture_url: str | None = None

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    education: str = Field(default="", max_length=180)
    skills: str = Field(default="", max_length=1000)
    experience_level: str = Field(default="Entry level", max_length=40)
    preferred_role: Role = "Software Engineer"


class ProfileResponse(ProfileUpdate):
    email: EmailStr
    picture_url: str | None = None


class GenerateInterviewRequest(BaseModel):
    role: Role
    interview_type: InterviewType
    difficulty: Difficulty
    question_count: int = Field(ge=3, le=12)


class AnswerRequest(BaseModel):
    response: str = Field(min_length=1, max_length=10000)


class EvaluationResponse(BaseModel):
    overall_score: float
    technical_accuracy: float
    relevance: float
    clarity: float
    completeness: float
    strengths: list[str]
    weaknesses: list[str]
    improved_answer: str
    recommendations: list[str]


class QuestionResponse(BaseModel):
    id: int
    position: int
    prompt: str
    category: str
    difficulty: str
    answer: str | None = None
    evaluation: EvaluationResponse | None = None


class InterviewResponse(BaseModel):
    id: int
    role: str
    interview_type: str
    difficulty: str
    status: str
    created_at: datetime
    completed_at: datetime | None
    average_score: float | None
    questions: list[QuestionResponse]


class StudyPlanRequest(BaseModel):
    role: Role
    days: int = Field(ge=1, le=30)
    skills: str = Field(default="", max_length=1000)
    weak_areas: str = Field(default="", max_length=1000)
    difficulty: Difficulty = "Intermediate"


class StudyTaskResponse(BaseModel):
    id: int
    day: int
    topic: str
    task: str
    resources: list[str]
    completed: bool


class StudyPlanResponse(BaseModel):
    id: int
    role: str
    days: int
    created_at: datetime
    tasks: list[StudyTaskResponse]


class TaskUpdate(BaseModel):
    completed: bool


class AnalyticsResponse(BaseModel):
    interviews_completed: int
    average_score: float
    questions_attempted: int
    completion_rate: float
    category_scores: list[dict[str, str | float | int]]
    type_scores: list[dict[str, str | float | int]]
    history: list[dict[str, str | float | int | None]]
    improvement_areas: list[str]
