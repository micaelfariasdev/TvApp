"use client";

import { useCallback, useEffect, useState } from "react";
import type { CatalogItem, CatalogResponse } from "@/lib/catalog";
import { appPath } from "@/lib/app-path";

type CatalogState = {
  items: CatalogItem[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
};

export function useCatalog(): CatalogState {
  const [requestKey, setRequestKey] = useState(0);
  const [result, setResult] = useState<{
    requestKey: number;
    items: CatalogItem[];
    error: string | null;
  }>({ requestKey: -1, items: [], error: null });

  const reload = useCallback(() => {
    setRequestKey((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch(appPath("/api/catalog"), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: CatalogResponse | { error?: string } = await response.json();
        if (!response.ok) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : `Falha ao carregar o catálogo (HTTP ${response.status}).`,
          );
        }
        if (!("items" in payload) || !Array.isArray(payload.items)) {
          throw new Error("A API do servidor retornou um catálogo inválido.");
        }
        setResult({ requestKey, items: payload.items, error: null });
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          requestKey,
          items: [],
          error:
            requestError instanceof Error
              ? requestError.message
              : "Não foi possível carregar o catálogo do servidor.",
        });
      });

    return () => controller.abort();
  }, [requestKey]);

  return {
    items: result.items,
    isLoading: result.requestKey !== requestKey,
    error: result.requestKey === requestKey ? result.error : null,
    reload,
  };
}
