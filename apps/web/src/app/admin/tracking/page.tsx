import { RequireAdmin } from "@/components/require-admin";
import { TrackingDashboard } from "@/components/tracking-dashboard";

export default function TrackingPage() {
  return (
    <RequireAdmin>
      <TrackingDashboard />
    </RequireAdmin>
  );
}
