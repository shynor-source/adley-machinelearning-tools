import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  EyeOff,
  FolderCheck,
  HardDrive,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Brand } from "../components/Brand";
import { Button, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";

export function LoginPage() {
  const { status, error: authError, login, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (status === "authenticated") return <Navigate to={from} replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    clearError();
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (reason) {
      if (reason instanceof ApiError) {
        if (reason.status === 429) {
          const wait = reason.retryAfter
            ? ` Try again in about ${reason.retryAfter} seconds.`
            : " Try again in a few minutes.";
          setFormError(`${reason.message}${wait}`);
        } else if (reason.status === 401) {
          setFormError("That username or password is not correct.");
        } else {
          setFormError(reason.message);
        }
      } else {
        setFormError(reason instanceof Error ? reason.message : "Could not sign in.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const shownError = formError ?? authError;

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_5%,rgba(52,211,153,.13),transparent_30%),radial-gradient(circle_at_88%_20%,rgba(56,189,248,.11),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.22] [background-image:linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:52px_52px]" />

      <div className="relative mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[1.1fr_.9fr]">
        <section className="flex flex-col justify-between px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
          <Brand />
          <div className="my-12 max-w-xl lg:my-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-mint-400/20 bg-mint-400/10 px-3 py-1.5 text-xs font-semibold text-mint-300">
              <Sparkles className="h-3.5 w-3.5" />
              Local-first machine learning workspace
            </div>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl">
              Build training data
              <span className="block bg-gradient-to-r from-mint-300 via-emerald-200 to-sky-300 bg-clip-text text-transparent">
                without uploading it.
              </span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-slate-400">
              Sort large image collections into classes directly on your computer. Your originals
              stay untouched, and progress is saved in a checkpoint beside the results.
            </p>

            <div className="mt-9 grid max-w-lg gap-3 sm:grid-cols-2">
              {[
                {
                  icon: HardDrive,
                  title: "Folder-native",
                  text: "Reads nested folders in place.",
                },
                {
                  icon: FolderCheck,
                  title: "Crash-safe",
                  text: "Resume from result checkpoints.",
                },
                {
                  icon: ShieldCheck,
                  title: "Never overwrites",
                  text: "Collision-safe destination names.",
                },
                {
                  icon: LockKeyhole,
                  title: "No database",
                  text: "Stateless server, local results.",
                },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5"
                >
                  <feature.icon className="h-4 w-4 text-mint-300" />
                  <p className="mt-3 text-sm font-medium text-slate-200">{feature.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-600">
            Chrome / Edge desktop · local image folders · result checkpoint files
          </p>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-8 lg:border-l lg:border-white/[0.06] lg:bg-white/[0.015] lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Brand />
            </div>
            <div className="rounded-2xl border border-white/10 bg-ink-900/80 p-6 shadow-panel backdrop-blur-xl sm:p-8">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-mint-400/20 bg-mint-400/10">
                  <LockKeyhole className="h-5 w-5 text-mint-300" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white">
                  Sign in to your workspace
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Use the Adley team account to open the labeling tools.
                </p>
              </div>

              <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label
                    htmlFor="username"
                    className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                  >
                    Username
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="h-12 w-full rounded-xl border border-white/10 bg-ink-950/70 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-mint-400/40 focus:ring-2 focus:ring-mint-400/15"
                    placeholder="Enter your username"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      autoFocus
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 w-full rounded-xl border border-white/10 bg-ink-950/70 px-4 pr-12 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-mint-400/40 focus:ring-2 focus:ring-mint-400/15"
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {shownError ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-sm leading-6 text-rose-200"
                  >
                    {shownError}
                  </div>
                ) : null}

                <Button type="submit" size="lg" className="w-full" loading={submitting}>
                  Sign in
                  {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
                </Button>
              </form>

              <div className="mt-6 border-t border-white/[0.06] pt-5">
                <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-400/80" />
                  Sign-in is rate limited. Your datasets never pass through the server.
                </p>
              </div>
            </div>
            <p className="mt-5 text-center text-xs text-slate-600">
              Adley Machine Learning Tools · v1.0
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
