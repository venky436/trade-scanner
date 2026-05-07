"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useAuth } from "@/context/auth-context";

// Frontend admin guard. Wrap any admin-only page body in <RequireAdmin>:
//
//   export default function Page() {
//     return <RequireAdmin><AdminDashboard /></RequireAdmin>;
//   }
//
// Behaviour:
//   - While auth is loading → spinner
//   - Authenticated admin → renders children
//   - Authenticated non-admin → shows a brief "Access Denied" card and
//     redirects to / after ~1.5s (gives the user a chance to read the message
//     instead of bouncing instantly without context)
//   - Unauthenticated → redirects to /login (AuthContext also enforces this)
//
// Backend always re-validates via adminGuard middleware on the API endpoints,
// so this guard is UX-only — it stops the page from rendering admin chrome
// for non-admins and prevents the "page renders, then API silently 403s"
// confusion the audit flagged.
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const isAdmin = user?.role === "ADMIN";

  // Redirect non-admins after a short delay so they see the access-denied card
  // before the route changes.
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      // AuthContext handles redirect to /login; nothing extra to do here.
      return;
    }
    if (!isAdmin) {
      const id = window.setTimeout(() => router.replace("/"), 1500);
      return () => window.clearTimeout(id);
    }
  }, [isLoading, user, isAdmin, router]);

  if (isLoading || !user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="size-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-20">
        <div className="mx-auto max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] px-6 py-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-rose-500/15 ring-1 ring-rose-400/30">
            <Lock className="size-5 text-rose-600 dark:text-rose-400" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Admin access required
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            This page is only available to admin accounts. Returning to the home dashboard…
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
