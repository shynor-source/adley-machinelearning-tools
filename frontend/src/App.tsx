import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Spinner } from "./components/ui";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./context/AuthContext";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { NewSessionPage } from "./pages/NewSessionPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SessionsPage } from "./pages/SessionsPage";
import { ToolDetailPage } from "./pages/ToolDetailPage";
import { WorkspacePage } from "./pages/WorkspacePage";

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-7 w-7" />
        <p className="text-xs text-slate-600">Checking your session…</p>
      </div>
    </div>
  );
}

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="labeling/new" element={<NewSessionPage />} />
          <Route path="labeling/sessions" element={<SessionsPage />} />
          <Route path="labeling/workspace" element={<WorkspacePage />} />
          <Route path="tools/:id" element={<ToolDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
