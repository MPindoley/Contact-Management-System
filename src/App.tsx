import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppProvider, useApp } from "./lib/store";
import { ToastProvider } from "./lib/toast";
import { Layout } from "./components/Layout";
import { SignIn } from "./screens/SignIn";
import { ResetPassword } from "./screens/ResetPassword";
import { Dashboard } from "./screens/Dashboard";
import { ActionQueue } from "./screens/ActionQueue";
import { Clients } from "./screens/Clients";
import { ClientProfile } from "./screens/ClientProfile";
import { FirmReport } from "./screens/FirmReport";
import { ServiceModels } from "./screens/ServiceModels";
import { LogoMark } from "./components/icons";
import { Button, Spinner } from "./components/ui";

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper">
      <LogoMark className="size-10 animate-pulse text-pine-700" />
      <Spinner />
    </div>
  );
}

function RequireAuth() {
  const { authReady, currentUser, data, loading, error, refresh } = useApp();

  if (!authReady) return <Splash />;
  if (!currentUser) return <Navigate to="/signin" replace />;

  if (!data) {
    if (loading || !error) return <Splash />;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
        <LogoMark className="size-10 text-clay-600" />
        <p className="max-w-md text-sm text-ink-soft">{error}</p>
        <Button variant="primary" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  return <Outlet />;
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="queue" element={<ActionQueue />} />
                <Route path="clients" element={<Clients />} />
                <Route path="clients/:clientId" element={<ClientProfile />} />
                <Route path="report" element={<FirmReport />} />
                <Route path="settings/service-models" element={<ServiceModels />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AppProvider>
  );
}
