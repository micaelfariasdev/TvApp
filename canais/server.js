const express = require("express");
const cron = require("node-cron");
const { PORT } = require("./src/config/env");
const { runScraper } = require("./src/services/scraper");
const apiRoutes = require("./src/routes/api");
const adminRoutes = require("./src/routes/admin");

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use("/", apiRoutes);
app.use("/tvbox", adminRoutes);

runScraper();
cron.schedule("*/30 * * * *", () => {
  runScraper();
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});