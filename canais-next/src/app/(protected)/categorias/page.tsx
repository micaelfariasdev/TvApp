"use client";

import Link from "next/link";
import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import type { CatalogItem } from "@/lib/catalog";
import { appPath } from "@/lib/app-path";
import { useAdminSession } from "@/lib/admin-session";
import { useCatalog } from "@/lib/use-catalog";

export default function CategoriesPage() {
  const { items, isLoading, error, reload } = useCatalog();
  const categories = [...new Set(items.map((item) => item.category))].sort(
    (left, right) => left.localeCompare(right, "pt-BR"),
  );

  return (
    <AdminShell>
      <div className="page-content">
        <div className="catalog-page-heading">
          <div>
            <span className="eyebrow">ORGANIZAÇÃO</span>
            <h1>Categorias</h1>
            <p>Uma visão centralizada das categorias usadas no catálogo.</p>
          </div>
        </div>
        <section className="category-overview-grid">
          {categories.map((category, index) => {
            const matchingItems = items.filter((item) => item.category === category);
            return (
              <article className="category-overview-card" key={category}>
                <div className={`category-color category-color-${index % 5}`} />
                <div className="category-overview-top">
                  <span className={`category-icon category-icon-${index % 5}`}>▦</span>
                  <button aria-label={`Mais opções para ${category}`} className="card-menu" type="button">···</button>
                </div>
                <h2>{category}</h2>
                <p>{matchingItems.length} {matchingItems.length === 1 ? "item" : "itens"}</p>
                <div className="category-tags">
                  {[...new Set(matchingItems.map((item) => item.kindLabel))].map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <CategoryKindEditor
                  category={category}
                  items={matchingItems}
                  onUpdated={reload}
                />
                <Link
                  className="category-open-link"
                  href={getCategoryHref(matchingItems[0]?.kind)}
                >
                  Ver conteúdo <span aria-hidden="true">→</span>
                </Link>
              </article>
            );
          })}
        </section>
        {error ? (
          <div className="catalog-data-message" role="alert">
            <span>{error}</span>
            <button className="button button-secondary" onClick={reload} type="button">
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="demo-note">
            {isLoading ? "Carregando categorias do servidor..." : "Categorias extraídas do catálogo real do servidor."}
          </p>
        )}
      </div>
    </AdminShell>
  );
}

function CategoryKindEditor({
  category,
  items,
  onUpdated,
}: {
  category: string;
  items: CatalogItem[];
  onUpdated: () => void;
}) {
  const { requestLogin } = useAdminSession();
  const currentKinds = [...new Set(items.map((item) => item.kind))];
  const editableCount = items.filter((item) => item.kind === "movie" || item.kind === "live").length;
  const [kind, setKind] = useState<"movie" | "live">(
    currentKinds.length === 1 && currentKinds[0] === "live" ? "live" : "movie",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function updateCategory() {
    if (!window.confirm(`Aplicar ${kind === "movie" ? "Filme" : "Ao vivo"} a ${editableCount} itens editáveis da categoria "${category}"?`)) {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(appPath("/api/catalog/categories"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, kind }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        requestLogin();
        setMessage("Entre no painel e aplique a alteração novamente.");
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar a categoria.");
      setMessage(`${payload.updated} itens atualizados.`);
      onUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar a categoria.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!editableCount) {
    return <p className="category-type-note">Sem filmes ou canais editáveis nesta categoria.</p>;
  }

  return (
    <div className="category-type-editor">
      <label>
        Definir como
        <select
          onChange={(event) => setKind(event.target.value as "movie" | "live")}
          value={kind}
        >
          <option value="movie">Filme</option>
          <option value="live">Ao vivo</option>
        </select>
      </label>
      <button
        className="button button-secondary"
        disabled={isSaving}
        onClick={updateCategory}
        type="button"
      >
        {isSaving ? "Salvando..." : "Aplicar à categoria"}
      </button>
      {currentKinds.length > 1 && (
        <p className="category-type-note">
          Esta categoria contém tipos mistos; a alteração afeta apenas filmes e canais ao vivo.
        </p>
      )}
      {message && <p className="category-type-note" role="status">{message}</p>}
    </div>
  );
}

function getCategoryHref(kind?: string) {
  if (kind === "movie") return "/filmes";
  if (kind === "series") return "/series";
  if (kind === "kick") return "/kick";
  return "/ao-vivo";
}
