require("dotenv").config({ override: true });

module.exports = {
  PORT: process.env.PORT || 4000,
  PASSWORD: String(process.env.TVBOX_PASSWORD || ""),
  SESSION_SECRET: String(process.env.TVBOX_SESSION_SECRET || ""),
  TMDB_API_KEY: String(process.env.TMDB_API_KEY || "").trim(),
  BASE_URL: String(process.env.BASE_URL || "http://164.152.62.129").replace(/\/$/, ""),
};
