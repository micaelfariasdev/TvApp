import { CatalogView } from "@/components/catalog-view";
import { AdminShell } from "@/components/admin-shell";

export default function KickPage() {
  return (
    <AdminShell>
      <CatalogView
        kind="kick"
      />
    </AdminShell>
  );
}
