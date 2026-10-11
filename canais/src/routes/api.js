const express = require("express");
const fs = require("fs");
const path = require("path");
const { loadDB, loadSeriesCatalog, loadCategoriesMeta } = require("../services/db");

const router = express.Router();
const SERIES_DIRECTORY = path.join(__dirname, "../../series");

router.get("/channels.json", (req, res) => {
  const dbData = loadDB();
  const categoriesMeta = loadCategoriesMeta();

  const cleanData = dbData.map(({ name, url, type, category, poster }) => {
    const categoryKey = String(category || "outros").trim();
    const categoryPoster = categoriesMeta[categoryKey]?.poster || null;

    return {
      name,
      url,
      type,
      category,
      poster: poster || categoryPoster,
    };
  });

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(cleanData);
});

router.get("/series.json", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const catalog = loadSeriesCatalog();
  res.type("application/json").send(JSON.stringify(catalog, null, 2));
});

router.get("/series/:id.json", (req, res) => {
  const id = req.params.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    return res.status(400).json({ error: "Invalid series id" });
  const file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (!fs.existsSync(file))
    return res.status(404).json({ error: "Series not found" });
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.type("application/json").send(fs.readFileSync(file, "utf-8"));
});

module.exports = router;
