import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, BookOpen, BrainCircuit,
  Check, CheckCircle2, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Code2,
  FileText, GraduationCap, LayoutDashboard, LogOut, Menu, MessageSquareText,
  Mic2, Plus, Rocket, Settings2, ShieldCheck, Sparkles, Target, TrendingUp,
  UserRound, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { api, getToken, saveToken, type Analytics, type Evaluation, type Interview, type Profile, type StudyPlan, type User } from "./api";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

type Section = "Dashboard" | "My Profile" | "AI Questions" | "Mock Interview" | "Study Planner" | "Performance Analytics" | "Interview History" | "Settings";
const sections: { label: Section; icon: typeof LayoutDashboard; hint?: string }[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "My Profile", icon: UserRound },
  { label: "AI Questions", icon: CircleHelp },
  { label: "Mock Interview", icon: Mic2, hint: "AI" },
  { label: "Study Planner", icon: BookOpen },
  { label: "Performance Analytics", icon: BarChart3 },
  { label: "Interview History", icon: ClipboardCheck },
  { label: "Settings", icon: Settings2 },
];
const roles = ["Python Developer", "Java Developer", "Web Developer", "Data Scientist", "AI/ML Engineer", "Software Engineer"];
type PracticePreferences = { role: string; interview_type: string; difficulty: string; question_count: number };
const defaultPreferences: PracticePreferences = { role: "Software Engineer", interview_type: "Technical", difficulty: "Intermediate", question_count: 5 };
const sampleDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
const demoUser: User = { id: 0, full_name: "Guest", email: "", picture_url: null };
const demoAnalytics: Analytics = {
  interviews_completed: 3,
  average_score: 7.8,
  questions_attempted: 12,
  completion_rate: 75,
  category_scores: [
    { category: "Problem solving", score: 8, count: 4 },
    { category: "Communication", score: 7.5, count: 4 },
    { category: "Technical", score: 8, count: 4 },
  ],
  type_scores: [{ interview_type: "Technical", score: 7.8, count: 3 }],
  history: [
    { date: "Week 1", role: "Software Engineer", score: 6.4, id: 1 },
    { date: "Week 2", role: "Software Engineer", score: 7.1, id: 2 },
    { date: "Week 3", role: "Software Engineer", score: 7.8, id: 3 },
  ],
  improvement_areas: ["Explain trade-offs", "Use clear examples"],
};
const demoInterviews: Interview[] = [
  { id: 1, role: "Software Engineer", interview_type: "Technical", difficulty: "Intermediate", status: "completed", created_at: sampleDate(1), completed_at: sampleDate(1), average_score: 8, questions: [{ id: 1, position: 1, prompt: "SAMPLE ONLY — Demonstration question: How would you find a duplicate in a list?", category: "Problem solving", difficulty: "Intermediate", answer: "I would use a set to track values I have already seen.", evaluation: null }] },
  { id: 2, role: "Python Developer", interview_type: "Behavioral", difficulty: "Beginner", status: "completed", created_at: sampleDate(5), completed_at: sampleDate(5), average_score: 7.5, questions: [{ id: 2, position: 1, prompt: "SAMPLE ONLY — Demonstration question: Tell me about a time you learned something new.", category: "Communication", difficulty: "Beginner", answer: "I set a small goal and practiced consistently.", evaluation: null }] },
  { id: 3, role: "Web Developer", interview_type: "Technical", difficulty: "Intermediate", status: "completed", created_at: sampleDate(9), completed_at: sampleDate(9), average_score: 7.2, questions: [{ id: 3, position: 1, prompt: "SAMPLE ONLY — Demonstration question: What happens when a browser loads a web page?", category: "Web fundamentals", difficulty: "Intermediate", answer: "The browser requests resources and renders the returned content.", evaluation: null }] },
];
const demoPlan: StudyPlan = {
  id: 1,
  role: "Software Engineer",
  days: 3,
  created_at: sampleDate(0),
  tasks: [
    { id: 1, day: 1, topic: "Problem solving", task: "Practice one array problem and explain your approach aloud.", resources: ["Python documentation"], completed: true },
    { id: 2, day: 2, topic: "Communication", task: "Prepare a concise example using the STAR method.", resources: ["Interview preparation guide"], completed: false },
    { id: 3, day: 3, topic: "Review", task: "Review your solution and identify one improvement.", resources: ["Problem-solving notes"], completed: false },
  ],
};

