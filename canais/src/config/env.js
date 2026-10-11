require("dotenv").config({ override: true });

module.exports = {
  PORT: process.env.PORT || 4000,
  PASSWORD: String(process.env.TVBOX_PASSWORD || ""),
  SESSION_SECRET: String(process.env.TVBOX_SESSION_SECRET || ""),
  TMDB_API_KEY: String(process.env.TMDB_API_KEY || "").trim(),
  BASE_URL: "https://roxiestreams.biz",
};