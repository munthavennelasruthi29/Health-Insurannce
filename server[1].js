// =====================================================
// server.js  -  the backend (Node.js + Express)
// Start it with:  npm start     then open http://localhost:3000
// =====================================================
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { loadClaims, saveClaims } = require("./db");
const { CATEGORY_LIMITS, calculate, usedBefore, previousYear } = require("./calculator");

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const STATUSES = ["Pending", "Approved", "Rejected"];

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());

// ---------- Receipt uploads ----------
const ALLOWED_TYPES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp"
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // random file name, so nobody can guess it and names never clash
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(12).toString("hex") + (ALLOWED_TYPES[file.mimetype] || ""))
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error("Only images (jpg, png, gif, webp) or PDF files are allowed."));
  }
});

// ---------- Helpers ----------
const toNum = v => Math.max(0, Number(v) || 0);
const toStr = v => (v == null ? "" : String(v).trim());

function removeReceiptFile(claim) {
  if (!claim || !claim.receiptFile) return;
  const p = path.join(UPLOAD_DIR, path.basename(claim.receiptFile));
  fs.unlink(p, () => {}); // ignore errors (file may already be gone)
}

// Turns the text from the form into a clean claim object. Returns { error } if invalid.
function buildClaim(body) {
  const c = {
    patient: toStr(body.patient),
    reportDate: toStr(body.reportDate),
    hospital: toStr(body.hospital),
    phone: toStr(body.phone),
    insurer: toStr(body.insurer),
    sumInsured: toNum(body.sumInsured),
    policyStart: toStr(body.policyStart),
    policyEnd: toStr(body.policyEnd),
    treatType: toStr(body.treatType),
    category: toStr(body.category),
    diagnosis: toStr(body.diagnosis),
    cause: toStr(body.cause),
    severity: toStr(body.severity),
    prevCondition: toStr(body.prevCondition),
    prevAmount: toNum(body.prevAmount),
    admit: toStr(body.admit),
    discharge: toStr(body.discharge),
    roomType: toStr(body.roomType),
    roomRate: toNum(body.roomRate),
    roomLimit: toNum(body.roomLimit),
    icuDays: toNum(body.icuDays),
    icuRate: toNum(body.icuRate),
    icuLimit: toNum(body.icuLimit),
    doctorFees: toNum(body.doctorFees),
    medicines: toNum(body.medicines),
    tests: toNum(body.tests),
    ot: toNum(body.ot),
    other: toNum(body.other)
  };

  const required = ["patient", "hospital", "insurer", "policyStart", "policyEnd",
                    "treatType", "category", "admit", "discharge"];
  for (const f of required) {
    if (!c[f]) return { error: "Please fill the field: " + f };
  }
  for (const f of ["policyStart", "policyEnd", "admit", "discharge"]) {
    if (isNaN(new Date(c[f]).getTime())) return { error: "Invalid date in field: " + f };
  }
  if (!CATEGORY_LIMITS.hasOwnProperty(c.category)) return { error: "Unknown category." };
  if (new Date(c.discharge) < new Date(c.admit)) {
    return { error: "Discharge date cannot be before admission date." };
  }
  if (new Date(c.policyEnd) < new Date(c.policyStart)) {
    return { error: "Policy end date cannot be before policy start date." };
  }
  return { claim: c };
}

// What we send to the browser: the claim + its calculated result + receipt link
function withResult(c, list) {
  return {
    ...c,
    receipt: c.receiptFile ? "/uploads/" + c.receiptFile : "",
    result: calculate(c, usedBefore(c, list))
  };
}

// ---------- API routes ----------

// 1) List all claims
app.get("/api/claims", (req, res) => {
  const list = loadClaims();
  res.json(list.map(c => withResult(c, list)));
});

// 2) Get one claim with full report details (previous year etc.)
app.get("/api/claims/:id", (req, res) => {
  const list = loadClaims();
  const c = list.find(x => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: "Claim not found." });

  const prev = previousYear(c, list).map(p => ({
    category: p.category,
    treatType: p.treatType,
    diagnosis: p.diagnosis,
    claimed: calculate(p, 0).eligible
  }));
  const repeatCondition = previousYear(c, list).some(p => p.category === c.category);

  res.json({ claim: withResult(c, list), previous: prev, repeatCondition });
});

// 3) Create a new claim (form data, optional receipt file)
app.post("/api/claims", upload.single("receipt"), (req, res) => {
  const { claim, error } = buildClaim(req.body);
  if (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error });
  }
  claim.id = Date.now();
  claim.status = "Pending";
  claim.receiptFile = req.file ? req.file.filename : "";
  claim.createdAt = new Date().toISOString();

  const list = loadClaims();
  list.push(claim);
  saveClaims(list);
  res.status(201).json(withResult(claim, list));
});

// 4) Change status (Pending / Approved / Rejected)
app.patch("/api/claims/:id/status", (req, res) => {
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: "Status must be one of: " + STATUSES.join(", ") });
  }
  const list = loadClaims();
  const c = list.find(x => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: "Claim not found." });
  c.status = status;
  saveClaims(list);
  res.json(withResult(c, list));
});

// 5) Delete a claim (and its receipt file)
app.delete("/api/claims/:id", (req, res) => {
  const list = loadClaims();
  const c = list.find(x => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: "Claim not found." });
  removeReceiptFile(c);
  saveClaims(list.filter(x => x.id !== c.id));
  res.json({ ok: true });
});

// ---------- Receipt files and the website ----------
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Error handler (file too big, wrong file type, ...) ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Receipt file is too big (max 5 MB)." });
  }
  console.error(err);
  res.status(400).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => {
  console.log("Claim tracker running at http://localhost:" + PORT);
});
