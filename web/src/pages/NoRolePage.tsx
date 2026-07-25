import { Button } from "../components/Button";
import { useAuth } from "../lib/auth";

export function NoRolePage() {
  const { user, logout } = useAuth();

  return (
    <div className="app-page stack">
      <header className="stack-sm">
        <h1>No role yet</h1>
        <p className="muted">
          Signed in{user?.email ? ` as ${user.email}` : ""}, but this account
          has no staff or manager access.
        </p>
      </header>
      <div className="card stack">
        <p className="muted">
          Ask an admin to add an Appwrite label: <code>staff</code> or{" "}
          <code>manager</code>.
        </p>
        <Button variant="secondary" onClick={() => void logout()}>
          Log out
        </Button>
      </div>
    </div>
  );
}
