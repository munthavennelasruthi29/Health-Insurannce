// =====================================================
// db.js  -  tiny "database" that stores claims in a JSON file
// (no database software to install; the file is data/claims.json)
// =====================================================
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "claims.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]");
}

function loadClaims() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    console.error("claims.json is damaged, starting with an empty list:", e.message);
    return [];
  }
}

function saveClaims(list) {
  ensureFile();
  // write to a temporary file first, then rename: avoids a half-written file
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = { loadClaims, saveClaims };
