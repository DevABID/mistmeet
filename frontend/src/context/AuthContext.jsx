import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api("/auth/me/")
      .then(setUser)
      .catch((e) => {
        if (e.status === 401 || e.status === 403) setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const finish = useCallback(({ token, user } = {}) => {
    if (!token || !user) throw new Error("Sign-in didn't complete. The server sent an unexpected reply.");
    setToken(token);
    setUser(user);
    return user;
  }, []);

  const login = useCallback(
    (username, password) => api("/auth/login/", { method: "POST", body: { username, password } }).then(finish),
    [finish]
  );
  const register = useCallback(
    (data) => api("/auth/register/", { method: "POST", body: data }).then(finish),
    [finish]
  );
  const logout = useCallback(async () => {
    await api("/auth/logout/", { method: "POST" }).catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
