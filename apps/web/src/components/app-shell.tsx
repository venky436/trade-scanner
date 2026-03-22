"use client";

import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { GlobalNav } from "./global-nav";

function AppContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading, isAuthenticated } = useAuth();
  const isLoginPage = pathname === "/login" || pathname === "/signup";

  // Show nothing while checking auth (prevents flash)
  if (isLoading && !isLoginPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="size-8 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Login page — no nav
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Authenticated pages — show nav
  if (isAuthenticated) {
    return (
      <>
        <GlobalNav />
        {children}
      </>
    );
  }

  // Not authenticated, not login page — auth context will redirect
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppContent>{children}</AppContent>
    </AuthProvider>
  );
}
