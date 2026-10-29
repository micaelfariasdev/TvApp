import { CatalogView } from "@/components/catalog-view";
import { AdminShell } from "@/components/admin-shell";

export default function LivePage() {
  return (
    <AdminShell>
      <CatalogView
        kind="live"
      />
    </AdminShell>
  );
}
