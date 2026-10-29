"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { SeriesDetailView } from "@/components/series-detail-view";

function SeriesDetailPageContent() {
  const params = useParams<{ id: string }>();

  return (
    <AdminShell>
      <SeriesDetailView id={params.id} />
    </AdminShell>
  );
}

export default function SeriesDetailPage() {
  return (
    <Suspense fallback={<div className="page-content"><p className="catalog-loading">Carregando série...</p></div>}>
      <SeriesDetailPageContent />
    </Suspense>
  );
}
