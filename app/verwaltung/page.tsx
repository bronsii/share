import { AdminBackLink, AdminPanel } from "./admin-panel";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <main className="admin-page">
      <AdminBackLink />
      <AdminPanel />
    </main>
  );
}
