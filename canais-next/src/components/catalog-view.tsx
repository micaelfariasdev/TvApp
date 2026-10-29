"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CatalogItem, CatalogKind } from "@/lib/catalog";
import { catalogSearchEvent } from "@/lib/catalog";
import { appPath } from "@/lib/app-path";
import { useAdminSession } from "@/lib/admin-session";
import { useCatalog } from "@/lib/use-catalog";

type CatalogConfig = {
  kind: CatalogKind;
  title: string;
  description: string;
  actionLabel: string;
  emptyLabel: string;
};

const configs: Record<CatalogKind, CatalogConfig> = {
  movie: {
    kind: "movie",
    title: "Filmes",
    description: "Organize filmes, capas e categorias do seu catálogo.",
    actionLabel: "Adicionar filme",
    emptyLabel: "Nenhum filme encontrado",
  },
  series: {
    kind: "series",
    title: "Séries",
    description: "Gerencie séries completas, temporadas e episódios.",
    actionLabel: "Adicionar série",
    emptyLabel: "Nenhuma série encontrada",
  },
  live: {
    kind: "live",
    title: "Ao vivo",
    description: "Acompanhe e organize seus canais de televisão ao vivo.",
    actionLabel: "Adicionar canal",
    emptyLabel: "Nenhum canal ao vivo encontrado",
  },
  kick: {
    kind: "kick",
    title: "Kick",
    description: "Gerencie seus streamers e canais da Kick separadamente.",
    actionLabel: "Adicionar canal",
    emptyLabel: "Nenhum canal da Kick encontrado",
  },
};

