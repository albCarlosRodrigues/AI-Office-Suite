import { createContext, useContext, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

const LOCAL_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "local@ai-office",
  user_metadata: { display_name: "Operador local" },
} as unknown as User;

interface LocalOperatorState {
  user: User;
  loading: false;
}

const AuthContext = createContext<LocalOperatorState>({ user: LOCAL_USER, loading: false });

/** Compatibility provider for components that display the local operator. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={{ user: LOCAL_USER, loading: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
