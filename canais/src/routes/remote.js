const express = require("express");
const { execFile } = require("node:child_process");
const path = require("node:path");

const router = express.Router();
const keys = {
  up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4, home: 3,
  play: 85, pause: 127, stop: 86, volup: 24, voldown: 25, mute: 164,
};
let device = process.env.ADB_DEVICE || "";

function adb(args) {
  return new Promise((resolve, reject) => {
    const full = device ? ["-s", device, ...args] : args;
    execFile("adb", full, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim()));
      resolve(stdout.trim());
    });
  });
}

router.get("/", (req, res) => res.sendFile(path.join(__dirname, "../../templates/remote.html")));
router.get("/api/devices", async (req, res) => {
  try { res.json({ devices: (await adb(["devices"])).split(/\r?\n/).slice(1).filter(Boolean), selected: device }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/connect", async (req, res) => {
  try {
    device = String(req.body.device || "").trim();
    if (!device) throw Error("Informe o IP:porta da TV Box");
    const output = await adb(["connect", device]);
    res.json({ ok: true, device, output });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post("/api/key", async (req, res) => {
  try {
    const key = keys[String(req.body.key || "").toLowerCase()];
    if (!key) return res.status(400).json({ error: "Tecla inválida" });
    res.json({ ok: true, output: await adb(["shell", "input", "keyevent", String(key)]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
