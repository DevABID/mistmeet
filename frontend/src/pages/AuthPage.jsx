import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function AuthPage({ mode }) {
  const isLogin = mode === "login";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const next = location.state?.from || "/";
  const [form, setForm] = useState({ full_name: "", username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isLogin) await login(form.username, form.password);
      else await register(form);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo />
        <h1>{isLogin ? "Sign in" : "Create your account"}</h1>
        <p className="muted">
          {isLogin ? "Use your MIST Meet account to start or join a call." : "You'll use this name in every meeting you join."}
        </p>
        <form onSubmit={submit} className="form">
          {!isLogin && (
            <label>
              Full name
              <input value={form.full_name} onChange={update("full_name")} autoComplete="name" />
            </label>
          )}
          <label>
            {isLogin ? "Username or email" : "Username"}
            <input value={form.username} onChange={update("username")} autoComplete="username" required />
          </label>
          {!isLogin && (
            <label>
              Email
              <input type="email" value={form.email} onChange={update("email")} autoComplete="email" required />
            </label>
          )}
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={update("password")}
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={isLogin ? undefined : 8}
              required
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="auth-switch">
          {isLogin ? "New to MIST Meet?" : "Already have an account?"}{" "}
          <Link to={isLogin ? "/register" : "/login"} state={location.state}>
            {isLogin ? "Create an account" : "Sign in"}
          </Link>
        </p>
      </div>
    </div>
  );
}
