"use client";

import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { GlobalNav } from "./global-nav";
import { SiteFooter } from "./site-footer";

// Routes that render without the auth wall — login/signup forms and the
// public landing page at "/".
const PUBLIC_ROUTES = new Set(["/login", "/signup", "/"]);

function AppContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading, isAuthenticated } = useAuth();
  const isAuthForm = pathname === "/login" || pathname === "/signup";
  const isPublicLanding = pathname === "/" && !isAuthenticated;

  // Loading spinner — shown while we're checking session, except on auth forms
  // and the public landing (those should render immediately for guest UX).
  if (isLoading && !isAuthForm && !isPublicLanding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="size-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Login / signup — no nav, no footer
  if (isAuthForm) {
    return <>{children}</>;
  }

  // Authenticated — full chrome (nav + footer)
  if (isAuthenticated) {
    return (
      <>
        <GlobalNav />
        {children}
        <SiteFooter />
      </>
    );
  }

  // Unauthenticated on a public route ("/") — render the page only, no
  // GlobalNav (the landing has its own minimal header). Footer is fine.
  if (PUBLIC_ROUTES.has(pathname)) {
    return (
      <>
        {children}
        <SiteFooter />
      </>
    );
  }

  // Anything else for an unauth user → AuthContext effect is already redirecting
  // them to /login. Render nothing here to avoid flash.
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppContent>{children}</AppContent>
    </AuthProvider>
  );
}
