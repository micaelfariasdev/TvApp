const axios = require("axios");
const { TMDB_API_KEY } = require("../config/env");

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

async function findPoster(title, kind = "movie") {
  const query = String(title || "").trim();
  if (!query) return null;

  if (TMDB_API_KEY) {
    try {
      const endpoint = kind === "tv" ? "tv" : "movie";
      const response = await axios.get(
        `https://api.themoviedb.org/3/search/${endpoint}`,
        {
          params: {
            api_key: TMDB_API_KEY,
            language: "pt-BR",
            query,
            include_adult: false,
          },
          timeout: 10000,
        },
      );
      const item =
        response.data?.results?.find((result) => result.poster_path) ||
        response.data?.results?.[0];
      if (item?.poster_path)
        return {
          poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
          title: item.title || item.name || query,
          source: "TMDb",
        };
    } catch (error) {
      console.warn(`Busca TMDb falhou para "${query}": ${error.message}`);
    }
  }

  try {
    const response = await axios.get(
      `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`,
      {
        headers,
        timeout: 10000,
      },
    );
    const wantedTypes =
      kind === "tv"
        ? new Set(["tvSeries", "tvMiniSeries"])
        : new Set(["feature", "movie", "videoMovie"]);
    const item =
      (response.data?.d || []).find(
        (result) => wantedTypes.has(result.q) && result.i?.imageUrl,
      ) || (response.data?.d || []).find((result) => result.i?.imageUrl);
    if (item?.i?.imageUrl)
      return {
        poster: item.i.imageUrl,
        title: item.l || query,
        source: "IMDb",
      };
  } catch (error) {
    console.warn(`Busca IMDb falhou para "${query}": ${error.message}`);
  }
  return null;
}

module.exports = { findPoster };