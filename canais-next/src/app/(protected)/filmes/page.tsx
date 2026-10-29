import { CatalogView } from "@/components/catalog-view";
import { AdminShell } from "@/components/admin-shell";

export default function MoviesPage() {
  return (
    <AdminShell>
      <CatalogView
        kind="movie"
      />
    </AdminShell>
  );
}
