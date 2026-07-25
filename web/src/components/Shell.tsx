import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "./Button";
import "./Shell.css";

type ShellProps = {
  title: string;
  variant: "staff" | "manager" | "plain";
};

export function Shell({ title, variant }: ShellProps) {
  const { user, logout } = useAuth();
  const hasStaffNav = variant === "staff";

  return (
    <div className="shell">
      <header
        className={`shell-chrome${hasStaffNav ? " shell-chrome--staff" : ""}`}
        data-testid="shell-chrome"
      >
        <div className="shell-chrome-inner">
          <div className="shell-brand">
            <span className="shell-wordmark">ShiftProof</span>
            {/* Role label only when no inline nav (manager / plain) */}
            {!hasStaffNav ? (
              <span className="shell-role">{title}</span>
            ) : null}
          </div>

          {hasStaffNav ? (
            <nav className="shell-nav" aria-label="Staff" data-testid="shell-nav">
              <NavLink to="/staff" end className={navClass}>
                Opening
              </NavLink>
              <NavLink to="/staff/shifts" className={navClass}>
                History
              </NavLink>
            </nav>
          ) : null}

          <div className="shell-user">
            <span className="shell-name" title={user?.email}>
              {user?.name || user?.email}
            </span>
            <Button
              variant="quiet"
              onClick={() => void logout()}
              className="shell-logout"
            >
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return `shell-nav-link${isActive ? " is-active" : ""}`;
}
