# AI Interview Planner

A full-stack interview preparation workspace for students and job seekers. Generate role-specific mock interviews, receive structured AI feedback on your own answers, track progress, and build a personalized study schedule.

## Problem statement

Candidates often prepare with generic question lists and have limited opportunities to practice aloud or receive actionable feedback. AI Interview Planner brings focused practice, answer evaluation, and preparation tracking together in one private workspace.

## Objectives

- Personalize interview questions and study schedules around a candidate's target role and skills.
- Give specific, structured feedback on answers rather than fixed or fabricated scores.
- Keep practice history and preparation tasks available across restarts.
- Provide an approachable, responsive interface suitable for everyday preparation and project demonstration.

## Features

- Email/password and Google Sign-In registration/login, Argon2 password hashing, and revocable signed bearer tokens.
- Candidate profile with education, skills, experience level, and preferred role.
- A sample-data guest dashboard is available on the first page; sign-in is required to save personal progress or use AI features.
- Groq-generated technical, HR, behavioral, or mixed interview sessions.
- One-question-at-a-time practice and per-answer scoring for accuracy, relevance, clarity, and completeness.
- Strengths, weaknesses, an improved answer, and actionable recommendations for each evaluated answer.
- Completion-gated interview scoring, session history, performance analytics, and category summaries.
- AI-generated study plans with day-by-day tasks and saved completion state.
- Groq structured JSON output validated against strict schemas, including score ranges, requested question difficulty, and complete study-plan days.
- SQLite persistence through SQLAlchemy; responsive dark dashboard and interactive Recharts analytics.
- Google OpenID Connect ID-token verification on the backend, Google profile pictures, and a private per-user workspace.
- Specific error messages for missing/invalid Groq credentials, rate limits, timeouts, provider outages, and invalid AI output. Failed evaluations are not saved and no score is fabricated.

## Technologies

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Recharts, Lucide
- **Backend:** Python, FastAPI, Pydantic, SQLAlchemy
- **AI:** Groq Chat Completions API (`openai/gpt-oss-20b`) via `httpx`
- **Database:** SQLite

## Requirements

- Python 3.10 or later
- Node.js 18 or later and npm
- Groq API key for question generation, answer evaluation, and study plan generation. The rest of the application can be explored without a key; AI actions return a clear configuration message until one is supplied.

## Windows setup

Run these commands from the project root in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Edit `backend\.env` and set `GROQ_API_KEY`. Set `JWT_SECRET` to a long, random value before using the app beyond local development. Configure Google Sign-In as described below if you want to enable it. For example, generate a JWT secret with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Then install the frontend dependencies and start both services from one PowerShell terminal:

```powershell
cd frontend
npm install
npm run dev:stack
```

Open `http://localhost:5173`. In development, Vite forwards `/api` requests to the local backend, avoiding browser CORS and localhost address mismatches. Interactive API documentation is at `http://localhost:8000/docs`. Press **Ctrl+C** in this terminal to stop both services together. For a separately hosted frontend and API, set `VITE_API_URL` in the frontend environment before building or starting Vite.

## Environment configuration

Copy `backend\.env.example` to `backend\.env` and configure:

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Groq API credential; kept on the backend only. |
| `GROQ_MODEL` | Groq model name; defaults to `openai/gpt-oss-20b`. |
| `JWT_SECRET` | Secret used to sign login tokens. Set a unique random value. |
| `DATABASE_URL` | SQLAlchemy URL; defaults to a SQLite file in the project root. |
| `FRONTEND_ORIGINS` | Comma-separated allowed browser origins; defaults to `http://localhost:5173`. |
| `GOOGLE_CLIENT_ID` | Public OAuth 2.0 web client ID used by Google Identity Services; backend verifies every ID token against this audience. |

### Configure Google Sign-In

Google Sign-In is optional. Without `GOOGLE_CLIENT_ID`, the app keeps email/password authentication enabled and shows a setup message instead of simulating Google login.

1. In Google Cloud Console, create or select a project and configure the OAuth consent screen.
2. Create an OAuth client ID with application type **Web application**.
3. Add `http://localhost:5173` to **Authorized JavaScript origins**.
4. Copy the client ID (not a client secret) into `GOOGLE_CLIENT_ID` in `backend\.env`.
5. Restart the backend. The frontend fetches this public client ID from the API, obtains a Google ID token using Google Identity Services, and sends the token to the backend for issuer, audience, expiry, and verified-email checks.

The client ID is public by design; no Google client secret is needed or sent to the browser. The backend links a verified Google identity to an existing account with the same verified email or creates a new account. Logout revokes the app's bearer token server-side.

Google's live provider flow requires a real OAuth client ID and an authorized origin. It has not been verified against Google unless configured with project credentials.

Never put Groq credentials, JWT secrets, or OAuth client secrets in frontend files or commit `.env` files.

## Tests and production build

From the project root:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest backend\tests -q
```

From the `frontend` directory:

```powershell
npm run build
```

## Screenshots

Add screenshots of the dashboard, mock interview feedback, analytics, and study planner here after running the application.

## Future enhancements

- Optional speech-to-text practice and timed mock interviews.
- Exportable progress reports and interview-session summaries.
- Additional language and role-specific question sets.
- Calendar reminders and curated, verified learning-resource links.
- Deployment profiles for managed databases and production authentication.
