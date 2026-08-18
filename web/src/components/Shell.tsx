import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { SheetChromeContext } from "../lib/sheetChrome";
import { Button } from "./Button";
import "./Shell.css";

type ShellProps = {
  title: string;
  variant: "staff" | "manager" | "plain";
};

function useNarrowPhone() {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 639px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function Shell({ title, variant }: ShellProps) {
  const { user, logout } = useAuth();
  const narrowPhone = useNarrowPhone();
  const hasStaffNav = variant === "staff";
  const slimAccount = variant === "manager" && narrowPhone;
  const [chromeInert, setChromeInert] = useState(false);

  return (
    <SheetChromeContext.Provider value={setChromeInert}>
      <div className="shell">
        <header
          className={`shell-chrome${hasStaffNav ? " shell-chrome--staff" : ""}`}
          data-testid="shell-chrome"
          inert={chromeInert ? true : undefined}
        >
          <div className="shell-chrome-inner">
            <div className="shell-brand">
              <span className="shell-wordmark">ShiftProof</span>
              {!hasStaffNav && !slimAccount ? (
                <span className="shell-role">{title}</span>
              ) : null}
            </div>

            {hasStaffNav ? (
              <nav className="shell-nav" aria-label="Staff" data-testid="shell-nav">
                <NavLink to="/staff" end className={navClass}>
                  Opening
                </NavLink>
                <NavLink to="/staff/shifts" end className={navClass}>
                  History
                </NavLink>
              </nav>
            ) : null}

            <div className="shell-user">
              {slimAccount ? (
                <details className="shell-account">
                  <summary
                    className="shell-account-trigger"
                    data-testid="shell-overflow"
                    aria-label="Account"
                  >
                    ···
                  </summary>
                  <div className="shell-account-menu">
                    <p className="shell-account-role">{title}</p>
                    <p className="shell-account-name" title={user?.email}>
                      {user?.name || user?.email}
                    </p>
                    <Button
                      variant="quiet"
                      onClick={() => void logout()}
                      className="shell-account-logout"
                    >
                      Log out
                    </Button>
                  </div>
                </details>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </header>
        <main className="shell-main">
          <Outlet />
        </main>
      </div>
    </SheetChromeContext.Provider>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return `shell-nav-link${isActive ? " is-active" : ""}`;
}
