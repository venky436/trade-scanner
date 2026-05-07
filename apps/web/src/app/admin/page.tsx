import Link from "next/link";
import { RequireAdmin } from "@/components/require-admin";

export default function AdminPage() {
  return (
    <RequireAdmin>
      <main className="max-w-[1400px] mx-auto px-6 py-20">
        <div className="flex flex-col items-center justify-center text-center min-h-[40vh]">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Admin Dashboard
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
            Currently not available.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Link
              href="/admin/tracking"
              className="px-4 py-2 rounded-md text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            >
              Tracking
            </Link>
            <Link
              href="/social"
              className="px-4 py-2 rounded-md text-xs font-semibold border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
            >
              Social
            </Link>
          </div>
        </div>
      </main>
    </RequireAdmin>
  );
}
