"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { AdminSessionProvider, useAdminSession } from "@/lib/admin-session";
import type { CatalogItem } from "@/lib/catalog";
import { catalogSearchEvent } from "@/lib/catalog";
import { appPath } from "@/lib/app-path";
import { useCatalog } from "@/lib/use-catalog";

const navigation = [
  { href: "/", label: "Visão geral", icon: "⌂", exact: true },
  { href: "/filmes", label: "Filmes", icon: "▣" },
  { href: "/series", label: "Séries", icon: "▤" },
  { href: "/ao-vivo", label: "Ao vivo", icon: "◉" },
  { href: "/kick", label: "Kick", icon: "▶" },
];

const tools = [
  { href: "/categorias", label: "Categorias", icon: "▦" },
  { href: "/configuracoes", label: "Configurações", icon: "⚙" },
];

const themeChangeEvent = "cinedark-theme-change";

function subscribeToTheme(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(themeChangeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(themeChangeEvent, onChange);
  };
}

function getThemeSnapshot(): "dark" | "light" {
  return window.localStorage.getItem("cinedark-theme") === "light" ? "light" : "dark";
}

function getServerThemeSnapshot(): "dark" | "light" {
  return "dark";
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <AdminShellContent>{children}</AdminShellContent>
    </AdminSessionProvider>
  );
}

function AdminShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    authenticated,
    login,
    loginOpen,
    requestLogin,
    closeLogin,
    logout,
  } = useAdminSession();
  const { items: catalogItems, isLoading: isCatalogLoading, error: catalogError } = useCatalog();
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const searchResults = useMemo(() => {
    const normalizedQuery = globalSearch.trim().toLocaleLowerCase("pt-BR");
    if (normalizedQuery.length < 2) return [];

    return catalogItems
      .filter((item) =>
        `${item.title} ${item.subtitle} ${item.category}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedQuery),
      )
      .sort((left, right) => {
        const leftStartsWith = left.title.toLocaleLowerCase("pt-BR").startsWith(normalizedQuery);
        const rightStartsWith = right.title.toLocaleLowerCase("pt-BR").startsWith(normalizedQuery);
        return Number(rightStartsWith) - Number(leftStartsWith);
      })
      .slice(0, 8);
  }, [catalogItems, globalSearch]);
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        globalSearchRef.current?.focus();
        setIsSearchOpen(true);
      }
      if (event.key === "Escape") setIsSearchOpen(false);
    }

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("cinedark-theme", nextTheme);
    window.dispatchEvent(new Event(themeChangeEvent));
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    try {
      await login(password);
      setPassword("");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Não foi possível entrar.");
    }
  }

  async function handleLogout() {
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : "Falha ao sair.");
    }
  }

  function selectGlobalSearchResult(item: CatalogItem, navigate = true) {
    const href = getCatalogItemHref(item);
    if (pathname === href.split("?")[0]) {
      window.dispatchEvent(new CustomEvent(catalogSearchEvent, { detail: item.title }));
    }
    setGlobalSearch("");
    setIsSearchOpen(false);
    if (navigate) router.push(href);
  }

  return (
    <>
    <div className="app-layout">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="CineDark, início">
          <Image
            alt=""
            className="brand-logo"
            height={48}
            unoptimized
            priority
            src={appPath("/cinedark-logo.png")}
            width={48}
          />
          <span className="brand-name">cinedark<span>.</span></span>
        </Link>

        <div className="workspace-switcher">
          <span className="workspace-avatar">CD</span>
          <span className="workspace-copy">
            <strong>Central de conteúdo</strong>
            <small>Plano administrador</small>
          </span>
          <span className="workspace-chevron">⌄</span>
        </div>

        <p className="nav-label">GERENCIAMENTO</p>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {navigation.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                className={`nav-link${active ? " nav-link-active" : ""}`}
                href={item.href}
                key={item.href}
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
                {item.href === "/kick" && (
                  <span className="nav-live-dot" aria-label="Área de lives" />
                )}
              </Link>
            );
          })}
        </nav>

        <p className="nav-label nav-label-tools">FERRAMENTAS</p>
        <nav className="sidebar-nav" aria-label="Ferramentas">
          {tools.map((item) => (
            <Link
              className={`nav-link${pathname.startsWith(item.href) ? " nav-link-active" : ""}`}
              href={item.href}
              key={item.href}
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="server-status">
            <span className="status-pulse" />
            <span><strong>Servidor ativo</strong><small>Todos os sistemas operacionais</small></span>
          </div>
          <button
            className="profile-button"
            onClick={() => authenticated
              ? void handleLogout()
              : requestLogin()}
            type="button"
          >
            <span className="profile-avatar">L</span>
            <span className="profile-copy">
              <strong>{authenticated ? "Administrador" : "Entrar no painel"}</strong>
              <small>{authenticated ? "Sessão ativa" : "Acesso protegido"}</small>
            </span>
            <span className="profile-menu">···</span>
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Painel</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{getCurrentLabel(pathname)}</strong>
          </div>
          <div className="topbar-actions">
            <div className="global-search-wrap">
              <label className="global-search">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="Buscar no painel"
                  aria-expanded={isSearchOpen}
                  aria-controls="global-search-results"
                  autoComplete="off"
                  onChange={(event) => {
                    setGlobalSearch(event.target.value);
                    setIsSearchOpen(true);
                  }}
                  onFocus={() => setIsSearchOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !searchResults[0]) return;
                    event.preventDefault();
                    selectGlobalSearchResult(searchResults[0]);
                  }}
                  placeholder="Buscar no painel..."
                  ref={globalSearchRef}
                  role="combobox"
                  value={globalSearch}
                />
                {globalSearch ? (
                  <button
                    aria-label="Limpar busca"
                    className="clear-search"
                    onClick={() => {
                      setGlobalSearch("");
                      setIsSearchOpen(true);
                      globalSearchRef.current?.focus();
                    }}
                    type="button"
                  >
                    ×
                  </button>
                ) : (
                  <kbd>⌘ K</kbd>
                )}
              </label>
              {isSearchOpen && globalSearch.trim().length >= 2 && (
                <div
                  className="global-search-results"
                  id="global-search-results"
                  role="listbox"
                  aria-label="Resultados da busca"
                >
                  {isCatalogLoading ? (
                    <p role="status">Buscando no catálogo...</p>
                  ) : catalogError ? (
                    <p role="alert">Não foi possível pesquisar: {catalogError}</p>
                  ) : searchResults.length ? (
                    searchResults.map((item) => (
                      <GlobalSearchResult
                        item={item}
                        key={item.id}
                        onSelect={() => selectGlobalSearchResult(item, false)}
                      />
                    ))
                  ) : (
                    <p role="status">Nenhum resultado encontrado.</p>
                  )}
                </div>
              )}
            </div>
            <button
              aria-label={`Ativar tema ${theme === "dark" ? "claro" : "escuro"}`}
              className="icon-button theme-button"
              onClick={toggleTheme}
              title={`Ativar tema ${theme === "dark" ? "claro" : "escuro"}`}
              type="button"
            >
              {theme === "dark" ? "☼" : "☾"}
            </button>
            <button className="icon-button notification-button" type="button" aria-label="Notificações">
              ♧<span />
            </button>
            <span className="topbar-divider" />
            <button
              aria-label={authenticated ? "Sair do painel" : "Entrar no painel"}
              className="topbar-avatar"
              onClick={() => authenticated
                ? void handleLogout()
                : requestLogin()}
              type="button"
            >
              L
            </button>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
    {loginOpen && (
      <div className="modal-backdrop session-backdrop">
        <form className="dialog-card" onSubmit={handleLogin}>
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">ACESSO ADMINISTRATIVO</span>
              <h2>Entrar no servidor</h2>
              <p>Use a senha já configurada no painel do servidor.</p>
            </div>
            <button
              aria-label="Fechar"
              className="dialog-close"
              onClick={closeLogin}
              type="button"
            >
              ×
            </button>
          </div>
          <label className="session-password-label">
            Senha do painel
            <input
              autoFocus
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
              required
            />
          </label>
          {loginError && <p className="session-error" role="alert">{loginError}</p>}
          <div className="dialog-actions">
            <button className="button button-secondary" onClick={closeLogin} type="button">
              Cancelar
            </button>
            <button className="button button-primary" disabled={!password} type="submit">
              Entrar
            </button>
          </div>
        </form>
      </div>
    )}
    </>
  );
}

function GlobalSearchResult({
  item,
  onSelect,
}: {
  item: CatalogItem;
  onSelect: (item: CatalogItem) => void;
}) {
  return (
    <Link
      aria-label={`${item.title}, ${item.kindLabel}`}
      className="global-search-result"
      href={getCatalogItemHref(item)}
      onClick={() => onSelect(item)}
      role="option"
    >
      <span className={`global-search-result-icon global-search-result-${item.kind}`}>
        {item.posterMark}
      </span>
      <span className="global-search-result-copy">
        <strong>{item.title}</strong>
        <small>{item.kindLabel} · {item.category}</small>
      </span>
      <span className="global-search-result-arrow" aria-hidden="true">↗</span>
    </Link>
  );
}

function getCatalogItemHref(item: CatalogItem) {
  const path =
    item.kind === "movie"
      ? "/filmes"
      : item.kind === "series"
        ? "/series"
        : item.kind === "kick"
          ? "/kick"
          : "/ao-vivo";
  return `${path}?q=${encodeURIComponent(item.title)}`;
}

function getCurrentLabel(pathname: string) {
  if (pathname === "/") return "Visão geral";
  if (pathname.startsWith("/filmes")) return "Filmes";
  if (pathname.startsWith("/series")) return "Séries";
  if (pathname.startsWith("/ao-vivo")) return "Ao vivo";
  if (pathname.startsWith("/kick")) return "Kick";
  if (pathname.startsWith("/categorias")) return "Categorias";
  return "Configurações";
}
