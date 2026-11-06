// =====================================================
// script.js  -  the frontend. It talks to the backend (server.js)
// using fetch(). All saving and calculating happens on the server.
// =====================================================

// ---------- Helper functions ----------
const form = document.getElementById("claimForm");
const tbody = document.getElementById("tbody");
const summaryBox = document.getElementById("summary");
const filterSelect = document.getElementById("filter");
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modalContent");

function rupees(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function num(id) {
  return Number(document.getElementById(id).value) || 0;
}
function text(id) {
  return document.getElementById(id).value;
}
function radio(name) {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : "";
}
// Makes typed text safe to show inside the page
function esc(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Sends a request to the backend. Returns the answer, or throws an error with a message.
async function api(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new Error("Cannot reach the server. Is it running? (npm start)");
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || "Server error (" + res.status + ")");
  return data;
}

// ---------- Policy status (active or ended) ----------
function policyStatus(start, end) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const s = new Date(start), e = new Date(end);
  if (today < s) return "Not started yet (starts in " + Math.ceil((s - today) / 86400000) + " days)";
  if (today > e) return "Ended " + Math.floor((today - e) / 86400000) + " days ago";
  return "Active (" + Math.ceil((e - today) / 86400000) + " days left)";
}

// ---------- Save the form ----------
form.addEventListener("submit", async function (event) {
  event.preventDefault(); // stop the page from reloading

  if (new Date(text("discharge")) < new Date(text("admit"))) {
    alert("Discharge date cannot be before admission date.");
    return;
  }

  // Put all the form values in a FormData box (this can carry a file too)
  const fd = new FormData();
  ["patient", "reportDate", "hospital", "phone", "insurer", "sumInsured",
   "policyStart", "policyEnd", "category", "diagnosis", "prevCondition", "prevAmount",
   "admit", "discharge", "roomType", "roomRate", "roomLimit",
   "icuDays", "icuRate", "icuLimit", "doctorFees", "medicines", "tests", "ot", "other"
  ].forEach(id => fd.append(id, text(id)));
  fd.append("treatType", radio("treatType"));
  fd.append("cause", radio("cause"));
  fd.append("severity", radio("severity"));

  const file = document.getElementById("receipt").files[0];
  if (file) {
    if (file.size > 5 * 1024 * 1024) {
      alert("Receipt file is too big (max 5 MB). Choose a smaller file.");
      return;
    }
    fd.append("receipt", file);
  }

  try {
    await api("/api/claims", { method: "POST", body: fd });
    form.reset();
    await render();
  } catch (e) {
    alert(e.message);
  }
});

// ---------- Show everything on the page ----------
async function render() {
  let list;
  try {
    list = await api("/api/claims");
  } catch (e) {
    summaryBox.innerHTML = "<p>" + esc(e.message) + "</p>";
    tbody.innerHTML = "";
    return;
  }

  // Fill the category filter
  const cats = [...new Set(list.map(c => c.category))];
  const current = filterSelect.value;
  filterSelect.innerHTML = '<option value="">All</option>' +
    cats.map(c => '<option ' + (c === current ? "selected" : "") + '>' + esc(c) + '</option>').join("");

  // Summary per category
  const totals = {};
  list.forEach(c => {
    const r = c.result;
    if (!totals[c.category]) totals[c.category] = { count: 0, bill: 0, eligible: 0 };
    totals[c.category].count++;
    totals[c.category].bill += r.totalBill;
    totals[c.category].eligible += r.eligible;
  });
  summaryBox.innerHTML = Object.keys(totals).length
    ? Object.entries(totals).map(([cat, t]) =>
        '<div>' + esc(cat) + '<strong>' + rupees(t.eligible) + '</strong>' +
        t.count + ' claim(s), bill ' + rupees(t.bill) + '</div>').join("")
    : "<p>No claims yet.</p>";

  // Table rows
  const shown = list.filter(c => !filterSelect.value || c.category === filterSelect.value);
  tbody.innerHTML = shown.map(c => {
    const r = c.result;
    const detail = (c.treatType || "") + (c.diagnosis ? " – " + c.diagnosis : "");
    return `<tr>
      <td>${esc(c.patient)}</td>
      <td>${esc(c.hospital)}</td>
      <td>${esc(c.category)}<br><small>${esc(detail)}</small></td>
      <td>${esc(c.insurer)}<br><small>${policyStatus(c.policyStart, c.policyEnd)}</small></td>
      <td>${rupees(r.totalBill)}</td>
      <td>${rupees(r.eligible)}</td>
      <td><span class="badge ${esc(c.status)}">${esc(c.status)}</span></td>
      <td>
        <button class="small-btn" onclick="viewClaim(${c.id})">View</button>
        <button class="small-btn" onclick="setStatus(${c.id}, 'Approved')">Approve</button>
        <button class="small-btn" onclick="setStatus(${c.id}, 'Rejected')">Reject</button>
        <button class="small-btn" onclick="removeClaim(${c.id})">Delete</button>
      </td>
    </tr>`;
  }).join("");
}

filterSelect.addEventListener("change", render);

async function setStatus(id, status) {
  try {
    await api("/api/claims/" + id + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status })
    });
    await render();
  } catch (e) {
    alert(e.message);
  }
}

async function removeClaim(id) {
  if (!confirm("Delete this claim?")) return;
  try {
    await api("/api/claims/" + id, { method: "DELETE" });
    await render();
  } catch (e) {
    alert(e.message);
  }
}

