"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { appPath } from "@/lib/app-path";
import { useAdminSession } from "@/lib/admin-session";

type Episode = {
  number: number;
  title: string;
  url: string;
  type: "hls" | "mp4";
};

type Season = {
  number: number;
  episodes: Episode[];
};

type SeriesDetails = {
  id: string;
  title: string;
  poster: string | null;
  seasons: Season[];
};

type EpisodeForm = {
  seasonNumber: string;
  number: string;
  title: string;
  url: string;
  type: "hls" | "mp4";
};

export function SeriesDetailView({ id }: { id: string }) {
  const { requestLogin } = useAdminSession();
  const [details, setDetails] = useState<SeriesDetails | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSeasonForm, setShowSeasonForm] = useState(false);
  const [showEpisodeForm, setShowEpisodeForm] = useState(false);
  const [newSeasonNumber, setNewSeasonNumber] = useState("");
  const [episodeForm, setEpisodeForm] = useState<EpisodeForm>({
    seasonNumber: "",
    number: "",
    title: "",
    url: "",
    type: "hls",
  });
  const [episodeTarget, setEpisodeTarget] = useState<{
    seasonNumber: number;
    episodeNumber: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch(appPath(`/api/catalog/series/${encodeURIComponent(id)}`), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : `Falha ao carregar a série (HTTP ${response.status}).`;
          throw new Error(message);
        }
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("seasons" in payload) ||
          !Array.isArray(payload.seasons)
        ) {
          throw new Error("O servidor retornou detalhes de série inválidos.");
        }
        const result = payload as SeriesDetails;
        setDetails(result);
        setActiveSeason((current) =>
          result.seasons.some((season) => season.number === current)
            ? current
            : result.seasons[0]?.number ?? null,
        );
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Não foi possível carregar os episódios da série.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [id, refreshKey]);

  const selectedSeason = details?.seasons.find((season) => season.number === activeSeason);
  const episodeCount =
    details?.seasons.reduce((total, season) => total + season.episodes.length, 0) ?? 0;

  function openSeasonForm() {
    const nextNumber = Math.max(0, ...(details?.seasons.map((season) => season.number) ?? [])) + 1;
    setNewSeasonNumber(String(nextNumber));
    setActionError("");
    setShowSeasonForm(true);
  }

  function openAddEpisode() {
    if (!selectedSeason) return;
    const nextNumber =
      Math.max(0, ...selectedSeason.episodes.map((episode) => episode.number)) + 1;
    setEpisodeTarget(null);
    setEpisodeForm({
      seasonNumber: String(selectedSeason.number),
      number: String(nextNumber),
      title: "",
      url: "",
      type: "hls",
    });
    setShowEpisodeForm(true);
    setActionError("");
  }

  function openEditEpisode(season: Season, episode: Episode) {
    setEpisodeTarget({ seasonNumber: season.number, episodeNumber: episode.number });
    setEpisodeForm({
      seasonNumber: String(season.number),
      number: String(episode.number),
      title: episode.title,
      url: episode.url,
      type: episode.type,
    });
    setShowEpisodeForm(true);
    setActionError("");
  }

  async function saveSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setActionError("");
    try {
      const response = await fetch(appPath(`/api/catalog/series/${encodeURIComponent(id)}/seasons`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: Number(newSeasonNumber) }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        setActionError("Entre no painel para criar uma temporada.");
        requestLogin();
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Não foi possível criar a temporada.");

      setShowSeasonForm(false);
      setActiveSeason(Number(newSeasonNumber));
      setRefreshKey((current) => current + 1);
    } catch (saveError: unknown) {
      setActionError(
        saveError instanceof Error ? saveError.message : "Não foi possível criar a temporada.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveEpisode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setActionError("");
    const body = {
      seasonNumber: Number(episodeForm.seasonNumber),
      number: Number(episodeForm.number),
      title: episodeForm.title.trim(),
      url: episodeForm.url.trim(),
      type: episodeForm.type,
    };
    const route = appPath(`/api/catalog/series/${encodeURIComponent(id)}`);
    try {
      const response = await fetch(
        episodeTarget
          ? `${route}/seasons/${episodeTarget.seasonNumber}/episodes/${episodeTarget.episodeNumber}`
          : `${route}/episodes`,
        {
          method: episodeTarget ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json();
      if (response.status === 401) {
        setActionError("Entre no painel para salvar episódios.");
        requestLogin();
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar o episódio.");

      setEpisodeTarget(null);
      setShowEpisodeForm(false);
      setActiveSeason(body.seasonNumber);
      setRefreshKey((current) => current + 1);
    } catch (saveError: unknown) {
      setActionError(
        saveError instanceof Error ? saveError.message : "Não foi possível salvar o episódio.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page-content series-detail-page">
      <Link className="series-back-link" href="/series">
        <span aria-hidden="true">←</span> Voltar para séries
      </Link>

      {isLoading ? (
        <p className="catalog-loading" role="status">Carregando temporadas e episódios...</p>
      ) : error ? (
        <div className="catalog-data-message" role="alert">
          <span>{error}</span>
        </div>
      ) : details ? (
        <>
          <section className="series-detail-hero">
            <div className="series-detail-poster">
              {details.poster ? (
                <Image
                  alt=""
                  className="catalog-poster-image"
                  fill
                  sizes="(max-width: 600px) 34vw, 180px"
                  src={details.poster}
                  unoptimized
                />
              ) : (
                <span aria-hidden="true">{details.title.charAt(0).toLocaleUpperCase("pt-BR")}</span>
              )}
            </div>
            <div className="series-detail-heading">
              <span className="series-label">SÉRIE</span>
              <h1>{details.title}</h1>
              <p>
                {details.seasons.length} {details.seasons.length === 1 ? "temporada" : "temporadas"}
                <span aria-hidden="true"> · </span>
                {episodeCount} {episodeCount === 1 ? "episódio" : "episódios"}
              </p>
            </div>
          </section>

          <section className="series-episodes-panel" aria-labelledby="episodes-heading">
            <div className="series-episodes-header">
              <div>
                <h2 id="episodes-heading">Temporadas e episódios</h2>
                <p>Escolha uma temporada para ver seus episódios.</p>
              </div>
              <div className="series-episode-header-actions">
                <button className="button button-secondary" onClick={openSeasonForm} type="button">
                  Nova temporada
                </button>
                <button
                  className="button button-primary"
                  disabled={!selectedSeason}
                  onClick={openAddEpisode}
                  type="button"
                >
                  Adicionar episódio
                </button>
              </div>
            </div>

            {details.seasons.length ? (
              <>
                <div className="season-tabs" aria-label="Temporadas">
                  {details.seasons.map((season) => (
                    <button
                      aria-pressed={activeSeason === season.number}
                      className={activeSeason === season.number ? "season-tab season-tab-active" : "season-tab"}
                      key={season.number}
                      onClick={() => setActiveSeason(season.number)}
                      type="button"
                    >
                      Temporada {season.number}
                      <span>{season.episodes.length}</span>
                    </button>
                  ))}
                </div>
                {selectedSeason?.episodes.length ? (
                  <ol className="episode-list">
                    {selectedSeason.episodes.map((episode) => (
                      <li className="episode-row" key={`${selectedSeason.number}-${episode.number}`}>
                        <span className="episode-number">{String(episode.number).padStart(2, "0")}</span>
                        <div className="episode-info">
                          <strong>{episode.title}</strong>
                          <span>Temporada {selectedSeason.number} · Episódio {episode.number}</span>
                        </div>
                        <div className="episode-actions">
                          {episode.url ? (
                            <a
                              aria-label={`Abrir ${episode.title}`}
                              className="episode-open-link"
                              href={episode.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Abrir
                            </a>
                          ) : (
                            <span className="episode-unavailable">Sem link</span>
                          )}
                          <button
                            aria-label={`Editar ${episode.title}`}
                            className="episode-edit-button"
                            onClick={() => openEditEpisode(selectedSeason, episode)}
                            type="button"
                          >
                            Editar
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="series-empty-season">Esta temporada ainda não tem episódios cadastrados.</p>
                )}
              </>
            ) : (
              <p className="series-empty-season">Esta série ainda não tem temporadas cadastradas.</p>
            )}
          </section>
        </>
      ) : null}

      {showSeasonForm && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowSeasonForm(false);
          }}
          role="presentation"
        >
          <section aria-labelledby="season-dialog-title" aria-modal="true" className="dialog-card" role="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">TEMPORADA</span>
                <h2 id="season-dialog-title">Criar temporada</h2>
                <p>A temporada será adicionada à série {details?.title}.</p>
              </div>
              <button aria-label="Fechar" className="dialog-close" onClick={() => setShowSeasonForm(false)} type="button">
                ×
              </button>
            </div>
            <form className="item-form" onSubmit={saveSeason}>
              <label>
                Número da temporada
                <input
                  max="999"
                  min="1"
                  onChange={(event) => setNewSeasonNumber(event.target.value)}
                  required
                  type="number"
                  value={newSeasonNumber}
                />
              </label>
              {actionError && <p className="session-error" role="alert">{actionError}</p>}
              <div className="dialog-actions">
                <button className="button button-secondary" onClick={() => setShowSeasonForm(false)} type="button">
                  Cancelar
                </button>
                <button className="button button-primary" disabled={isSaving} type="submit">
                  {isSaving ? "Criando..." : "Criar temporada"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showEpisodeForm && details && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowEpisodeForm(false);
              setEpisodeTarget(null);
            }
          }}
          role="presentation"
        >
          <section aria-labelledby="episode-dialog-title" aria-modal="true" className="dialog-card" role="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">{episodeTarget ? "EDITAR EPISÓDIO" : "NOVO EPISÓDIO"}</span>
                <h2 id="episode-dialog-title">
                  {episodeTarget ? "Editar episódio" : `Adicionar episódio · ${details.title}`}
                </h2>
                <p>Altere os dados do episódio e salve no servidor.</p>
              </div>
              <button
                aria-label="Fechar"
                className="dialog-close"
                onClick={() => {
                  setShowEpisodeForm(false);
                  setEpisodeTarget(null);
                }}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="item-form" onSubmit={saveEpisode}>
              <label>
                Temporada
                <select
                  onChange={(event) =>
                    setEpisodeForm((current) => ({ ...current, seasonNumber: event.target.value }))
                  }
                  required
                  value={episodeForm.seasonNumber}
                >
                  {details.seasons.map((season) => (
                    <option key={season.number} value={season.number}>
                      Temporada {season.number}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Número do episódio
                <input
                  max="9999"
                  min="1"
                  onChange={(event) =>
                    setEpisodeForm((current) => ({ ...current, number: event.target.value }))
                  }
                  required
                  type="number"
                  value={episodeForm.number}
                />
              </label>
              <label>
                Título
                <input
                  maxLength={200}
                  onChange={(event) =>
                    setEpisodeForm((current) => ({ ...current, title: event.target.value }))
                  }
                  required
                  value={episodeForm.title}
                />
              </label>
              <label>
                URL do episódio
                <input
                  onChange={(event) =>
                    setEpisodeForm((current) => ({ ...current, url: event.target.value }))
                  }
                  placeholder="https://..."
                  required
                  type="url"
                  value={episodeForm.url}
                />
              </label>
              <label>
                Formato
                <select
                  onChange={(event) =>
                    setEpisodeForm((current) => ({
                      ...current,
                      type: event.target.value as EpisodeForm["type"],
                    }))
                  }
                  value={episodeForm.type}
                >
                  <option value="hls">HLS</option>
                  <option value="mp4">MP4</option>
                </select>
              </label>
              {actionError && <p className="session-error" role="alert">{actionError}</p>}
              <div className="dialog-actions">
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setShowEpisodeForm(false);
                    setEpisodeTarget(null);
                  }}
                  type="button"
                >
                  Cancelar
                </button>
                <button className="button button-primary" disabled={isSaving} type="submit">
                  {isSaving ? "Salvando..." : episodeTarget ? "Salvar alterações" : "Adicionar episódio"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
