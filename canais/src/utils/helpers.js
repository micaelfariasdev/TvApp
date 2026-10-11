const crypto = require("crypto");
const { PASSWORD, SESSION_SECRET } = require("../config/env");

const SESSION_COOKIE = "tvbox_session";

function safeText(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char]
  );
}

function readCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s, 2))
      .filter(([key]) => key)
      .map(([key, value]) => [key, decodeURIComponent(value || "")]),
  );
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function hasTvboxSession(req) {
  if (!SESSION_SECRET) return false;
  const token = readCookies(req)[SESSION_COOKIE];
  if (!token || !token.includes(".")) return false;
  const [encoded, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")).expiresAt > Date.now();
  } catch (_) {
    return false;
  }
}

function requireTvboxAccess(req, res) {
  if (hasTvboxSession(req)) return true;
  if (req.accepts(["html"])) res.redirect("/tvbox/login");
  else res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
  return false;
}

function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/tvbox", sameSite: "lax" });
}

function passwordMatches(candidate) {
  if (!PASSWORD) return false;
  const received = Buffer.from(String(candidate || ""));
  const expected = Buffer.from(PASSWORD);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function removeLegacyPasswordFromHtml(html) {
  return html
    .replace(/([?&])pass=[^&"'\s>]+&?/g, "$1")
    .replace(/\?&/g, "?")
    .replace(/\?(["'>\s])/g, "$1");
}

module.exports = {
  SESSION_COOKIE,
  safeText,
  readCookies,
  signSession,
  hasTvboxSession,
  requireTvboxAccess,
  clearSession,
  passwordMatches,
  removeLegacyPasswordFromHtml,
};