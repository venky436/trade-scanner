"use client";

import { Dashboard } from "@/components/dashboard";
import { Landing } from "@/components/landing";
import { useAuth } from "@/context/auth-context";

// Conditional home: unauthenticated visitors see the public landing page;
// signed-in users see the live Dashboard at the same URL. AppShell is
// configured to skip the auto-redirect on "/" so the landing actually renders
// for guests instead of being bounced to /login.
export default function Home() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="size-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return user ? <Dashboard /> : <Landing />;
}