// ---------- Detail popup with report, previous year and receipt ----------
async function viewClaim(id) {
  let data;
  try {
    data = await api("/api/claims/" + id);
  } catch (e) {
    alert(e.message);
    return;
  }
  const c = data.claim;
  const r = c.result;
  const prev = data.previous;

  // Previous year's report
  let prevHtml = "";
  if (prev.length) {
    prevHtml = '<table class="breakdown"><tr><th>Disease</th><th>Treatment</th><th>Claimed</th></tr>' +
      prev.map(p => '<tr><td>' + esc(p.category) + '</td><td>' + esc(p.treatType || "-") +
        (p.diagnosis ? " – " + esc(p.diagnosis) : "") + '</td><td>' +
        rupees(p.claimed) + '</td></tr>').join("") + '</table>';
  } else {
    prevHtml = "<p>No earlier policy-year claims saved for this patient.</p>";
  }
  if (c.prevCondition || c.prevAmount) {
    prevHtml += "<p><b>Entered by hand:</b> " + esc(c.prevCondition || "-") +
      " – " + rupees(c.prevAmount || 0) + "</p>";
  }
  const repeatWarn = data.repeatCondition
    ? '<div class="warn">The same disease type (' + esc(c.category) +
      ') was claimed in an earlier policy year. Check waiting period and pre-existing condition rules before approving.</div>'
    : "";

  let receiptHtml = "<p>No receipt uploaded.</p>";
  if (c.receipt) {
    receiptHtml = c.receipt.toLowerCase().endsWith(".pdf")
      ? `<a href="${esc(c.receipt)}" target="_blank">Open PDF receipt</a>`
      : `<img class="receipt-img" src="${esc(c.receipt)}" alt="Receipt">`;
  }

  const reportNo = "HCR-" + String(c.id).slice(-6);
  modalContent.innerHTML = `
    <div class="report-head">
      <div>
        <h2>Hospital Claim Assessment Report</h2>
        <p>Report no. ${reportNo} &bull; Report date: ${esc(c.reportDate || "-")}</p>
      </div>
      <div class="stamp ${esc(c.status)}">${esc(c.status)}</div>
    </div>

    <h3>1. Patient and hospital</h3>
    <table class="kv">
      <tr><th>Patient name</th><td>${esc(c.patient)}</td><th>Hospital</th><td>${esc(c.hospital)}</td></tr>
      <tr><th>Phone</th><td>${esc(c.phone || "-")}</td><th>Stay</th><td>${esc(c.admit)} to ${esc(c.discharge)} (${r.totalDays} days)</td></tr>
    </table>

    <h3>2. Insurance policy</h3>
    <table class="kv">
      <tr><th>Insurer / plan</th><td>${esc(c.insurer)}</td><th>Sum insured</th><td>${rupees(c.sumInsured)}</td></tr>
      <tr><th>Policy period</th><td>${esc(c.policyStart)} to ${esc(c.policyEnd)}</td><th>Policy status</th><td>${policyStatus(c.policyStart, c.policyEnd)}</td></tr>
      <tr><th>Left for this claim</th><td colspan="3">${rupees(r.remaining)}</td></tr>
    </table>

    <h3>3. Diagnosis and treatment</h3>
    <table class="kv">
      <tr><th>Type of treatment</th><td>${esc(c.treatType || "-")}</td><th>Disease / body part</th><td>${esc(c.category)}</td></tr>
      <tr><th>Diagnosis / procedure</th><td>${esc(c.diagnosis || "-")}</td><th>Cause</th><td>${esc(c.cause || "-")}</td></tr>
      <tr><th>Severity</th><td colspan="3">${esc(c.severity || "-")}</td></tr>
    </table>

    <h3>4. Bill and eligible amount</h3>
    ${r.ratio < 1 ? `<div class="warn">Room rent exceeds the limit, so other heads are reduced to ${(r.ratio * 100).toFixed(1)}%.</div>` : ""}
    ${r.splitNote ? `<div class="warn">${esc(r.splitNote)}</div>` : ""}
    ${r.limitNote ? `<div class="warn">${esc(r.limitNote)}</div>` : ""}
    ${r.capNote ? `<div class="warn">${esc(r.capNote)}</div>` : ""}
    <table class="breakdown">
      <tr><th>Item</th><th>Billed</th><th>Eligible</th></tr>
      ${r.rows.map(x => `<tr><td>${x[0]}</td><td>${rupees(x[1])}</td><td>${rupees(x[2])}</td></tr>`).join("")}
      <tr><th>Total</th><th>${rupees(r.totalBill)}</th><th>${rupees(r.eligible)}</th></tr>
    </table>
    <div class="result">
      <div>Total hospital bill<strong>${rupees(r.totalBill)}</strong></div>
      <div>Insurance will pay<strong>${rupees(r.eligible)}</strong></div>
      <div>Patient pays<strong>${rupees(r.totalBill - r.eligible)}</strong></div>
    </div>

    <h3>5. Previous year's report</h3>
    ${repeatWarn}
    ${prevHtml}

    <h3>6. Receipt</h3>
    ${receiptHtml}

    <div class="sign">
      <div>Prepared by (TPA)</div>
      <div>Hospital representative</div>
      <div>Date</div>
    </div>
    <button class="print-btn no-print" onclick="window.print()">Print report</button>`;
  modal.classList.remove("hidden");
}

document.getElementById("closeModal").onclick = () => modal.classList.add("hidden");
modal.addEventListener("click", e => { if (e.target === modal) modal.classList.add("hidden"); });

render();
