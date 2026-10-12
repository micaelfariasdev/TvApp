const express = require("express");
const cron = require("node-cron");
const { PORT } = require("./src/config/env");
const apiRoutes = require("./src/routes/api");
const adminRoutes = require("./src/routes/admin");
const hls = require("./src/services/hls");

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use("/", apiRoutes);
app.use("/tvbox", adminRoutes);



app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
