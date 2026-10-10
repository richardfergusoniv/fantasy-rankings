import { createContext, useContext, type ReactNode } from "react";

export type AuthSessionValue = {
  sleeperUsername: string | null;
  signOut: (() => void) | null;
};

const AuthSessionContext = createContext<AuthSessionValue>({
  sleeperUsername: null,
  signOut: null,
});

export function AuthSessionProvider({
  value,
  children,
}: {
  value: AuthSessionValue;
  children: ReactNode;
}) {
  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionValue {
  return useContext(AuthSessionContext);
}
