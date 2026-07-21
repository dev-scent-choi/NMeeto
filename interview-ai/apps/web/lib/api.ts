const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? body?.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

export async function signup(email: string, password: string): Promise<TokenResponse> {
  return request("/v1/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  return request("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

// ── Resumes ───────────────────────────────────────────────────────────────

export interface ResumeUploadResult { id: string; parse_status: string }
export interface ResumeStatus { id: string; parse_status: string; summary?: string | null }

export async function uploadResume(file: File): Promise<ResumeUploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/v1/resumes`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export async function getResume(id: string): Promise<ResumeStatus> {
  return request(`/v1/resumes/${id}`);
}

export async function patchResumeText(id: string, text: string): Promise<ResumeStatus> {
  return request(`/v1/resumes/${id}`, { method: "PATCH", body: JSON.stringify({ text }) });
}

// ── Sessions ──────────────────────────────────────────────────────────────

export interface SessionConfig {
  channel?: "text" | "video";
  style?: "normal" | "pressure";
  difficulty?: 1 | 2 | 3;
  duration_min?: number;
  interview_type?: "personality" | "technical" | "mixed";
  language?: "ko" | "en";
}

export interface CreateSessionRequest {
  resume_id?: string;
  company_name: string;
  role: string;
  jd_text?: string;
  config: SessionConfig;
}

export async function createSession(body: CreateSessionRequest): Promise<{ id: string; state: string }> {
  return request("/v1/sessions", { method: "POST", body: JSON.stringify(body) });
}

export async function getSession(id: string) {
  return request<{ id: string; state: string; question_plan_preview?: string[] | null }>(`/v1/sessions/${id}`);
}

export async function startSession(id: string): Promise<{ ws_url: string; ws_ticket: string }> {
  return request(`/v1/sessions/${id}/start`, { method: "POST" });
}

export async function endSession(id: string) {
  return request(`/v1/sessions/${id}/end`, { method: "POST" });
}

export async function listSessions() {
  return request<{ items: Array<{ id: string; state: string; role_key: string; created_at: string }> }>("/v1/sessions");
}

export async function getTranscript(sessionId: string) {
  return request<{ turns: Array<{ seq: number; speaker: string; turn_type: string; text: string }> }>(
    `/v1/sessions/${sessionId}/transcript`
  );
}

// ── Reports ───────────────────────────────────────────────────────────────

export interface QuestionReport {
  question: string;
  score: number;
  feedback: string;
  improved_answer?: string | null;
  star_coverage?: { situation: boolean; task: boolean; action: boolean; result: boolean } | null;
  jd_coverage?: number | null;
}

export interface Report {
  id: string;
  session_id: string;
  overall_score: number;
  strengths: string[];
  improvements: string[];
  per_question: QuestionReport[];
  jd_coverage_summary?: string | null;
  generated_at: string;
}

export type ReportResponse = Report | { status: "pending"; message: string };

export async function getReport(sessionId: string): Promise<ReportResponse> {
  const res = await fetch(`${BASE}/v1/reports/${sessionId}`, {
    headers: { ...authHeaders() },
  });
  if (res.status === 202) return res.json();
  if (!res.ok) throw new Error(`Report error: ${res.status}`);
  return res.json();
}

// ── Usage ─────────────────────────────────────────────────────────────────

export interface UsageInfo {
  sessions_today: number;
  daily_limit: number;
  sessions_left: number;
  period_end: string;
}

export async function getUsage(): Promise<UsageInfo> {
  return request("/v1/me/usage");
}
