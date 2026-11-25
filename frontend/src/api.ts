const API_URL = import.meta.env.VITE_API_URL ?? "";

export type User = { id: number; full_name: string; email: string; picture_url: string | null };
export type Profile = {
  full_name: string;
  email: string;
  picture_url: string | null;
  education: string;
  skills: string;
  experience_level: string;
  preferred_role: string;
};
export type Evaluation = {
  overall_score: number;
  technical_accuracy: number;
  relevance: number;
  clarity: number;
  completeness: number;
  strengths: string[];
  weaknesses: string[];
  improved_answer: string;
  recommendations: string[];
};
export type Question = {
  id: number;
  position: number;
  prompt: string;
  category: string;
  difficulty: string;
  answer: string | null;
  evaluation: Evaluation | null;
};
export type Interview = {
  id: number;
  role: string;
  interview_type: string;
  difficulty: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  average_score: number | null;
  questions: Question[];
};
export type Analytics = {
  interviews_completed: number;
  average_score: number;
  questions_attempted: number;
  completion_rate: number;
  category_scores: { category: string; score: number; count: number }[];
  type_scores: { interview_type: string; score: number; count: number }[];
  history: { date: string; role: string; score: number | null; id: number }[];
  improvement_areas: string[];
};
export type StudyTask = { id: number; day: number; topic: string; task: string; resources: string[]; completed: boolean };
export type StudyPlan = { id: number; role: string; days: number; created_at: string; tasks: StudyTask[] };

export function getToken() {
  return localStorage.getItem("interviewly_token");
}

export function saveToken(token: string | null) {
  if (token) localStorage.setItem("interviewly_token", token);
  else localStorage.removeItem("interviewly_token");
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    const message = typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join("; ")
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
