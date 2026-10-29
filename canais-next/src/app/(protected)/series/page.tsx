import { CatalogView } from "@/components/catalog-view";
import { AdminShell } from "@/components/admin-shell";

export default function SeriesPage() {
  return (
    <AdminShell>
      <CatalogView
        kind="series"
      />
    </AdminShell>
  );
}
