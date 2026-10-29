"use client";

import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCatalogCounts, getRecentCatalog } from "@/lib/catalog";
import { useCatalog } from "@/lib/use-catalog";

const countFormatter = new Intl.NumberFormat("pt-BR");

export default function HomePage() {
  const { items, isLoading, error, reload } = useCatalog();
  const counts = getCatalogCounts(items);
  const recent = getRecentCatalog(items).slice(0, 5);

  return (
    <AdminShell>
      <div className="page-content">
        <section className="welcome-banner">
          <div className="welcome-copy">
            <span className="eyebrow eyebrow-light">PAINEL DO CATÁLOGO</span>
            <h1>Seu conteúdo, em um só lugar.</h1>
            <p>
              Organize filmes, séries e canais ao vivo com uma visão clara do
              que está acontecendo no seu catálogo.
            </p>
            <Link className="button button-light" href="/filmes">
              Explorar catálogo <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="art-orbit art-orbit-one" />
            <div className="art-orbit art-orbit-two" />
            <div className="art-screen">
              <span className="art-play">▶</span>
              <span className="art-screen-line" />
              <span className="art-screen-line art-screen-line-short" />
            </div>
            <div className="art-spark art-spark-one">✦</div>
            <div className="art-spark art-spark-two">✦</div>
          </div>
        </section>

        <section className="stats-grid" aria-label="Resumo do catálogo">
          <article className="stat-card">
            <div className="stat-heading">
              <span className="stat-icon stat-icon-violet">▣</span>
              <span className="stat-trend">Catálogo</span>
            </div>
            <p className="stat-value">{countFormatter.format(items.length)}</p>
            <p className="stat-label">itens cadastrados</p>
          </article>
          <article className="stat-card">
            <div className="stat-heading">
              <span className="stat-icon stat-icon-blue">▰</span>
              <span className="stat-trend">Biblioteca</span>
            </div>
            <p className="stat-value">{countFormatter.format(counts.movies)}</p>
            <p className="stat-label">filmes disponíveis</p>
          </article>
          <article className="stat-card">
            <div className="stat-heading">
              <span className="stat-icon stat-icon-amber">▤</span>
              <span className="stat-trend">Episódios agrupados</span>
            </div>
            <p className="stat-value">{countFormatter.format(counts.series)}</p>
            <p className="stat-label">séries no catálogo</p>
          </article>
          <article className="stat-card">
            <div className="stat-heading">
              <span className="stat-icon stat-icon-green">●</span>
              <span className="stat-trend">Agora</span>
            </div>
            <p className="stat-value">{countFormatter.format(counts.live + counts.kick)}</p>
            <p className="stat-label">canais ao vivo</p>
          </article>
        </section>

        <section className="section-heading">
          <div>
            <span className="eyebrow">ACESSO RÁPIDO</span>
            <h2>Gerencie por tipo</h2>
            <p>Encontre o que procura sem misturar formatos diferentes.</p>
          </div>
        </section>

        <section className="collection-grid">
          <CollectionCard
            href="/filmes"
            icon="▣"
            tone="violet"
            title="Filmes"
            count={counts.movies}
            detail="Capas, categorias e disponibilidade"
          />
          <CollectionCard
            href="/series"
            icon="▤"
            tone="amber"
            title="Séries"
            count={counts.series}
            detail="Temporadas e episódios em um só lugar"
          />
          <CollectionCard
            href="/ao-vivo"
            icon="●"
            tone="green"
            title="Ao vivo"
            count={counts.live}
            detail="Canais de televisão e transmissões"
          />
          <CollectionCard
            href="/kick"
            icon="▶"
            tone="blue"
            title="Kick"
            count={counts.kick}
            detail="Streamers e canais da Kick"
          />
        </section>

        <section className="section-heading recent-heading">
          <div>
            <span className="eyebrow">ATUALIZADO RECENTEMENTE</span>
            <h2>Últimos itens do catálogo</h2>
            <p>Uma visão rápida das novidades cadastradas.</p>
          </div>
          <Link className="text-link" href="/filmes">
            Ver catálogo <span aria-hidden="true">→</span>
          </Link>
        </section>

        <section className="recent-list">
          {recent.map((item) => (
            <Link
              className="recent-row"
              href={`/${item.kind === "movie" ? "filmes" : item.kind === "series" ? "series" : item.kind === "kick" ? "kick" : "ao-vivo"}`}
              key={item.id}
            >
              <span className={`mini-poster poster-${item.posterTone}`}>
                {item.posterMark}
              </span>
              <span className="recent-title">
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
              <span className={`type-pill type-${item.kind}`}>
                {item.kindLabel}
              </span>
              <span className="recent-date">{item.addedLabel}</span>
              <span className="row-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </section>
        <div className="catalog-data-message" aria-live="polite">
          {isLoading && <span>Carregando catálogo do servidor...</span>}
          {error && (
            <>
              <span>{error}</span>
              <button className="button button-secondary" onClick={reload} type="button">
                Tentar novamente
              </button>
            </>
          )}
          {!isLoading && !error && (
            <span>Dados reais sincronizados com a API v2 do servidor.</span>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function CollectionCard({
  href,
  icon,
  tone,
  title,
  count,
  detail,
}: {
  href: string;
  icon: string;
  tone: string;
  title: string;
  count: number;
  detail: string;
}) {
  return (
    <Link className="collection-card" href={href}>
      <span className={`collection-icon stat-icon-${tone}`}>{icon}</span>
      <span className="collection-info">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="collection-count">{count}</span>
      <span className="collection-arrow" aria-hidden="true">→</span>
    </Link>
  );
}
