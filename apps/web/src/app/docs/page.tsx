import { RequireAdmin } from "@/components/require-admin";
import { DocsViewer } from "@/components/docs-viewer";

export default function DocsPage() {
  return (
    <RequireAdmin>
      <DocsViewer />
    </RequireAdmin>
  );
}
