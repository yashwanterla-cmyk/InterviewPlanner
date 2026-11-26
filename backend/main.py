import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from . import ai_engine
from .auth import (
    bearer_scheme,
    create_access_token,
    get_current_user,
    hash_password,
    revoke_access_token,
    verify_google_id_token,
    verify_password,
)
from .database import get_db, initialize_database
from .models import Answer, Evaluation, Interview, Question, StudyPlan, StudyTask, User, UserProfile
from .schemas import (
    AnalyticsResponse,
    AnswerRequest,
    AuthResponse,
    EvaluationResponse,
    GenerateInterviewRequest,
    GoogleLoginRequest,
    InterviewResponse,
    LoginRequest,
    ProfileResponse,
    ProfileUpdate,
    QuestionResponse,
    RegisterRequest,
    StudyPlanRequest,
    StudyPlanResponse,
    TaskUpdate,
    UserResponse,
)

initialize_database()
app = FastAPI(title="AI Interview Planner API", version="1.0.0")
origins = [item.strip() for item in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_api_caching(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def _interview_response(interview: Interview) -> InterviewResponse:
    questions = []
    for question in interview.questions:
        answer = question.answer
        evaluation = answer.evaluation if answer else None
        questions.append(
            QuestionResponse(
                id=question.id,
                position=question.position,
                prompt=question.prompt,
                category=question.category,
                difficulty=question.difficulty,
                answer=answer.response if answer else None,
                evaluation=EvaluationResponse(
                    overall_score=evaluation.overall_score,
                    technical_accuracy=evaluation.technical_accuracy,
                    relevance=evaluation.relevance,
                    clarity=evaluation.clarity,
                    completeness=evaluation.completeness,
                    strengths=json.loads(evaluation.strengths),
                    weaknesses=json.loads(evaluation.weaknesses),
                    improved_answer=evaluation.improved_answer,
                    recommendations=json.loads(evaluation.recommendations),
                )
                if evaluation
                else None,
            )
        )
    return InterviewResponse(
        id=interview.id,
        role=interview.role,
        interview_type=interview.interview_type,
        difficulty=interview.difficulty,
        status=interview.status,
        created_at=interview.created_at,
        completed_at=interview.completed_at,
        average_score=interview.average_score,
        questions=questions,
    )


def _study_plan_response(plan: StudyPlan) -> StudyPlanResponse:
    return StudyPlanResponse(
        id=plan.id,
        role=plan.role,
        days=plan.days,
        created_at=plan.created_at,
        tasks=[
            {
                "id": task.id,
                "day": task.day,
                "topic": task.topic,
                "task": task.task,
                "resources": json.loads(task.resources),
                "completed": task.completed,
            }
            for task in plan.tasks
        ],
    )


def _owned_interview(db: Session, interview_id: int, user_id: int) -> Interview:
    interview = db.execute(
        select(Interview)
        .where(Interview.id == interview_id, Interview.user_id == user_id)
        .options(joinedload(Interview.questions).joinedload(Question.answer).joinedload(Answer.evaluation))
    ).unique().scalar_one_or_none()
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found.")
    return interview


def _ai_call(callable_, *args):
    try:
        return callable_(*args)
    except ai_engine.AIServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "AI Interview Planner API"}


@app.post("/api/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = str(payload.email).lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(full_name=payload.full_name.strip(), email=email, password_hash=hash_password(payload.password))
    user.profile = UserProfile()
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(access_token=create_access_token(user.id), user=UserResponse.model_validate(user))


@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return AuthResponse(access_token=create_access_token(user.id), user=UserResponse.model_validate(user))


@app.get("/api/auth/google/config")
def google_auth_config():
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    return {"enabled": bool(client_id), "client_id": client_id or None}


@app.post("/api/auth/google", response_model=AuthResponse)
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    identity = verify_google_id_token(payload.credential)
    user = db.scalar(select(User).where(User.google_sub == identity["sub"]))
    if user is not None:
        email_owner = db.scalar(select(User).where(User.email == identity["email"], User.id != user.id))
        if email_owner is not None:
            raise HTTPException(status_code=409, detail="This verified Google email is already linked to another account.")
        user.email = identity["email"]
        user.picture_url = identity["picture_url"] or user.picture_url
    else:
        user = db.scalar(select(User).where(User.email == identity["email"]))
        if user is not None and user.google_sub not in {None, identity["sub"]}:
            raise HTTPException(status_code=409, detail="This email is already linked to another Google account.")
        if user is None:
            user = User(
                full_name=identity["name"],
                email=identity["email"],
                password_hash=hash_password(os.urandom(48).hex()),
                google_sub=identity["sub"],
                picture_url=identity["picture_url"] or None,
            )
            user.profile = UserProfile()
            db.add(user)
        else:
            user.google_sub = identity["sub"]
            user.picture_url = identity["picture_url"] or user.picture_url
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        existing = db.scalar(select(User).where(User.google_sub == identity["sub"]))
        if existing is None:
            raise HTTPException(status_code=409, detail="This Google account could not be linked. Please try again.") from exc
        user = existing
    return AuthResponse(access_token=create_access_token(user.id), user=UserResponse.model_validate(user))


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Please sign in to continue.")
    revoke_access_token(credentials.credentials, user.id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/profile", response_model=ProfileResponse)
def get_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = user.profile
    if profile is None:
        profile = UserProfile(user_id=user.id)
        db.add(profile)
        db.commit()
    return ProfileResponse(
        full_name=user.full_name,
        email=user.email,
        education=profile.education,
        skills=profile.skills,
        experience_level=profile.experience_level,
        preferred_role=profile.preferred_role,
        picture_url=user.picture_url,
    )


@app.put("/api/profile", response_model=ProfileResponse)
def update_profile(payload: ProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.full_name = payload.full_name.strip()
    profile = user.profile or UserProfile(user_id=user.id)
    profile.education = payload.education.strip()
    profile.skills = payload.skills.strip()
    profile.experience_level = payload.experience_level
    profile.preferred_role = payload.preferred_role
    db.add(profile)
    db.commit()
    return ProfileResponse(
        full_name=user.full_name,
        email=user.email,
        picture_url=user.picture_url,
        **payload.model_dump(exclude={"full_name"}),
    )


@app.post("/api/interviews", response_model=InterviewResponse, status_code=status.HTTP_201_CREATED)
def create_interview(
    payload: GenerateInterviewRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    skills = user.profile.skills if user.profile else ""
    generated = _ai_call(
        ai_engine.generate_questions,
        payload.role,
        payload.interview_type,
        payload.difficulty,
        payload.question_count,
        skills,
    )
    interview = Interview(
        user_id=user.id,
        role=payload.role,
        interview_type=payload.interview_type,
        difficulty=payload.difficulty,
    )
    interview.questions = [
        Question(position=index, prompt=item.question, category=item.category, difficulty=item.difficulty)
        for index, item in enumerate(generated, start=1)
    ]
    db.add(interview)
    db.commit()
    db.refresh(interview)
    return _interview_response(_owned_interview(db, interview.id, user.id))


@app.get("/api/interviews", response_model=list[InterviewResponse])
def list_interviews(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    interviews = db.scalars(
        select(Interview)
        .where(Interview.user_id == user.id)
        .options(joinedload(Interview.questions).joinedload(Question.answer).joinedload(Answer.evaluation))
        .order_by(Interview.created_at.desc())
    ).unique().all()
    return [_interview_response(interview) for interview in interviews]


@app.get("/api/interviews/{interview_id}", response_model=InterviewResponse)
def get_interview(interview_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _interview_response(_owned_interview(db, interview_id, user.id))


@app.post("/api/interviews/{interview_id}/questions/{question_id}/answer", response_model=EvaluationResponse)
def submit_answer(
    interview_id: int,
    question_id: int,
    payload: AnswerRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    interview = _owned_interview(db, interview_id, user.id)
    if interview.status == "completed":
        raise HTTPException(status_code=409, detail="This interview has already been completed.")
    question = next((item for item in interview.questions if item.id == question_id), None)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found in this interview.")
    evaluated = _ai_call(
        ai_engine.evaluate_answer,
        interview.role,
        question.prompt,
        question.category,
        question.difficulty,
        payload.response.strip(),
    )
    answer = question.answer
    if answer is None:
        answer = Answer(question_id=question.id, response=payload.response.strip())
        db.add(answer)
        db.flush()
    else:
        answer.response = payload.response.strip()
        if answer.evaluation:
            db.delete(answer.evaluation)
            db.flush()
    answer.evaluation = Evaluation(
        overall_score=evaluated.overall_score,
        technical_accuracy=evaluated.technical_accuracy,
        relevance=evaluated.relevance,
        clarity=evaluated.clarity,
        completeness=evaluated.completeness,
        strengths=json.dumps(evaluated.strengths),
        weaknesses=json.dumps(evaluated.weaknesses),
        improved_answer=evaluated.improved_answer,
        recommendations=json.dumps(evaluated.recommendations),
    )
    db.commit()
    return EvaluationResponse(**evaluated.model_dump())


@app.post("/api/interviews/{interview_id}/complete", response_model=InterviewResponse)
def complete_interview(interview_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    interview = _owned_interview(db, interview_id, user.id)
    if interview.status == "completed":
        return _interview_response(interview)
    if not interview.questions or any(question.answer is None or question.answer.evaluation is None for question in interview.questions):
        raise HTTPException(status_code=409, detail="Answer and evaluate every question before completing this interview.")
    interview.average_score = round(
        sum(question.answer.evaluation.overall_score for question in interview.questions) / len(interview.questions), 1
    )
    interview.status = "completed"
    interview.completed_at = datetime.now(timezone.utc)
    db.commit()
    return _interview_response(_owned_interview(db, interview.id, user.id))


@app.get("/api/analytics", response_model=AnalyticsResponse)
def get_analytics(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    interviews = db.scalars(
        select(Interview)
        .where(Interview.user_id == user.id)
        .options(joinedload(Interview.questions).joinedload(Question.answer).joinedload(Answer.evaluation))
        .order_by(Interview.created_at.desc())
    ).unique().all()
    completed = [item for item in interviews if item.status == "completed" and item.average_score is not None]
    scores = [item.average_score for item in completed]
    attempted = sum(1 for item in interviews for question in item.questions if question.answer)
    total_questions = sum(len(item.questions) for item in interviews)
    categories: dict[str, list[float]] = {}
    type_results: dict[str, list[float]] = {}
    weak_area_counts: dict[str, int] = {}
    for item in interviews:
        for question in item.questions:
            if question.answer and question.answer.evaluation:
                categories.setdefault(question.category, []).append(question.answer.evaluation.overall_score)
                type_results.setdefault(item.interview_type, []).append(question.answer.evaluation.overall_score)
                for weakness in json.loads(question.answer.evaluation.weaknesses):
                    weak_area_counts[weakness] = weak_area_counts.get(weakness, 0) + 1
    category_scores = [
        {"category": category, "score": round(sum(values) / len(values), 1), "count": len(values)}
        for category, values in sorted(categories.items())
    ]
    type_scores = [
        {"interview_type": interview_type, "score": round(sum(values) / len(values), 1), "count": len(values)}
        for interview_type, values in sorted(type_results.items())
    ]
    history = [
        {
            "date": item.created_at.strftime("%b %d"),
            "role": item.role,
            "score": item.average_score,
            "id": item.id,
        }
        for item in reversed(completed[:10])
    ]
    return AnalyticsResponse(
        interviews_completed=len(completed),
        average_score=round(sum(scores) / len(scores), 1) if scores else 0,
        questions_attempted=attempted,
        completion_rate=round(attempted / total_questions * 100) if total_questions else 0,
        category_scores=category_scores,
        type_scores=type_scores,
        history=history,
        improvement_areas=[area for area, _ in sorted(weak_area_counts.items(), key=lambda pair: pair[1], reverse=True)[:5]],
    )


@app.post("/api/study-plans", response_model=StudyPlanResponse, status_code=status.HTTP_201_CREATED)
def create_study_plan(
    payload: StudyPlanRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile_skills = user.profile.skills if user.profile else ""
    skills = payload.skills.strip() or profile_skills
    tasks = _ai_call(
        ai_engine.generate_study_tasks,
        payload.role,
        skills,
        payload.weak_areas,
        payload.difficulty,
        payload.days,
    )
    plan = StudyPlan(user_id=user.id, role=payload.role, days=payload.days)
    plan.tasks = [
        StudyTask(day=item.day, topic=item.topic, task=item.task, resources=json.dumps(item.resources))
        for item in tasks
    ]
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _study_plan_response(plan)


@app.get("/api/study-plans/latest", response_model=StudyPlanResponse | None)
def latest_study_plan(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = db.execute(
        select(StudyPlan)
        .where(StudyPlan.user_id == user.id)
        .options(joinedload(StudyPlan.tasks))
        .order_by(StudyPlan.created_at.desc())
    ).unique().scalar_one_or_none()
    return _study_plan_response(plan) if plan else None


@app.patch("/api/study-tasks/{task_id}", response_model=StudyPlanResponse)
def update_study_task(
    task_id: int,
    payload: TaskUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.execute(
        select(StudyTask)
        .join(StudyPlan)
        .where(StudyTask.id == task_id, StudyPlan.user_id == user.id)
        .options(joinedload(StudyTask.plan).joinedload(StudyPlan.tasks))
    ).unique().scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Study task not found.")
    task.completed = payload.completed
    db.commit()
    return _study_plan_response(task.plan)


_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Not Found")
        target = (_frontend_dist / full_path).resolve()
        if full_path and target.is_file() and _frontend_dist.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(_frontend_dist / "index.html")