export function CatalogView({ kind }: { kind: CatalogKind }) {
  const config = configs[kind];
  const { items: catalogItems, isLoading, error, reload } = useCatalog();
  const { authenticated, isLoading: isSessionLoading, requestLogin } = useAdminSession();
  const items = useMemo(() => catalogItems.filter((item) => item.kind === kind), [catalogItems, kind]);
  const [query, setQuery] = useState("");
  const allFilter = kind === "series" ? "Todas" : "Todos";
  const [activeFilter, setActiveFilter] = useState(allFilter);
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formPoster, setFormPoster] = useState("");
  const [posterSearchStatus, setPosterSearchStatus] = useState<
    "idle" | "searching" | "found" | "not-found" | "error"
  >("idle");
  const [posterSearchSource, setPosterSearchSource] = useState("");
  const [posterSearchRequest, setPosterSearchRequest] = useState(0);
  const [manualPoster, setManualPoster] = useState(false);
  const [formUsername, setFormUsername] = useState("");
  const [mediaType, setMediaType] = useState<"hls" | "mp4" | "embed">("hls");
  const [formKind, setFormKind] = useState<CatalogKind>(kind);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [posterSearchItemId, setPosterSearchItemId] = useState<string | null>(null);
  const [posterSearchItemError, setPosterSearchItemError] = useState("");

  useEffect(() => {
    function handleCatalogSearch(event: Event) {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
      setQuery(event.detail);
      setActiveFilter(allFilter);
    }

    const frame = window.requestAnimationFrame(() => {
      const initialQuery = new URLSearchParams(window.location.search).get("q");
      if (initialQuery) setQuery(initialQuery);
    });
    window.addEventListener(catalogSearchEvent, handleCatalogSearch);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(catalogSearchEvent, handleCatalogSearch);
    };
  }, [allFilter]);

  useEffect(() => {
    const searchKind = editingItem ? formKind : kind;
    const title = formTitle.trim();
    const username = editingItem?.username || formUsername;
    const searchValue = searchKind === "kick" ? username.trim() : title;
    const isPosterSearchable =
      searchKind === "movie" || searchKind === "series" || searchKind === "kick";
    const existingPosterMatchesTitle =
      Boolean(editingItem?.posterUrl) &&
      title === editingItem?.title &&
      posterSearchRequest === 0;

    if (!showForm || !searchValue || !isPosterSearchable || manualPoster || existingPosterMatchesTitle) {
      return;
    }
    if (!authenticated || isSessionLoading) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPosterSearchStatus("searching");
      setPosterSearchSource("");
      try {
        const response = await fetch(appPath("/api/catalog/posters"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            kind: searchKind,
            ...(searchKind === "kick" ? { username } : {}),
          }),
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (response.status === 401) {
          setPosterSearchStatus("error");
          setFormError("Sua sessão expirou. Entre novamente para buscar capas.");
          requestLogin();
          return;
        }
        if (!response.ok) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : "Nenhuma capa encontrada para esse título.";
          setPosterSearchStatus(response.status === 404 ? "not-found" : "error");
          if (response.status !== 404) setFormError(message);
          return;
        }
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("poster" in payload) ||
          typeof payload.poster !== "string" ||
          !/^https?:\/\//i.test(payload.poster)
        ) {
          throw new Error("O servidor retornou uma capa inválida.");
        }
        setFormPoster(payload.poster);
        setPosterSearchSource(
          "source" in payload && typeof payload.source === "string" ? payload.source : "Servidor",
        );
        setPosterSearchStatus("found");
      } catch (searchError: unknown) {
        if (controller.signal.aborted) return;
        setPosterSearchStatus("error");
        setFormError(
          searchError instanceof Error
            ? searchError.message
            : "Não foi possível buscar a capa agora.",
        );
      }
    }, posterSearchRequest > 0 ? 0 : 650);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    authenticated,
    editingItem,
    formUsername,
    formKind,
    formTitle,
    isSessionLoading,
    kind,
    manualPoster,
    posterSearchRequest,
    requestLogin,
    showForm,
  ]);
  const filterLabels = useMemo(
    () => [
      allFilter,
      ...new Set(
        items
          .map((item) => item.category)
          .filter((category) => category && category !== "Sem categoria"),
      ),
    ],
    [allFilter, items],
  );

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        `${item.title} ${item.category} ${item.subtitle}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedQuery);
      return matchesQuery && (activeFilter === allFilter || item.category === activeFilter);
    });
  }, [activeFilter, allFilter, items, query]);

  function openCreateForm() {
    setEditingItem(null);
    setFormTitle("");
    setFormCategory(kind === "movie" ? "filmes" : kind === "series" ? "Séries" : kind === "kick" ? "kick" : "m3u");
    setFormUrl("");
    setFormPoster("");
    setPosterSearchStatus("idle");
    setPosterSearchSource("");
    setPosterSearchRequest(0);
    setManualPoster(false);
    setFormUsername("");
    setFormKind(kind);
    setMediaType("hls");
    setFormError("");
    setShowForm(true);
  }

  function getLiveStatusLabel(status: CatalogItem["status"]) {
    if (status === "online") return "AO VIVO";
    if (status === "offline") return "OFFLINE";
    return "CADASTRADO";
  }

  function openEditForm(item: CatalogItem) {
    setEditingItem(item);
    setFormTitle(item.title);
    setFormCategory(item.category);
    setFormUrl(item.url || "");
    setFormPoster(item.posterUrl || "");
    setPosterSearchStatus("idle");
    setPosterSearchSource("");
    setPosterSearchRequest(0);
    setManualPoster(false);
    setFormUsername(item.username || "");
    setFormKind(item.kind);
    setMediaType(
      item.mediaType === "mp4" || item.mediaType === "embed" ? item.mediaType : "hls",
    );
    setFormError("");
    setShowForm(true);
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = formTitle.trim();
    if (!title) return;
    const category = formCategory.trim();
    if (!category) {
      setFormError("Informe a categoria do conteúdo.");
      return;
    }

    const payload = editingItem
      ? {
          kind: formKind,
          title,
          category,
          poster: formPoster.trim(),
          ...(formUrl.trim() ? { url: formUrl.trim(), mediaType } : {}),
        }
      : {
          kind,
          title,
          category,
          poster: formPoster.trim(),
          ...(kind === "movie" || kind === "live"
            ? { url: formUrl.trim(), mediaType }
            : {}),
          ...(kind === "kick" ? { username: formUsername.trim() } : {}),
        };

    setIsSaving(true);
    setFormError("");
    try {
      const response = await fetch(
        appPath(
          editingItem
            ? `/api/catalog/items/${encodeURIComponent(editingItem.id)}`
            : "/api/catalog/items",
        ),
        {
          method: editingItem ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const responsePayload = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setFormError("Entre no painel e clique em salvar novamente.");
          requestLogin();
          return;
        }
        throw new Error(responsePayload.error || "Não foi possível salvar o conteúdo.");
      }
      await reload();
      setShowForm(false);
      setNotice(editingItem ? `${title} foi atualizado no servidor.` : `${title} foi adicionado ao servidor.`);
      window.setTimeout(() => setNotice(""), 3500);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível salvar o conteúdo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function fillItemPoster(item: CatalogItem) {
    if (!authenticated) {
      requestLogin();
      return;
    }

    setPosterSearchItemId(item.id);
    setPosterSearchItemError("");
    try {
      const searchResponse = await fetch(appPath("/api/catalog/posters"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          kind: item.kind,
          ...(item.kind === "kick" ? { username: item.username } : {}),
        }),
      });
      const result: unknown = await searchResponse.json();
      if (searchResponse.status === 401) {
        requestLogin();
        return;
      }
      if (
        !searchResponse.ok ||
        typeof result !== "object" ||
        result === null ||
        !("poster" in result) ||
        typeof result.poster !== "string"
      ) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Não foi possível encontrar uma capa para este título.";
        throw new Error(message);
      }

      const updateResponse = await fetch(appPath(`/api/catalog/items/${encodeURIComponent(item.id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: item.kind,
          title: item.title,
          category: item.category,
          poster: result.poster,
        }),
      });
      const updateResult = await updateResponse.json();
      if (updateResponse.status === 401) {
        requestLogin();
        return;
      }
      if (!updateResponse.ok) {
        throw new Error(updateResult.error || "Não foi possível salvar a capa no servidor.");
      }

      await reload();
      setNotice(`Capa adicionada para “${item.title}”.`);
      window.setTimeout(() => setNotice(""), 3500);
    } catch (searchError: unknown) {
      setPosterSearchItemError(
        searchError instanceof Error
          ? searchError.message
          : "Não foi possível buscar a capa agora.",
      );
    } finally {
      setPosterSearchItemId(null);
    }
  }

  const posterSearchKind = editingItem ? formKind : kind;
  const posterSearchValue =
    posterSearchKind === "kick"
      ? (editingItem?.username || formUsername).trim()
      : formTitle.trim();

  return (
    <div className="page-content">
      <div className="catalog-page-heading">
        <div>
          <span className="eyebrow">CATÁLOGO / {config.title.toLocaleUpperCase("pt-BR")}</span>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <button
          className="button button-primary"
          onClick={openCreateForm}
          type="button"
        >
          <span className="button-plus">＋</span>{config.actionLabel}
        </button>
      </div>

      <div className="catalog-summary">
        <div className="catalog-summary-icon">{getKindIcon(kind)}</div>
        <div>
          <strong>{items.length} {getPlural(kind, items.length)}</strong>
          <span>no catálogo</span>
        </div>
        {(kind === "live" || kind === "kick") && (
          <>
            <span className="summary-separator" />
            <span className="summary-online">
              <span className="status-pulse" />
              {items.some((item) => item.status === "online" || item.status === "offline")
                ? `${items.filter((item) => item.status === "online").length} online agora`
                : "Status não informado"}
            </span>
          </>
        )}
        {kind === "series" && (
          <>
            <span className="summary-separator" />
            <span className="summary-online summary-neutral">
              {items.reduce((sum, item) => sum + (item.episodes ?? 0), 0)} episódios
            </span>
          </>
        )}
        <span className="summary-updated">Atualizado agora</span>
      </div>

      <section className="catalog-panel">
        <div className="catalog-toolbar">
          <label className="catalog-search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={`Buscar ${config.title.toLocaleLowerCase("pt-BR")}`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Buscar ${config.title.toLocaleLowerCase("pt-BR")}...`}
              value={query}
            />
            {query && (
              <button
                aria-label="Limpar busca"
                className="clear-search"
                onClick={() => setQuery("")}
                type="button"
              >
                ×
              </button>
            )}
          </label>
          <div className="toolbar-actions">
            <button className="filter-button" type="button">
              <span aria-hidden="true">☷</span> Filtros
            </button>
            <span className="view-toggle" aria-label="Modo de visualização">
              <button
                aria-label="Visualização em grade"
                aria-pressed={layout === "grid"}
                className={layout === "grid" ? "view-active" : ""}
                onClick={() => setLayout("grid")}
                type="button"
              >
                ▦
              </button>
              <button
                aria-label="Visualização em lista"
                aria-pressed={layout === "list"}
                className={layout === "list" ? "view-active" : ""}
                onClick={() => setLayout("list")}
                type="button"
              >
                ☰
              </button>
            </span>
          </div>
        </div>

        <div className="filter-tabs" aria-label="Filtrar por categoria">
          {filterLabels.map((filter) => (
            <button
              aria-pressed={activeFilter === filter}
              className={`filter-tab${activeFilter === filter ? " filter-tab-active" : ""}`}
              key={filter}
              onClick={() => setActiveFilter(filter)}
              type="button"
            >
              {filter}
            </button>
          ))}
          <span className="result-count">
            {visibleItems.length} {visibleItems.length === 1 ? "resultado" : "resultados"}
          </span>
        </div>

        {error && (
          <div className="catalog-data-message" role="alert">
            <span>{error}</span>
            <button className="button button-secondary" onClick={reload} type="button">
              Tentar novamente
            </button>
          </div>
        )}

        {isLoading && <p className="catalog-loading" role="status">Carregando catálogo do servidor...</p>}

        {visibleItems.length ? (
          <div className={`catalog-grid${layout === "list" ? " catalog-grid-list" : ""}`}>
            {visibleItems.map((item) => (
              <article className={`media-card${layout === "list" ? " media-card-list" : ""}`} key={item.id}>
                <div className={`media-art poster-${item.posterTone}`}>
                  <span className="poster-decoration" aria-hidden="true" />
                  {item.posterUrl ? (
                    <Image
                      alt=""
                      className="catalog-poster-image"
                      fill
                      sizes="(max-width: 760px) 45vw, 25vw"
                      src={item.posterUrl}
                      unoptimized
                    />
                  ) : (
                    <span className="poster-mark">{item.posterMark}</span>
                  )}
                  {(kind === "live" || kind === "kick") && (
                    <span className={`live-badge${item.status === "online" ? "" : " live-badge-offline"}`}>
                      <span />{getLiveStatusLabel(item.status)}
                    </span>
                  )}
                  {(kind === "movie" || kind === "series" || kind === "kick") && !item.posterUrl && (
                    <button
                      className="poster-missing-button"
                      disabled={posterSearchItemId === item.id}
                      onClick={() => void fillItemPoster(item)}
                      type="button"
                    >
                      {posterSearchItemId === item.id ? "Buscando capa..." : "Buscar capa"}
                    </button>
                  )}
                  <button
                    className="card-menu"
                    onClick={() => openEditForm(item)}
                    type="button"
                    aria-label={`Editar ${item.title}`}
                  >
                    ···
                  </button>
                </div>
                <div className="media-card-info">
                  <div className="media-card-title-row">
                    <h2>{item.title}</h2>
                    {kind === "series" && <span className="series-label">SÉRIE</span>}
                  </div>
                  <p>{item.subtitle}</p>
                  <div className="media-card-footer">
                    <span className="category-label">{item.category}</span>
                    {kind === "series" ? (
                      <Link
                        className="episodes-label episodes-link"
                        href={`/series/${encodeURIComponent(item.id.replace(/^series:/, ""))}`}
                      >
                        {item.seasons ?? 0} {item.seasons === 1 ? "temporada" : "temporadas"} · {item.episodes ?? 0} episódios · Ver
                      </Link>
                    ) : (
                      <span className="date-label">{item.addedLabel}</span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : isLoading || error ? null : (
          <div className="empty-state">
            <span className="empty-state-icon">{getKindIcon(kind)}</span>
            <h2>{config.emptyLabel}</h2>
            <p>Tente ajustar a busca ou escolha outra categoria.</p>
            <button
              className="button button-secondary"
              onClick={() => {
                setQuery("");
                setActiveFilter(allFilter);
              }}
              type="button"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </section>
      {posterSearchItemError && (
        <div className="catalog-data-message" role="alert">
          <span>{posterSearchItemError}</span>
          <button
            aria-label="Fechar erro da busca de capa"
            className="dialog-close"
            onClick={() => setPosterSearchItemError("")}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      <p className="demo-note">
        {error ? "Falha ao carregar dados reais do servidor." : "Catálogo sincronizado com o servidor. As alterações são salvas permanentemente."}
      </p>

      {notice && <div className="toast-message" role="status">{notice}</div>}

      {showForm && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowForm(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="catalog-item-dialog-title"
            aria-modal="true"
            className="dialog-card"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">{editingItem ? "EDITAR ITEM" : "NOVO ITEM"}</span>
                <h2 id="catalog-item-dialog-title">
                  {editingItem ? `Editar ${editingItem.title}` : config.actionLabel}
                </h2>
                <p>{editingItem ? "As alterações serão gravadas no servidor." : "O novo conteúdo será gravado no servidor."}</p>
              </div>
              <button
                aria-label="Fechar"
                className="dialog-close"
                onClick={() => setShowForm(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="item-form" onSubmit={saveItem}>
              <label>
                Nome
                <input
                  autoFocus
                  maxLength={200}
                  onChange={(event) => {
                    setFormTitle(event.target.value);
                    setPosterSearchStatus("idle");
                    setPosterSearchSource("");
                  }}
                  placeholder={`Nome ${kind === "movie" ? "do filme" : kind === "series" ? "da série" : "do canal"}`}
                  required
                  value={formTitle}
                />
              </label>
              {editingItem && (editingItem.kind === "movie" || editingItem.kind === "live") && (
                <label>
                  Tipo do conteúdo
                  <select value={formKind} onChange={(event) => setFormKind(event.target.value as CatalogKind)}>
                    <option value="movie">Filme</option>
                    <option value="live">Ao vivo</option>
                  </select>
                </label>
              )}
              {kind !== "kick" && (
                <label>
                  Categoria
                  <input
                    maxLength={100}
                    onChange={(event) => setFormCategory(event.target.value)}
                    placeholder="Ex.: Drama, Notícias, Esportes"
                    required
                    value={formCategory}
                  />
                </label>
              )}
              {(editingItem?.kind === "movie" || editingItem?.kind === "live" || !editingItem && (kind === "movie" || kind === "live")) && (
                <>
                  <label>
                    {editingItem ? "URL do conteúdo (opcional)" : "URL do conteúdo"}
                    <input
                      autoComplete="url"
                      onChange={(event) => setFormUrl(event.target.value)}
                      placeholder="https://..."
                      required={!editingItem}
                      type="url"
                      value={formUrl}
                    />
                  </label>
                  <label>
                    Formato
                    <select value={mediaType} onChange={(event) => setMediaType(event.target.value as typeof mediaType)}>
                      <option value="hls">HLS</option>
                      <option value="mp4">MP4</option>
                      <option value="embed">Embed</option>
                    </select>
                  </label>
                </>
              )}
              {!editingItem && kind === "kick" && (
                <label>
                  Usuário da Kick
                  <input
                    autoComplete="username"
                    maxLength={80}
                    onChange={(event) => setFormUsername(event.target.value)}
                    placeholder="Ex.: streamer"
                    required
                    value={formUsername}
                  />
                </label>
              )}
              <label>
                URL da capa (opcional)
                <input
                  onChange={(event) => {
                    const value = event.target.value;
                    setFormPoster(value);
                    setManualPoster(Boolean(value.trim()));
                    if (!value.trim()) {
                      setPosterSearchRequest((current) => current + 1);
                    }
                    setPosterSearchSource("");
                    setPosterSearchStatus("idle");
                  }}
                  placeholder="https://..."
                  type="url"
                  value={formPoster}
                />
              </label>
              {(editingItem
                ? formKind === "movie" || formKind === "series" || formKind === "kick"
                : kind === "movie" || kind === "series" || kind === "kick") && (
                <div className="poster-search-controls">
                  <div className="poster-search-actions">
                    <span role="status">
                      {posterSearchStatus === "searching"
                        ? "Buscando capa automaticamente..."
                        : posterSearchStatus === "found"
                          ? `Capa encontrada · ${posterSearchSource}`
                          : posterSearchStatus === "not-found"
                            ? "Nenhuma capa encontrada para esse título."
                            : !authenticated && !isSessionLoading && posterSearchValue
                              ? "Entre no painel para buscar capas automaticamente."
                              : posterSearchStatus === "error"
                                ? "A busca automática falhou."
                                : kind === "kick"
                                  ? "A foto do canal é buscada pelo usuário da Kick."
                                  : "A capa é buscada automaticamente pelo nome."}
                    </span>
                    <button
                      className="button button-secondary poster-search-button"
                      disabled={!posterSearchValue || posterSearchStatus === "searching"}
                      onClick={() => {
                        if (!authenticated) {
                          requestLogin();
                          return;
                        }
                        setManualPoster(false);
                        setPosterSearchRequest((current) => current + 1);
                      }}
                      type="button"
                    >
                      {posterSearchStatus === "searching"
                        ? "Buscando..."
                        : posterSearchStatus === "found" || posterSearchStatus === "not-found" || posterSearchStatus === "error"
                          ? "Buscar novamente"
                          : !authenticated && !isSessionLoading
                            ? "Entrar para buscar"
                            : "Buscar capa"}
                    </button>
                  </div>
                  {formPoster && (
                    <div className="poster-search-preview">
                      <Image
                        alt="Prévia da capa selecionada"
                        height={72}
                        src={formPoster}
                        unoptimized
                        width={50}
                      />
                      <span>{posterSearchSource ? `Fonte: ${posterSearchSource}` : "Capa selecionada"}</span>
                    </div>
                  )}
                </div>
              )}
              {formError && <p className="session-error" role="alert">{formError}</p>}
              <div className="dialog-actions">
                <button className="button button-secondary" onClick={() => setShowForm(false)} type="button">
                  Cancelar
                </button>
                <button
                  className="button button-primary"
                  disabled={isSaving || posterSearchStatus === "searching"}
                  type="submit"
                >
                  {isSaving
                    ? "Salvando..."
                    : posterSearchStatus === "searching"
                      ? "Buscando capa..."
                      : editingItem
                        ? "Salvar alterações"
                        : "Adicionar ao servidor"}
                </button>
              </div>
            </form>
            {kind === "kick" && editingItem && (
              <div className="dialog-actions">
                <p className="demo-note">O usuário do canal Kick não é alterado por este editor.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function getKindIcon(kind: CatalogKind) {
  if (kind === "movie") return "▣";
  if (kind === "series") return "▤";
  if (kind === "kick") return "▶";
  return "◉";
}

function getPlural(kind: CatalogKind, amount: number) {
  if (kind === "movie") return amount === 1 ? "filme" : "filmes";
  if (kind === "series") return amount === 1 ? "série" : "séries";
  if (kind === "kick") return amount === 1 ? "canal da Kick" : "canais da Kick";
  return amount === 1 ? "canal ao vivo" : "canais ao vivo";
}
