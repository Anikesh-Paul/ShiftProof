import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { AuthProvider, useAuth, type AppRole } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { NoRolePage } from "./pages/NoRolePage";
import { ComplianceExport } from "./pages/manager/ComplianceExport";
import { ManagerHome } from "./pages/manager/ManagerHome";
import { ManagerShiftDetail } from "./pages/manager/ManagerShiftDetail";
import { MyShifts } from "./pages/staff/MyShifts";
import { ShiftPhotos } from "./pages/staff/ShiftPhotos";
import { StaffHome } from "./pages/staff/StaffHome";

function RequireAuth({ allow }: { allow: AppRole[] }) {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="app-page">
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!allow.includes(role)) {
    if (role === "manager") return <Navigate to="/manager" replace />;
    if (role === "staff") return <Navigate to="/staff" replace />;
    return <Navigate to="/no-role" replace />;
  }

  return <Outlet />;
}

function HomeRedirect() {
  const { user, role, loading } = useAuth();
  if (loading) {
    return (
      <div className="app-page">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (role === "manager") return <Navigate to="/manager" replace />;
  if (role === "staff") return <Navigate to="/staff" replace />;
  return <Navigate to="/no-role" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<HomeRedirect />} />

        <Route element={<RequireAuth allow={["staff"]} />}>
          <Route element={<Shell title="Staff" variant="staff" />}>
            <Route path="/staff" element={<StaffHome />} />
            <Route path="/staff/shifts" element={<MyShifts />} />
            <Route path="/staff/shifts/:shiftId" element={<ShiftPhotos />} />
          </Route>
        </Route>

        <Route element={<RequireAuth allow={["manager"]} />}>
          <Route element={<Shell title="Manager" variant="manager" />}>
            <Route path="/manager" element={<ManagerHome />} />
            <Route
              path="/manager/shifts/:shiftId"
              element={<ManagerShiftDetail />}
            />
            <Route
              path="/manager/shifts/:shiftId/export"
              element={<ComplianceExport />}
            />
          </Route>
        </Route>

        <Route element={<RequireAuth allow={["none"]} />}>
          <Route path="/no-role" element={<NoRolePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
