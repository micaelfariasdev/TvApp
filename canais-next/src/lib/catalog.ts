export type CatalogKind = "movie" | "series" | "live" | "kick";
export const catalogSearchEvent = "cinedark-catalog-search";

export type CatalogItem = {
  id: string;
  title: string;
  subtitle: string;
  kind: CatalogKind;
  kindLabel: string;
  category: string;
  addedLabel: string;
  createdAt: number | null;
  posterMark: string;
  posterTone: string;
  posterUrl: string | null;
  url?: string;
  username?: string;
  mediaType?: string;
  episodes?: number;
  seasons?: number;
  status?: "online" | "offline" | "unknown";
};

export type CatalogResponse = {
  version: 2;
  generatedAt: string;
  counts: {
    movies: number;
    series: number;
    live: number;
    kick: number;
  };
  items: CatalogItem[];
};

export function getCatalogCounts(items: CatalogItem[]) {
  return {
    movies: items.filter((item) => item.kind === "movie").length,
    series: items.filter((item) => item.kind === "series").length,
    live: items.filter((item) => item.kind === "live").length,
    kick: items.filter((item) => item.kind === "kick").length,
  };
}

export function getRecentCatalog(items: CatalogItem[]) {
  return [...items].sort((left, right) => {
    if (left.createdAt != null && right.createdAt != null) {
      return right.createdAt - left.createdAt;
    }
    if (left.createdAt != null) return -1;
    if (right.createdAt != null) return 1;
    return 0;
  });
}