function getPreferences(fallbackRole = "Software Engineer", email = ""): PracticePreferences {
  try {
    const saved = localStorage.getItem(`interviewly_preferences_${encodeURIComponent(email.toLowerCase())}`);
    return saved ? { ...defaultPreferences, role: fallbackRole, ...JSON.parse(saved) } : { ...defaultPreferences, role: fallbackRole };
  } catch {
    return { ...defaultPreferences, role: fallbackRole };
  }
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [section, setSection] = useState<Section>("Dashboard");
  const [preparedInterview, setPreparedInterview] = useState<Interview | null>(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem("interviewly_token")));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [nextProfile, nextAnalytics, nextInterviews, nextPlan] = await Promise.all([
      api<Profile>("/api/profile"),
      api<Analytics>("/api/analytics"),
      api<Interview[]>("/api/interviews"),
      api<StudyPlan | null>("/api/study-plans/latest"),
    ]);
    setProfile(nextProfile);
    setAnalytics(nextAnalytics);
    setInterviews(nextInterviews);
    setPlan(nextPlan);
    setUser((previous) => ({
      id: previous?.id ?? 0,
      full_name: nextProfile.full_name,
      email: nextProfile.email,
      picture_url: nextProfile.picture_url,
    }));
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("interviewly_token")) {
      setLoading(false);
      return;
    }
    refresh().catch(() => {
      saveToken(null);
      setUser(null);
    }).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const clearRestoredWorkspace = () => {
      if (getToken()) return;
      setUser(null);
      setProfile(null);
      setAnalytics(null);
      setInterviews([]);
      setPlan(null);
      setPreparedInterview(null);
      setLoading(false);
    };
    window.addEventListener("pageshow", clearRestoredWorkspace);
    return () => window.removeEventListener("pageshow", clearRestoredWorkspace);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  async function onAuthenticated(nextUser: User, token: string) {
    saveToken(token);
    setUser(nextUser);
    setLoading(true);
    try {
      await refresh();
    } catch (reason) {
      saveToken(null);
      setUser(null);
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    let warning = "";
    try {
      if (getToken()) await api<void>("/api/auth/logout", { method: "POST" });
    } catch (reason) {
      warning = `Signed out on this device, but server-side session revocation could not be confirmed: ${messageOf(reason)}`;
    } finally {
      saveToken(null);
      setUser(null);
      setProfile(null);
      setAnalytics(null);
      setInterviews([]);
      setPlan(null);
      setSection("Dashboard");
      setPreparedInterview(null);
      setProfileMenuOpen(false);
      setAuthMessage(warning);
      setShowAuth(false);
    }
  }

  if (loading) return <div className="screen-loader"><div className="loader-orbit"><BrainCircuit size={25} /></div><span>Getting your workspace ready</span></div>;
  if (!user) return showAuth
    ? <AuthScreen onAuthenticated={onAuthenticated} authMessage={authMessage} onBackToHome={() => setShowAuth(false)} />
    : <PublicHome onLogin={(message) => { setAuthMessage(message ?? ""); setShowAuth(true); }} />;

  const go = (next: Section) => {
    setSection(next);
    setMobileNav(false);
    setError("");
  };
  const handleRefresh = async () => {
    try { await refresh(); } catch (reason) { setError(messageOf(reason)); }
  };

  return (
    <div className="app-shell">
      {mobileNav && <button className="mobile-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand"><div className="brand-mark"><BrainCircuit size={20} /></div><span className="brand-name">AI INTERVIEW<br />PLANNER</span></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {sections.map(({ label, icon: Icon, hint }) => (
            <button key={label} onClick={() => go(label)} className={`nav-item ${section === label ? "nav-active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{hint && <span className="nav-hint">{hint}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <div className="tip-icon"><Sparkles size={16} /></div>
            <strong>Small steps, big offers.</strong>
            <p>A little practice every day goes a long way.</p>
            <div className="tip-progress"><span style={{ width: `${analytics?.completion_rate ?? 0}%` }} /></div>
            <small>{analytics?.completion_rate ?? 0}% practice completion</small>
          </div>
          <div className="account-chip"><UserAvatar user={user} /><div className="account-copy"><strong>{user.full_name}</strong><span>Personal workspace</span></div><Settings2 size={16} className="muted-icon" /></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="breadcrumb">Workspace <ChevronRight size={14} /> <span>{section}</span></div>
          <div className="topbar-right">
            <span className="today-label">{new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span>
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button className="profile-menu-trigger" onClick={() => setProfileMenuOpen((open) => !open)} aria-label="Open profile menu" aria-haspopup="menu" aria-expanded={profileMenuOpen}>
                <UserAvatar user={user} small />
              </button>
              {profileMenuOpen && <div className="profile-menu" role="menu">
                <div className="profile-menu-user"><UserAvatar user={user} /><div><strong>{user.full_name}</strong><span>{user.email}</span></div></div>
                <div className="profile-menu-divider" />
                <button role="menuitem" onClick={() => { go("My Profile"); setProfileMenuOpen(false); }}><UserRound size={16} />Profile Information</button>
                <button role="menuitem" onClick={() => { go("Dashboard"); setProfileMenuOpen(false); }}><LayoutDashboard size={16} />My Workspace</button>
                <button role="menuitem" onClick={() => { go("Settings"); setProfileMenuOpen(false); }}><Settings2 size={16} />Account Settings</button>
                <button role="menuitem" onClick={() => { setHelpOpen(true); setProfileMenuOpen(false); }}><CircleHelp size={16} />Help &amp; Support</button>
                <div className="profile-menu-divider" />
                <button role="menuitem" className="profile-menu-logout" onClick={() => { void signOut(); }}><LogOut size={16} />Logout</button>
              </div>}
            </div>
          </div>
        </header>
        <div className="page-wrap">
          {error && <div className="toast toast-error"><CircleHelp size={17} />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
          {notice && <div className="toast toast-success"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message"><X size={15} /></button></div>}
          {section === "Dashboard" && <Dashboard user={user} analytics={analytics} interviews={interviews} plan={plan} onNavigate={go} />}
          {section === "AI Questions" && <QuestionGenerator profile={profile} onStartMock={(interview) => { setPreparedInterview(interview); go("Mock Interview"); }} onError={setError} />}
          {section === "Mock Interview" && <Practice profile={profile} initialInterview={preparedInterview} onInterviewChange={setPreparedInterview} onError={setError} onDone={async (message) => { setPreparedInterview(null); await handleRefresh(); setNotice(message); }} />}
          {section === "Performance Analytics" && <AnalyticsPage analytics={analytics} />}
          {section === "Study Planner" && <StudyPlanner profile={profile} analytics={analytics} plan={plan} onPlan={setPlan} onError={setError} />}
          {section === "Interview History" && <HistoryPage interviews={interviews} />}
          {section === "My Profile" && <ProfilePage profile={profile} onSaved={(next) => { setProfile(next); setUser((previous) => previous ? { ...previous, full_name: next.full_name } : previous); setNotice("Your profile has been updated."); }} onError={setError} />}
          {section === "Settings" && <SettingsPage userEmail={user.email} onSignOut={signOut} />}
          <footer className="page-footer"><span>Made for your next big opportunity</span><span><ShieldCheck size={13} /> Your progress stays private</span></footer>
        </div>
      </main>
      {helpOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}><section className="history-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="modal-heading"><div><div className="eyebrow">HELP &amp; SUPPORT</div><h2 id="help-title">Your preparation workspace</h2></div><button className="icon-button" onClick={() => setHelpOpen(false)} aria-label="Close help"><X size={17} /></button></div><p className="muted-copy">Create a mock interview to practice, review AI feedback in Interview History, and use your Study Planner to organize next steps. Update your role and skills in Profile Information to personalize future sessions.</p><div className="help-note"><ShieldCheck size={16} /><span>Your profile and interview history are private to your account.</span></div><button className="button button-secondary" onClick={() => setHelpOpen(false)}>Got it</button></section></div>}
    </div>
  );
}

function PublicHome({ onLogin }: { onLogin: (message?: string) => void }) {
  return (
    <div className="app-shell guest-app-shell">
      <main className="main-area">
        <header className="topbar guest-topbar">
          <div className="brand"><div className="brand-mark"><BrainCircuit size={20} /></div><span className="brand-name">AI INTERVIEW<br />PLANNER</span></div>
          <div className="topbar-right"><span className="today-label">GUEST WORKSPACE</span><button className="button button-primary" onClick={() => onLogin()}>Log in</button></div>
        </header>
        <div className="page-wrap">
          <Dashboard
            user={demoUser}
            analytics={demoAnalytics}
            interviews={demoInterviews}
            plan={demoPlan}
            onNavigate={() => onLogin("Sign in or create an account to save your progress and use AI features.")}
            isDemo
          />
          <footer className="page-footer"><span>Sample workspace · Your personal progress stays private</span><span><ShieldCheck size={13} /> Sign in to save your work</span></footer>
        </div>
      </main>
    </div>
  );
}

function AuthScreen({ onAuthenticated, authMessage, onBackToHome }: { onAuthenticated: (user: User, token: string) => Promise<void>; authMessage: string; onBackToHome: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleStatus, setGoogleStatus] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  useEffect(() => {
    let active = true;
    api<{ enabled: boolean; client_id: string | null }>("/api/auth/google/config")
      .then((config) => {
        if (!active) return;
        if (config.enabled && config.client_id) setGoogleClientId(config.client_id);
        else setGoogleStatus("Google Sign-In is not configured. Set GOOGLE_CLIENT_ID in backend/.env to enable it.");
      })
      .catch(() => {
        if (active) setGoogleStatus("Google Sign-In configuration could not be loaded. Check that the API is running.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleButton.current) return;
    let active = true;
    const renderGoogleButton = () => {
      if (!active || !window.google || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          setGoogleBusy(true);
          setError("");
          api<{ access_token: string; user: User }>("/api/auth/google", {
            method: "POST",
            body: JSON.stringify({ credential: response.credential }),
          }).then((result) => onAuthenticatedRef.current(result.user, result.access_token))
            .catch((reason: unknown) => setError(messageOf(reason)))
            .finally(() => setGoogleBusy(false));
        },
      });
      googleButton.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButton.current, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: String(Math.min(googleButton.current.clientWidth || 360, 400)),
      });
    };
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (window.google) {
      renderGoogleButton();
    } else if (existingScript) {
      existingScript.addEventListener("load", renderGoogleButton, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = renderGoogleButton;
      script.onerror = () => setGoogleStatus("Google Sign-In could not load. Check your network connection and try again.");
      document.head.appendChild(script);
    }
    return () => { active = false; };
  }, [googleClientId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = mode === "login" ? { email, password } : { full_name: fullName, email, password };
      const result = await api<{ access_token: string; user: User }>(path, { method: "POST", body: JSON.stringify(payload) });
      await onAuthenticated(result.user, result.access_token);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-decoration decoration-one" /><div className="auth-decoration decoration-two" />
      <a className="auth-home-link" href="/" onClick={(event) => { event.preventDefault(); onBackToHome(); }}>Back to home</a>
      <div className="auth-left">
        <div className="brand auth-brand"><div className="brand-mark"><BrainCircuit size={20} /></div><span className="brand-name">AI INTERVIEW<br />PLANNER</span></div>
        <div className="auth-story">
          <div className="eyebrow"><Sparkles size={14} /> YOUR NEXT CHAPTER STARTS HERE</div>
          <h1>Show up ready.<br /><span>Go further.</span></h1>
          <p>Practice with purpose, get thoughtful AI feedback, and turn your potential into your next opportunity.</p>
          <div className="auth-proof"><div className="proof-avatars"><i>J</i><i>A</i><i>M</i><i>+</i></div><span>Built for ambitious people like you</span></div>
          <div className="auth-feature"><div><Target size={17} /><span>Role-specific practice</span></div><div><TrendingUp size={17} /><span>Progress that feels real</span></div><div><MessageSquareText size={17} /><span>Feedback you can use</span></div></div>
        </div>
        <div className="auth-copyright">AI Interview Planner · Prepare with confidence</div>
      </div>
      <div className="auth-right">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand brand"><div className="brand-mark"><BrainCircuit size={20} /></div><span className="brand-name">AI INTERVIEW<br />PLANNER</span></div>
          <div className="auth-heading"><div className="form-eyebrow">WELCOME {mode === "login" ? "BACK" : "ABOARD"}</div><h2>{mode === "login" ? "Let's get you in." : "Create your account."}</h2><p>{mode === "login" ? "Pick up right where your preparation left off." : "Your personal interview coach is one step away."}</p></div>
          <div className="auth-tabs"><button className={mode === "login" ? "tab-selected" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button><button className={mode === "register" ? "tab-selected" : ""} onClick={() => { setMode("register"); setError(""); }}>Create account</button></div>
          <div className="google-signin">
            {googleClientId ? <div ref={googleButton} className={`google-button-host ${googleBusy ? "google-button-busy" : ""}`} aria-label="Continue with Google" /> : <button className="google-button-fallback" disabled aria-label="Continue with Google"><GoogleMark /><span>Continue with Google</span></button>}
            {(googleBusy || busy) && <span className="google-loading"><span className="spinner" /> Signing you in...</span>}
            {googleStatus && <span className="google-status">{googleStatus}</span>}
          </div>
          <div className="auth-divider"><span>or continue with email</span></div>
          <form onSubmit={submit} className="auth-form">
            {mode === "register" && <label>Full name<input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Alex Morgan" autoComplete="name" /></label>}
            <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
            <label>Password<input required minLength={mode === "register" ? 8 : 1} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 8 characters" : "Your password"} autoComplete={mode === "register" ? "new-password" : "current-password"} /></label>
            {(error || authMessage) && <div className="inline-error">{error || authMessage}</div>}
            <button className="button button-primary auth-submit" disabled={busy}>{busy ? <><span className="spinner" /> Please wait...</> : <>{mode === "login" ? "Sign in to your workspace" : "Create your account"}<ArrowRight size={17} /></>}</button>
          </form>
          <div className="auth-safe"><ShieldCheck size={14} /> Your data is private and securely stored.</div>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ user, analytics, interviews, plan, onNavigate, isDemo = false }: { user: User; analytics: Analytics | null; interviews: Interview[]; plan: StudyPlan | null; onNavigate: (section: Section) => void; isDemo?: boolean }) {
  const firstName = user.full_name.split(" ")[0] || user.full_name;
  const latest = interviews.slice(0, 4);
  const hasSampleOutput = interviews.some((interview) =>
    interview.questions.some((question) => question.prompt.startsWith("SAMPLE ONLY")),
  );
  return (
    <>
      {(isDemo || hasSampleOutput) && <div className="demo-sample-banner" role="note"><strong>DEMO SAMPLE</strong><span>{isDemo ? "This dashboard uses example data. Sign in to save your progress or use AI features." : "Questions, scores, and feedback shown here are illustrative examples, not AI-generated or AI-evaluated."}</span></div>}
      <section className="welcome-row">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR PREP SPACE</div><h1>{isDemo ? "Welcome to your workspace" : `Good to see you, ${firstName}`}<span className="wave">✦</span></h1><p>{isDemo ? "Explore the dashboard with sample activity. Sign in when you're ready to make it yours." : `${user.email} · Your next opportunity is closer than you think.`}</p></div>
        <button className="button button-primary" onClick={() => onNavigate("Mock Interview")}>{isDemo ? <UserRound size={17} /> : <Plus size={17} />}{isDemo ? "Sign in to get started" : "Start an interview"}</button>
      </section>
      <section className="stats-grid">
        <StatCard label="Interviews completed" value={analytics?.interviews_completed ?? 0} icon={<ClipboardCheck size={18} />} tone="purple" foot="Keep showing up" />
        <StatCard label="Average score" value={`${analytics?.average_score ?? 0}`} suffix="/10" icon={<Target size={18} />} tone="green" foot="Across completed sessions" />
        <StatCard label="Questions practiced" value={analytics?.questions_attempted ?? 0} icon={<MessageSquareText size={18} />} tone="blue" foot="Every answer builds skill" />
        <StatCard label="Practice progress" value={`${analytics?.completion_rate ?? 0}%`} icon={<TrendingUp size={18} />} tone="orange" foot="Questions with feedback" />
      </section>
      <section className="dashboard-grid">
        <div className="panel trend-panel">
          <div className="panel-heading"><div><div className="eyebrow">YOUR MOMENTUM</div><h2>Progress over time</h2></div><button className="text-button" onClick={() => onNavigate("Performance Analytics")}>View analytics <ArrowRight size={14} /></button></div>
          {analytics?.history.length ? <div className="chart-wrap chart-small"><ResponsiveContainer width="100%" height="100%"><AreaChart data={analytics.history} margin={{ top: 10, right: 12, left: -22, bottom: 0 }}><defs><linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#438ce8" stopOpacity={0.28} /><stop offset="95%" stopColor="#438ce8" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#202842" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#737d99", fontSize: 11 }} /><YAxis domain={[0, 10]} tickLine={false} axisLine={false} tick={{ fill: "#737d99", fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}/10`, "Score"]} /><Area type="monotone" dataKey="score" stroke="#79b4ff" strokeWidth={2.5} fill="url(#scoreFill)" activeDot={{ r: 5, fill: "#79b4ff" }} /></AreaChart></ResponsiveContainer></div> : <EmptyState icon={<TrendingUp size={19} />} title="Your progress will show up here" text="Complete your first mock interview to start tracking your momentum." action="Practice now" onClick={() => onNavigate("Mock Interview")} />}
        </div>
        <div className="panel focus-panel">
          <div className="panel-heading"><div><div className="eyebrow">A GOOD PLACE TO START</div><h2>Make today count</h2></div><div className="panel-icon"><Rocket size={17} /></div></div>
          <p className="focus-copy">A focused practice session can make all the difference. Pick a role and we'll take it from there.</p>
          <button className="focus-action" onClick={() => onNavigate("Mock Interview")}><div className="focus-action-icon"><Code2 size={18} /></div><div><strong>Run a mock interview</strong><span>Get questions tailored to your role</span></div><ArrowRight size={17} /></button>
          <button className="focus-action" onClick={() => onNavigate("Study Planner")}><div className="focus-action-icon focus-action-alt"><GraduationCap size={18} /></div><div><strong>Plan your preparation</strong><span>Build a practical day-by-day plan</span></div><ArrowRight size={17} /></button>
        </div>
      </section>
      <section className="panel dashboard-study-panel">
        <div className="panel-heading"><div><div className="eyebrow">YOUR STUDY PLAN</div><h2>{plan ? `${plan.role} preparation` : "A plan built around you"}</h2></div><button className="text-button" onClick={() => onNavigate("Study Planner")}>{plan ? "Open plan" : "Create a plan"} <ArrowRight size={14} /></button></div>
        {plan ? <div className="dashboard-plan-summary"><div className="dashboard-plan-progress"><span style={{ width: `${plan.tasks.length ? Math.round((plan.tasks.filter((task) => task.completed).length / plan.tasks.length) * 100) : 0}%` }} /></div><span>{plan.tasks.filter((task) => task.completed).length} of {plan.tasks.length} tasks complete</span><strong>{plan.tasks.find((task) => !task.completed)?.topic ?? "All tasks complete"}</strong><p>{plan.tasks.find((task) => !task.completed)?.task ?? "Great work. Your preparation plan is complete."}</p></div> : <div className="dashboard-plan-empty"><BookOpen size={18} /><p>Your day-by-day preparation schedule will appear here.</p><button className="button button-secondary" onClick={() => onNavigate("Study Planner")}>Build my study plan <ArrowRight size={14} /></button></div>}
      </section>
      <section className="panel recent-panel">
        <div className="panel-heading"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>Your practice sessions</h2></div><button className="text-button" onClick={() => onNavigate("Interview History")}>See all <ArrowRight size={14} /></button></div>
        {latest.length ? <div className="table-scroll"><table className="activity-table"><thead><tr><th>SESSION</th><th>DATE</th><th>DIFFICULTY</th><th>STATUS</th><th>SCORE</th></tr></thead><tbody>{latest.map((item) => <tr key={item.id}><td><div className="session-title"><div className="session-icon"><Code2 size={16} /></div><div><strong>{item.role}</strong><span>{item.interview_type} interview</span></div></div></td><td>{formatDate(item.created_at)}</td><td><span className={`difficulty difficulty-${item.difficulty.toLowerCase()}`}>{item.difficulty}</span></td><td><span className={`status-pill ${item.status === "completed" ? "status-done" : "status-open"}`}><i />{item.status === "completed" ? "Completed" : "In progress"}</span></td><td className="score-cell">{item.average_score === null ? "—" : <>{item.average_score}<small>/10</small></>}</td></tr>)}</tbody></table></div> : <EmptyState icon={<FileText size={19} />} title="No sessions yet" text="Your interview practice history will live here." action="Start practicing" onClick={() => onNavigate("Mock Interview")} />}
      </section>
    </>
  );
}

function StatCard({ label, value, suffix, icon, tone, foot }: { label: string; value: string | number; suffix?: string; icon: ReactNode; tone: string; foot: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><div className={`stat-icon icon-${tone}`}>{icon}</div></div><div className="stat-value">{value}<small>{suffix}</small></div><div className="stat-foot"><span className={`stat-dot dot-${tone}`} />{foot}</div></div>;
}

function QuestionGenerator({ profile, onStartMock, onError }: { profile: Profile | null; onStartMock: (interview: Interview) => void; onError: (message: string) => void }) {
  const preferences = getPreferences(profile?.preferred_role, profile?.email);
  const [role, setRole] = useState(preferences.role);
  const [kind, setKind] = useState(preferences.interview_type);
  const [difficulty, setDifficulty] = useState(preferences.difficulty);
  const [count, setCount] = useState(preferences.question_count);
  const [interview, setInterview] = useState<Interview | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<Interview>("/api/interviews", {
        method: "POST",
        body: JSON.stringify({ role, interview_type: kind, difficulty, question_count: count }),
      });
      setInterview(result);
    } catch (reason) {
      onError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageTitle eyebrow="ROLE-SPECIFIC QUESTION BANK" title="Ask better questions of yourself." description="Generate a fresh set of realistic interview questions around the role and difficulty you're preparing for." />
    <div className="question-generator-layout">
      <form className="panel generator-form" onSubmit={generate}>
        <div className="panel-heading"><div><div className="eyebrow">QUESTION PARAMETERS</div><h2>Tailor your question set</h2></div><div className="panel-icon"><BrainCircuit size={17} /></div></div>
        <label>Job role<select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="form-row">
          <label>Interview type<select value={kind} onChange={(event) => setKind(event.target.value)}>{["Technical", "HR", "Behavioral", "Mixed"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>{["Beginner", "Intermediate", "Advanced"].map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <label>Questions to generate <span className="range-value">{count}</span><input className="range-input" type="range" min="3" max="12" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
        <div className="form-note"><Sparkles size={15} /> Questions are generated for your role and skill profile.</div>
        <button className="button button-primary start-button" disabled={busy}>{busy ? <><span className="spinner" /> Generating questions...</> : <><Sparkles size={15} /> Generate questions</>}</button>
      </form>
      <section className="panel generated-questions">
        <div className="panel-heading"><div><div className="eyebrow">{interview ? "YOUR QUESTION SET" : "AI QUESTION PREVIEW"}</div><h2>{interview ? `${interview.questions.length} questions for ${interview.role}` : "Your next practice starts here"}</h2></div>        {interview && <span className={`difficulty difficulty-${interview.difficulty.toLowerCase()}`}>{interview.difficulty}</span>}</div>
        {interview ? <>
          <div className="generated-question-list">{interview.questions.map((question) => <article className="generated-question" key={question.id}><span className="generated-question-number">{String(question.position).padStart(2, "0")}</span><div><div className="question-meta"><span className="category-chip">{question.category}</span><span className={`difficulty difficulty-${question.difficulty.toLowerCase()}`}>{question.difficulty}</span></div><p>{question.prompt}</p></div></article>)}</div>
          <button className="button button-primary start-button" onClick={() => onStartMock(interview)}>Start this mock interview <ArrowRight size={16} /></button>
        </> : <div className="generator-empty"><div className="empty-graphic"><CircleHelp size={23} /></div><h3>Questions built for the role you want.</h3><p>Choose your focus and generate a set of questions. Review them before starting your mock interview.</p><div className="plan-points"><span><CheckCircle2 size={15} /> Role and difficulty aware</span><span><CheckCircle2 size={15} /> Technical, HR, or mixed</span><span><CheckCircle2 size={15} /> Ready to use in a mock interview</span></div></div>}
      </section>
    </div>
  </>;
}

function Practice({ profile, initialInterview, onInterviewChange, onError, onDone }: { profile: Profile | null; initialInterview: Interview | null; onInterviewChange: (interview: Interview | null) => void; onError: (message: string) => void; onDone: (message: string) => void }) {
  const preferences = getPreferences(profile?.preferred_role, profile?.email);
  const [interview, setInterview] = useState<Interview | null>(initialInterview);
  const firstPending = initialInterview?.questions.findIndex((item) => !item.evaluation) ?? 0;
  const initialPosition = firstPending < 0 ? 0 : firstPending;
  const [position, setPosition] = useState(initialPosition);
  const [answer, setAnswer] = useState(initialInterview?.questions[initialPosition]?.answer ?? "");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(initialInterview?.questions[initialPosition]?.evaluation ?? null);
  const [role, setRole] = useState(preferences.role || profile?.preferred_role || "Software Engineer");
  const [kind, setKind] = useState(preferences.interview_type);
  const [difficulty, setDifficulty] = useState(preferences.difficulty);
  const [count, setCount] = useState(preferences.question_count);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const question = interview?.questions[position];
  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<Interview>("/api/interviews", { method: "POST", body: JSON.stringify({ role, interview_type: kind, difficulty, question_count: count }) });
      setInterview(result);
      onInterviewChange(result);
      setPosition(0);
      setAnswer("");
      setEvaluation(null);
      setComplete(false);
    } catch (reason) { onError(messageOf(reason)); } finally { setBusy(false); }
  }
  async function submitAnswer() {
    if (!interview || !question || !answer.trim()) return;
    setBusy(true);
    try {
      const result = await api<Evaluation>(`/api/interviews/${interview.id}/questions/${question.id}/answer`, { method: "POST", body: JSON.stringify({ response: answer }) });
      setEvaluation(result);
      const updatedInterview = {
        ...interview,
        questions: interview.questions.map((item) => item.id === question.id
          ? { ...item, answer, evaluation: result }
          : item),
      };
      setInterview(updatedInterview);
      onInterviewChange(updatedInterview);
    } catch (reason) { onError(messageOf(reason)); } finally { setBusy(false); }
  }
  async function advance() {
    if (!interview) return;
    if (position === interview.questions.length - 1) {
      setBusy(true);
      try {
        const completedInterview = await api<Interview>(`/api/interviews/${interview.id}/complete`, { method: "POST" });
        setInterview(completedInterview);
        onInterviewChange(completedInterview);
        setComplete(true);
        onDone("Interview complete. Your feedback and progress have been saved.");
      } catch (reason) { onError(messageOf(reason)); } finally { setBusy(false); }
      return;
    }
    setPosition((previous) => previous + 1);
    setAnswer("");
    setEvaluation(null);
  }
  if (complete && interview) {
    return <><PageTitle eyebrow="SESSION COMPLETE" title="You showed up. That counts." description="Here's how your practice session went. Your feedback is saved in your history." /><div className="completion-card"><div className="completion-orb"><CheckCircle2 size={29} /></div><div className="eyebrow">YOUR SESSION SCORE</div><div className="completion-score">{interview.average_score ?? "—"}<small>/10</small></div><p>{interview.role} · {interview.questions.length} questions</p><div className="completion-actions"><button className="button button-secondary" onClick={() => { setInterview(null); onInterviewChange(null); setComplete(false); }}>Back to practice</button></div></div></>;
  }
  if (!interview) {
    return (
      <>
        <PageTitle eyebrow="PRACTICE ARENA" title="Practice like it matters." description="Your personal mock interview, built around your next opportunity." />
        <div className="practice-intro"><div className="practice-illustration"><div className="illustration-glow" /><div className="illustration-card"><div className="illustration-top"><span /><span /><span /></div><div className="illustration-line line-wide" /><div className="illustration-line" /><div className="illustration-chip"><Sparkles size={13} /> AI-powered feedback</div></div><div className="floating-badge badge-one"><MessageSquareText size={16} /><span>Thoughtful feedback</span></div><div className="floating-badge badge-two"><Target size={16} /><span>Built around your role</span></div></div>
          <form className="panel practice-form" onSubmit={start}><div className="panel-heading"><div><div className="eyebrow">SET UP YOUR SESSION</div><h2>Make it yours</h2></div><div className="panel-icon"><Settings2 size={17} /></div></div>
            <label>Job role<select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
            <div className="form-row"><label>Interview type<select value={kind} onChange={(event) => setKind(event.target.value)}>{["Technical", "HR", "Behavioral", "Mixed"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>{["Beginner", "Intermediate", "Advanced"].map((item) => <option key={item}>{item}</option>)}</select></label></div>
            <label>Number of questions <span className="range-value">{count}</span><input className="range-input" type="range" min="3" max="12" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
            <div className="form-note"><Sparkles size={15} /> Questions are generated for your role and skill profile.</div>
            <button className="button button-primary start-button" disabled={busy}>{busy ? <><span className="spinner" /> Creating your interview...</> : <>Let's get started <ArrowRight size={17} /></>}</button>
          </form></div>
      </>
    );
  }
  if (!question) return <EmptyState icon={<CircleHelp size={20} />} title="No question found" text="Try generating another interview." action="Start over" onClick={() => setInterview(null)} />;
  return (
    <>
      <div className="interview-topline"><button className="back-link" onClick={() => { setInterview(null); onInterviewChange(null); }}>← Exit interview</button><span><Clock3 size={14} /> Take your time</span></div>
      <div className="interview-heading"><div className="eyebrow">MOCK INTERVIEW · {interview.role.toUpperCase()}</div><h1>Think it through.</h1><p>A good answer is a clear answer. Take a breath and make it yours.</p></div>
      <div className="question-progress"><div><span>QUESTION {position + 1} <i>OF</i> {interview.questions.length}</span><strong>{Math.round(((position + (evaluation ? 1 : 0)) / interview.questions.length) * 100)}%</strong></div><div className="progress-track"><span style={{ width: `${((position + (evaluation ? 1 : 0)) / interview.questions.length) * 100}%` }} /></div></div>
      <div className="panel question-card"><div className="question-meta"><span className="question-number">Q{String(position + 1).padStart(2, "0")}</span><span className="category-chip">{question.category}</span><span className={`difficulty difficulty-${question.difficulty.toLowerCase()}`}>{question.difficulty}</span></div><h2>{question.prompt}</h2><div className="answer-label">YOUR ANSWER <span>{answer.length}/10000</span></div><textarea disabled={Boolean(evaluation) || busy} maxLength={10000} rows={7} placeholder="Take a moment to gather your thoughts. There's no rush..." value={answer} onChange={(event) => setAnswer(event.target.value)} />{!evaluation && <div className="answer-hint">Tip: structure your response and use a specific example where you can.</div>}
        {!evaluation ? <button className="button button-primary evaluate-button" onClick={submitAnswer} disabled={busy || answer.trim().length < 5}>{busy ? <><span className="spinner" /> Evaluating your answer...</> : <>Get feedback <Sparkles size={16} /></>}</button> : <EvaluationCard evaluation={evaluation} />}
        {evaluation && <button className="button button-primary evaluate-button" onClick={advance} disabled={busy}>{busy ? <><span className="spinner" /> Saving session...</> : <>{position === interview.questions.length - 1 ? "Complete interview" : "Continue to next question"} <ArrowRight size={16} /></>}</button>}
      </div>
    </>
  );
}

function EvaluationCard({ evaluation }: { evaluation: Evaluation }) {
  const dimensions = [["Technical accuracy", evaluation.technical_accuracy], ["Relevance", evaluation.relevance], ["Clarity", evaluation.clarity], ["Completeness", evaluation.completeness]] as const;
  return <div className="evaluation-panel"><div className="evaluation-top"><div><div className="eyebrow">YOUR ANSWER REVIEW</div><h3>Good work. Here's what we noticed.</h3></div><div className="evaluation-score">{evaluation.overall_score}<small>/10</small></div></div><div className="dimension-grid">{dimensions.map(([label, value]) => <div key={label}><div className="dimension-label">{label}<strong>{value}/10</strong></div><div className="dimension-track"><span style={{ width: `${value * 10}%` }} /></div></div>)}</div><div className="feedback-columns"><FeedbackList title="What worked" items={evaluation.strengths} tone="positive" /><FeedbackList title="Room to grow" items={evaluation.weaknesses} tone="growth" /></div><div className="improved-answer"><div className="improved-title"><Sparkles size={15} /> A stronger way to frame it</div><p>{evaluation.improved_answer}</p></div><FeedbackList title="Try this next time" items={evaluation.recommendations} tone="recommend" /></div>;
}

function FeedbackList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return <div className={`feedback-list feedback-${tone}`}><strong>{title}</strong><ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>;
}

function AnalyticsPage({ analytics }: { analytics: Analytics | null }) {
  return <>
    <PageTitle eyebrow="YOUR GROWTH" title="The progress is yours." description="A clearer picture of what's clicking and where to focus next." />
    <div className="stats-grid analytics-stats"><StatCard label="Sessions completed" value={analytics?.interviews_completed ?? 0} icon={<ClipboardCheck size={18} />} tone="purple" foot="Every rep makes a difference" /><StatCard label="Average score" value={analytics?.average_score ?? 0} suffix="/10" icon={<Target size={18} />} tone="green" foot="Across finished interviews" /><StatCard label="Questions answered" value={analytics?.questions_attempted ?? 0} icon={<MessageSquareText size={18} />} tone="blue" foot="A growing bank of practice" /><StatCard label="Response coverage" value={`${analytics?.completion_rate ?? 0}%`} icon={<TrendingUp size={18} />} tone="orange" foot="Answers with AI feedback" /></div>
    <div className="analytics-grid"><div className="panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">SCORE TREND</div><h2>Interview performance</h2></div><div className="chart-legend"><i /> Score / 10</div></div>{analytics?.history.length ? <div className="chart-wrap chart-large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={analytics.history} margin={{ top: 15, right: 20, left: -18, bottom: 0 }}><defs><linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#438ce8" stopOpacity={0.27} /><stop offset="95%" stopColor="#438ce8" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#202842" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#737d99", fontSize: 11 }} /><YAxis domain={[0, 10]} tickLine={false} axisLine={false} tick={{ fill: "#737d99", fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}/10`, "Score"]} /><Area type="monotone" dataKey="score" stroke="#79b4ff" strokeWidth={2.5} fill="url(#analyticsFill)" activeDot={{ r: 5, fill: "#79b4ff" }} /></AreaChart></ResponsiveContainer></div> : <EmptyState icon={<TrendingUp size={19} />} title="Your story starts with one session" text="Complete an interview and your score trend will appear here." />}
    </div><div className="panel category-panel"><div className="panel-heading"><div><div className="eyebrow">SKILL BREAKDOWN</div><h2>By category</h2></div></div>{analytics?.category_scores.length ? <div className="chart-wrap chart-medium"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.category_scores} layout="vertical" margin={{ top: 4, right: 14, left: 3, bottom: 0 }}><CartesianGrid stroke="#202842" horizontal={false} /><XAxis type="number" domain={[0, 10]} tickLine={false} axisLine={false} tick={{ fill: "#737d99", fontSize: 10 }} /><YAxis dataKey="category" type="category" width={90} tickLine={false} axisLine={false} tick={{ fill: "#aab2c9", fontSize: 10 }} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}/10`, "Average score"]} /><Bar dataKey="score" radius={[0, 5, 5, 0]} barSize={14}>{analytics.category_scores.map((item, index) => <Cell key={item.category} fill={["#438ce8", "#4fc3a1", "#66a8f3", "#f0ac62"][index % 4]} />)}</Bar></BarChart></ResponsiveContainer></div> : <EmptyState icon={<BarChart3 size={19} />} title="No category data yet" text="Practice a few questions to see your strengths by topic." />}</div></div>
    <div className="panel type-performance-panel"><div className="panel-heading"><div><div className="eyebrow">INTERVIEW FORMAT</div><h2>Technical, HR &amp; more</h2></div><div className="chart-legend"><i /> Average score / 10</div></div>{analytics?.type_scores.length ? <div className="chart-wrap chart-type"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.type_scores} margin={{ top: 10, right: 15, left: -18, bottom: 0 }}><CartesianGrid stroke="#202842" vertical={false} /><XAxis dataKey="interview_type" tickLine={false} axisLine={false} tick={{ fill: "#aab2c9", fontSize: 10 }} /><YAxis domain={[0, 10]} tickLine={false} axisLine={false} tick={{ fill: "#737d99", fontSize: 10 }} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}/10`, "Average score"]} /><Bar dataKey="score" fill="#438ce8" radius={[5, 5, 0, 0]} barSize={30} /></BarChart></ResponsiveContainer></div> : <EmptyState icon={<BarChart3 size={19} />} title="No interview format data yet" text="Try a technical or HR session to compare how you feel across formats." />}</div>
    <div className="insight-grid"><div className="panel insight-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR NEXT FOCUS</div><h2>Areas to work on</h2></div><div className="panel-icon"><Target size={16} /></div></div>{analytics?.improvement_areas.length ? <div className="focus-list">{analytics.improvement_areas.map((item, index) => <div key={item}><span className="focus-index">0{index + 1}</span><span>{item}</span><ArrowUpRight size={14} /></div>)}</div> : <p className="muted-copy">Complete a few evaluated answers to get personalized improvement suggestions.</p>}</div><div className="panel insight-panel"><div className="panel-heading"><div><div className="eyebrow">KEEP THE MOMENTUM</div><h2>Consistency wins</h2></div><div className="panel-icon panel-icon-green"><TrendingUp size={16} /></div></div><p className="muted-copy">Every completed question gives you more specific feedback. Build a small daily practice habit and revisit your weaker categories.</p><div className="consistency-note"><Sparkles size={15} /> Your feedback is based on your real answers.</div></div></div>
  </>;
}

function StudyPlanner({ profile, analytics, plan, onPlan, onError }: { profile: Profile | null; analytics: Analytics | null; plan: StudyPlan | null; onPlan: (plan: StudyPlan | null) => void; onError: (message: string) => void }) {
  const [role, setRole] = useState(profile?.preferred_role ?? "Software Engineer");
  const [days, setDays] = useState(7);
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [busy, setBusy] = useState(false);
  const [weakAreas, setWeakAreas] = useState((analytics?.improvement_areas ?? []).join(", "));
  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<StudyPlan>("/api/study-plans", { method: "POST", body: JSON.stringify({ role, days, difficulty, skills: profile?.skills ?? "", weak_areas: weakAreas }) });
      onPlan(result);
    } catch (reason) { onError(messageOf(reason)); } finally { setBusy(false); }
  }
  async function toggle(taskId: number, completed: boolean) {
    try {
      const result = await api<StudyPlan>(`/api/study-tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ completed }) });
      onPlan(result);
    } catch (reason) { onError(messageOf(reason)); }
  }
  const done = plan?.tasks.filter((task) => task.completed).length ?? 0;
  return <>
    <PageTitle eyebrow="YOUR PERSONAL GAME PLAN" title="A plan that moves you forward." description="Small, focused steps. Built around your role, your skills, and what you want to improve." />
    <div className="planner-layout"><form className="panel planner-form" onSubmit={generate}><div className="panel-heading"><div><div className="eyebrow">PLAN YOUR PREP</div><h2>Build your schedule</h2></div><div className="panel-icon"><BookOpen size={17} /></div></div><label>Target job role<select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label><label>Preparation window<select value={days} onChange={(event) => setDays(Number(event.target.value))}>{[3, 5, 7, 10, 14, 21, 30].map((item) => <option key={item} value={item}>{item} days</option>)}</select></label><label>Target difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>{["Beginner", "Intermediate", "Advanced"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Focus areas <span className="optional-label">optional</span><textarea rows={3} value={weakAreas} onChange={(event) => setWeakAreas(event.target.value)} placeholder="e.g. System design, explaining my projects" /></label><div className="form-note"><Sparkles size={15} /> Your schedule is personalized with AI.</div><button className="button button-primary start-button" disabled={busy}>{busy ? <><span className="spinner" /> Building your plan...</> : <>{plan ? "Create a new plan" : "Generate my study plan"} <ArrowRight size={16} /></>}</button></form>
      <div className="panel plan-panel">
        <div className="panel-heading">
          <div><div className="eyebrow">{plan ? "YOUR STUDY SCHEDULE" : "READY WHEN YOU ARE"}</div><h2>{plan ? `${plan.days} days to feel ready` : "Your plan starts here"}</h2></div>
          {plan && <div className="plan-count">{done}<span>/{plan.tasks.length} done</span></div>}
        </div>
        {plan ? <>
          <div className="plan-progress"><span style={{ width: `${plan.tasks.length ? done / plan.tasks.length * 100 : 0}%` }} /></div>
          <div className="task-list">{plan.tasks.map((task) => <button key={task.id} className={`task-row ${task.completed ? "task-done" : ""}`} onClick={() => toggle(task.id, !task.completed)}>
            <div className={`task-check ${task.completed ? "checked" : ""}`}>{task.completed && <Check size={14} />}</div>
            <div className="task-content">
              <div><span className="task-day">DAY {String(task.day).padStart(2, "0")}</span><span className="task-topic">{task.topic}</span></div>
              <p>{task.task}</p>
              <span className="task-resources"><BookOpen size={12} /> Suggested resources: {task.resources.join(" · ")}</span>
            </div>
            <ChevronRight size={16} className="task-chevron" />
          </button>)}</div>
        </> : <div className="plan-empty"><div className="empty-graphic"><BookOpen size={24} /></div><h3>Make the prep feel doable.</h3><p>Tell us what role you're aiming for. We'll create a clear daily schedule with focused topics and actions.</p><div className="plan-points"><span><CheckCircle2 size={15} /> A new focus every day</span><span><CheckCircle2 size={15} /> Based on your own weak spots</span><span><CheckCircle2 size={15} /> Track what's complete</span></div></div>}
      </div>
    </div>
  </>;
}

function HistoryPage({ interviews }: { interviews: Interview[] }) {
  const [selected, setSelected] = useState<Interview | null>(null);
  return <>
    <PageTitle eyebrow="EVERY REP COUNTS" title="Your interview history." description="Look back at your sessions, review feedback, and notice how far you've come." />
    {interviews.length ? <div className="history-list">{interviews.map((item) => <button className="history-row" key={item.id} onClick={() => setSelected(item)}><div className="history-role-icon"><Code2 size={19} /></div><div className="history-info"><strong>{item.role}</strong><span>{item.interview_type} · {item.difficulty} · {formatDate(item.created_at)}</span></div>{item.questions.some((question) => question.prompt.startsWith("SAMPLE ONLY")) && <span className="sample-pill">Sample</span>}<span className={`status-pill ${item.status === "completed" ? "status-done" : "status-open"}`}><i />{item.status === "completed" ? "Completed" : "In progress"}</span><div className="history-score">{item.average_score === null ? "—" : <>{item.average_score}<small>/10</small></>}</div><ChevronRight size={17} className="muted-icon" /></button>)}</div> : <div className="panel history-empty"><EmptyState icon={<FileText size={19} />} title="Nothing here just yet" text="Once you complete an interview, it will be saved here with your detailed feedback." /></div>}
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="history-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">{formatDate(selected.created_at)} · {selected.interview_type.toUpperCase()}</div><h2>{selected.role}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close interview details"><X size={18} /></button></div>{selected.questions.some((question) => question.prompt.startsWith("SAMPLE ONLY")) && <div className="demo-sample-banner modal-sample-banner" role="note"><strong>DEMO SAMPLE</strong><span>Illustrative content only. These questions, scores, and feedback were not generated or evaluated by AI.</span></div>}<div className="modal-score-row"><span>{selected.questions.length} questions · {selected.difficulty}</span><strong>{selected.average_score === null ? "In progress" : <>{selected.average_score}<small>/10</small></>}</strong></div><div className="modal-questions">{selected.questions.map((question) => {
      const isSample = question.prompt.startsWith("SAMPLE ONLY");
      const visiblePrompt = isSample
        ? question.prompt.replace(/^SAMPLE ONLY.*?Demonstration question:\s*/, "Example question: ")
        : question.prompt;
      return <div className="modal-question" key={question.id}><div className="modal-q-meta"><span>QUESTION {question.position}</span><span>{question.category}</span></div>{isSample && <div className="sample-note">Illustrative sample question</div>}<h3>{visiblePrompt}</h3>{question.answer ? <div className="modal-answer"><strong>Your answer</strong><p>{question.answer}</p>{question.evaluation && <><div className="modal-feedback-score">{isSample ? "Illustrative sample score" : "AI feedback"} · {question.evaluation.overall_score}/10</div><p className="feedback-summary">{question.evaluation.strengths[0]} {question.evaluation.weaknesses[0] && `Focus next on: ${question.evaluation.weaknesses[0]}`}</p></>}</div> : <p className="muted-copy">No answer saved for this question.</p>}</div>;
    })}</div></div></div>}
  </>;
}

function ProfilePage({ profile, onSaved, onError }: { profile: Profile | null; onSaved: (profile: Profile) => void; onError: (message: string) => void }) {
  const [form, setForm] = useState<Profile>({ full_name: "", email: "", picture_url: null, education: "", skills: "", experience_level: "Entry level", preferred_role: "Software Engineer" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (profile) setForm(profile); }, [profile]);
  function change(field: keyof Profile, value: string) { setForm((current) => ({ ...current, [field]: value })); }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<Profile>("/api/profile", { method: "PUT", body: JSON.stringify({ full_name: form.full_name, education: form.education, skills: form.skills, experience_level: form.experience_level, preferred_role: form.preferred_role }) });
      onSaved(result);
    } catch (reason) { onError(messageOf(reason)); } finally { setBusy(false); }
  }
  return <>
    <PageTitle eyebrow="MAKE IT PERSONAL" title="A little about you." description="A few details help us make your questions and study plan more relevant." />
    <div className="profile-layout"><div className="panel profile-form-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR PROFILE</div><h2>Candidate details</h2></div><div className="panel-icon"><UserRound size={17} /></div></div><form className="profile-form" onSubmit={save}><label>Full name<input required minLength={2} maxLength={120} value={form.full_name} onChange={(event) => change("full_name", event.target.value)} /></label><label>Email address<input value={form.email} disabled /></label><label>Education<input maxLength={180} value={form.education} onChange={(event) => change("education", event.target.value)} placeholder="e.g. B.Tech Computer Science, 2025" /></label><div className="form-row"><label>Experience level<select value={form.experience_level} onChange={(event) => change("experience_level", event.target.value)}>{["Entry level", "0-2 years", "3-5 years", "5+ years"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Preferred role<select value={form.preferred_role} onChange={(event) => change("preferred_role", event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label></div><label>Technical skills<textarea rows={4} maxLength={1000} value={form.skills} onChange={(event) => change("skills", event.target.value)} placeholder="e.g. Python, SQL, React, machine learning" /><span className="field-note">Separate your skills with commas. We'll use these to personalize your interview questions.</span></label><div className="profile-actions"><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner" /> Saving...</> : <>Save changes <Check size={16} /></>}</button></div></form></div><div className="profile-side"><div className="panel profile-summary"><div className="profile-avatar-large">{form.picture_url && <img src={form.picture_url} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}<span>{initials(form.full_name || "You")}</span></div><h3>{form.full_name || "Your name"}</h3><p>{form.preferred_role}</p><div className="profile-detail"><span><GraduationCap size={15} /> Education</span><strong>{form.education || "Add your education"}</strong></div><div className="profile-detail"><span><Code2 size={15} /> Skills</span><strong>{form.skills || "Add your technical skills"}</strong></div></div><div className="profile-privacy"><ShieldCheck size={17} /><div><strong>Your information is yours.</strong><p>Your profile is only used to personalize your interview preparation.</p></div></div></div></div>
  </>;
}

function SettingsPage({ userEmail, onSignOut }: { userEmail: string; onSignOut: () => void }) {
  const [preferences, setPreferences] = useState<PracticePreferences>(() => getPreferences(undefined, userEmail));
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  function update<K extends keyof PracticePreferences>(key: K, value: PracticePreferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    try {
      localStorage.setItem(`interviewly_preferences_${encodeURIComponent(userEmail.toLowerCase())}`, JSON.stringify(preferences));
      setSaved(true);
      setSaveError("");
    } catch {
      setSaved(false);
      setSaveError("Your browser could not save preferences. Check available local storage and try again.");
    }
  }

  return <>
    <PageTitle eyebrow="WORKSPACE PREFERENCES" title="Make your prep feel like yours." description="Set defaults for new question sets and mock interview sessions." />
    <div className="settings-layout">
      <form className="panel settings-form" onSubmit={save}>
        <div className="panel-heading"><div><div className="eyebrow">PRACTICE DEFAULTS</div><h2>Your starting point</h2></div><div className="panel-icon"><Settings2 size={17} /></div></div>
        <label>Preferred job role<select value={preferences.role} onChange={(event) => update("role", event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="form-row">
          <label>Interview type<select value={preferences.interview_type} onChange={(event) => update("interview_type", event.target.value)}>{["Technical", "HR", "Behavioral", "Mixed"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Difficulty<select value={preferences.difficulty} onChange={(event) => update("difficulty", event.target.value)}>{["Beginner", "Intermediate", "Advanced"].map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <label>Default question count <span className="range-value">{preferences.question_count}</span><input className="range-input" type="range" min="3" max="12" value={preferences.question_count} onChange={(event) => update("question_count", Number(event.target.value))} /></label>
        <div className="settings-form-footer"><span role="status">{saveError || (saved ? "Preferences saved on this device." : "These defaults are used for your next practice session.")}</span><button className="button button-primary" type="submit">Save preferences <Check size={15} /></button></div>
      </form>
      <section className="panel settings-security">
        <div className="settings-security-icon"><ShieldCheck size={19} /></div>
        <div className="eyebrow">ACCOUNT &amp; PRIVACY</div>
        <h2>Your workspace stays yours.</h2>
        <p>Your interview answers, profile, and progress are kept with your account. Practice defaults are stored locally in this browser.</p>
        <div className="security-divider" />
        <button className="button button-secondary" onClick={onSignOut}><LogOut size={15} /> Sign out of this device</button>
      </section>
    </div>
  </>;
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="page-title"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></section>;
}

function EmptyState({ icon, title, text, action, onClick }: { icon: ReactNode; title: string; text: string; action?: string; onClick?: () => void }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p>{action && onClick && <button className="text-button" onClick={onClick}>{action} <ArrowRight size={14} /></button>}</div>;
}

function UserAvatar({ user, small = false }: { user: User; small?: boolean }) {
  return <span className={`avatar user-avatar ${small ? "avatar-small" : ""}`} aria-label={user.full_name}>
    {user.picture_url && <img src={user.picture_url} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}
    <span>{initials(user.full_name)}</span>
  </span>;
}

function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.71 7.18l7.63 5.92c4.45-4.1 7.12-10.14 7.12-17.57Z" />
    <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.88l-7.63-5.92c-2.12 1.42-4.84 2.27-8.27 2.27-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
  </svg>;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : "Something went wrong. Please try again.";
}
const tooltipStyle = { background: "#101A2B", border: "1px solid #1E293B", borderRadius: 10, color: "#F8FAFC", fontSize: 12 };

export default App;
