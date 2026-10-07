
/* ============================================================
   Health Insurance Claim Pre-Authorisation Tracker
   Plain HTML/CSS/JS - no build tools needed.
   Data is kept in the browser's localStorage.
   ============================================================ */
 
const STORAGE_KEY = "preauth_claims_v1";
 
/* ---------- Load / Save ---------- */
function loadClaims() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
}
function saveClaims(claims) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(claims));
}
 
/* ---------- Date helpers ---------- */
function toDate(str) { return new Date(str + "T00:00:00"); }
function daysInclusive(a, b) {
  return Math.round((b - a) / 86400000) + 1;
}
// Formats a date as YYYY-MM-DD using LOCAL time (avoids the 1-day shift bug)
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
 
/* Split a hospital stay into segments whenever the policy
   anniversary date (MM-DD) falls inside the stay. */
function splitByPolicyYear(admission, discharge, annivMMDD) {
  if (!annivMMDD || !/^\d{2}-\d{2}$/.test(annivMMDD)) {
    return [{ start: admission, end: discharge, days: daysInclusive(admission, discharge) }];
  }
  const [mm, dd] = annivMMDD.split("-").map(Number);
  const segments = [];
  let segStart = admission;
  let year = admission.getFullYear();
 
  while (true) {
    const anniv = new Date(year, mm - 1, dd);
    if (anniv > segStart && anniv <= discharge) {
      const segEnd = new Date(anniv.getTime() - 86400000); // day before renewal
      segments.push({ start: segStart, end: segEnd, days: daysInclusive(segStart, segEnd) });
      segStart = anniv;
    }
    year++;
    if (new Date(year, mm - 1, dd) > discharge) break;
  }
  segments.push({ start: segStart, end: discharge, days: daysInclusive(segStart, discharge) });
  return segments;
}
 
/* ---------- Eligibility engine ---------- */
function computeEligibility(claim) {
  const admission = toDate(claim.admissionDate);
  const discharge = toDate(claim.dischargeDate);
  const segments = splitByPolicyYear(admission, discharge, claim.anniversary);
  const totalDays = daysInclusive(admission, discharge);
 
  const breakdown = [];
  let totalEligible = 0;
 
  segments.forEach((seg, i) => {
    const shareOfStay = seg.days / totalDays;
 
    const roomCapPerDay = claim.sumInsured * (claim.roomCapPct / 100);
    const icuCapPerDay = claim.sumInsured * (claim.icuCapPct / 100);
 
    const roomRatio = claim.actualRoomRent > roomCapPerDay
      ? roomCapPerDay / claim.actualRoomRent : 1;
    const icuRatio = claim.actualIcuRent > icuCapPerDay
      ? icuCapPerDay / claim.actualIcuRent : 1;
 
    const linkedRatio = Math.min(roomRatio, icuRatio);
 
    const eligibleRoom = Math.min(claim.actualRoomRent, roomCapPerDay) * seg.days;
    const eligibleIcu = Math.min(claim.actualIcuRent, icuCapPerDay) * seg.days;
    const segOtherCharges = claim.otherCharges * shareOfStay;
    const eligibleOther = segOtherCharges * linkedRatio;
    const segFixedCharges = claim.fixedCharges * shareOfStay;
 
    const segTotal = eligibleRoom + eligibleIcu + eligibleOther + segFixedCharges;
    totalEligible += segTotal;
 
    breakdown.push({
      label: `Policy-year segment ${i + 1}`,
      start: formatDate(seg.start),
      end: formatDate(seg.end),
      days: seg.days,
      roomCapPerDay, icuCapPerDay,
      roomRatio, icuRatio,
      eligibleRoom, eligibleIcu, eligibleOther, segFixedCharges,
      segTotal
    });
  });
 
  return { segments: breakdown, totalEligible };
}
 
/* ---------- Page elements ---------- */
const form = document.getElementById("claimForm");
const tbody = document.querySelector("#claimsTable tbody");
const emptyMsg = document.getElementById("emptyMsg");
const overlay = document.getElementById("modalOverlay");
const modalContent = document.getElementById("modalContent");
 
/* ---------- Log Claim (form submit) ---------- */
form.addEventListener("submit", (e) => {
  e.preventDefault(); // stop the page from reloading
 
  const val = (id) => document.getElementById(id).value;
 
  const claim = {
    id: Date.now(),
    hospitalName: val("hospitalName"),
    patientName: val("patientName"),
    policyNumber: val("policyNumber"),
    sumInsured: Number(val("sumInsured")),
    admissionDate: val("admissionDate"),
    dischargeDate: val("dischargeDate"),
    anniversary: val("anniversary").trim(),
    requestedAmount: Number(val("requestedAmount")),
    actualRoomRent: Number(val("actualRoomRent")),
    roomCapPct: Number(val("roomCapPct")),
    actualIcuRent: Number(val("actualIcuRent")),
    icuCapPct: Number(val("icuCapPct")),
    otherCharges: Number(val("otherCharges")),
    fixedCharges: Number(val("fixedCharges")),
    status: "Pending"
  };
 
  // Simple safety check: discharge must not be before admission
  if (toDate(claim.dischargeDate) < toDate(claim.admissionDate)) {
    alert("Discharge date cannot be before the admission date.");
    return;
  }
 
  const claims = loadClaims();
  claims.push(claim);
  saveClaims(claims);
 
  form.reset();
  document.getElementById("roomCapPct").value = 1;
  document.getElementById("icuCapPct").value = 2;
 
  render();
  showDetails(claim.id); // open the details popup for the new claim
});
 
/* ---------- Claims table ---------- */
function render() {
  const claims = loadClaims();
  tbody.innerHTML = "";
  emptyMsg.style.display = claims.length ? "none" : "block";
 
  claims.forEach((claim) => {
    const { totalEligible } = computeEligibility(claim);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${claim.patientName}</td>
      <td>${claim.hospitalName}</td>
      <td>${claim.policyNumber}</td>
      <td>${claim.admissionDate} → ${claim.dischargeDate}</td>
      <td>${claim.requestedAmount.toLocaleString("en-IN")}</td>
      <td>${Math.round(totalEligible).toLocaleString("en-IN")}</td>
      <td></td>
      <td><button class="linkbtn" data-id="${claim.id}">View</button></td>
    `;
 
    const statusCell = tr.children[6];
    const select = document.createElement("select");
    select.className = "statusSelect";
    ["Pending", "Approved", "Rejected", "Query"].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = s;
      if (s === claim.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      const all = loadClaims();
      const target = all.find((c) => c.id === claim.id);
      target.status = select.value;
      saveClaims(all);
    });
    statusCell.appendChild(select);
 
    tr.querySelector("button.linkbtn").addEventListener("click", () => showDetails(claim.id));
    tbody.appendChild(tr);
  });
}
 
/* ---------- Details popup ---------- */
document.getElementById("closeModal").addEventListener("click", () => overlay.classList.add("hidden"));
overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.add("hidden"); });
 
function buildBreakdown(segments, totalEligible, totalLabel) {
  let html = "";
  segments.forEach((seg) => {
    html += `
      <div class="seg">
        <h4>${seg.label} (${seg.start} to ${seg.end}, ${seg.days} day${seg.days > 1 ? "s" : ""})</h4>
        <div class="row"><span>Room rent cap / day</span><span>₹${seg.roomCapPerDay.toFixed(0)}</span></div>
        <div class="row"><span>ICU cap / day</span><span>₹${seg.icuCapPerDay.toFixed(0)}</span></div>
        <div class="row"><span>Room rent ratio applied</span><span>${(seg.roomRatio * 100).toFixed(1)}%</span></div>
        <div class="row"><span>Eligible room rent</span><span>₹${seg.eligibleRoom.toFixed(0)}</span></div>
        <div class="row"><span>Eligible ICU charges</span><span>₹${seg.eligibleIcu.toFixed(0)}</span></div>
        <div class="row"><span>Eligible other charges (after proportionate deduction)</span><span>₹${seg.eligibleOther.toFixed(0)}</span></div>
        <div class="row"><span>Fixed / excluded charges</span><span>₹${seg.segFixedCharges.toFixed(0)}</span></div>
        <div class="row total"><span>Segment eligible total</span><span>₹${seg.segTotal.toFixed(0)}</span></div>
      </div>`;
  });
  html += `<div class="row total"><span>${totalLabel}</span><span>₹${totalEligible.toFixed(0)}</span></div>`;
  return html;
}
 
function showDetails(id) {
  const claim = loadClaims().find((c) => c.id === id);
  if (!claim) return;
  const { segments, totalEligible } = computeEligibility(claim);
  const approvedAmount = Math.min(claim.requestedAmount, totalEligible);
 
  let html = `<h3>${claim.patientName} — ${claim.hospitalName}</h3>
    <p class="muted">Policy ${claim.policyNumber} · Sum Insured ₹${claim.sumInsured.toLocaleString("en-IN")}</p>`;
 
  if (claim.status === "Approved") {
    html += `
      <div class="banner approved">
        ✅ Insurance was approved
        <small>Approved amount: ₹${approvedAmount.toFixed(0)} (requested ₹${claim.requestedAmount.toLocaleString("en-IN")})</small>
      </div>`;
    html += buildBreakdown(segments, totalEligible, "TOTAL ELIGIBLE AMOUNT");
 
  } else if (claim.status === "Rejected") {
    html += `
      <div class="banner rejected">
        ❌ Insurance was rejected
        <small>Requested ₹${claim.requestedAmount.toLocaleString("en-IN")} · Amount payable: ₹0</small>
      </div>`;
 
  } else if (claim.status === "Query") {
    html += `
      <div class="banner query">
        ❓ Query raised by the insurer
        <small>Waiting for more documents or clarification.</small>
      </div>`;
    html += buildBreakdown(segments, totalEligible, "ESTIMATED ELIGIBLE AMOUNT");
 
  } else {
    html += `
      <div class="banner pending">
        ⏳ Pending
        <small>No decision yet. The amount below is only an estimate.</small>
      </div>`;
    html += buildBreakdown(segments, totalEligible, "ESTIMATED ELIGIBLE AMOUNT");
  }
 
  modalContent.innerHTML = html;
  overlay.classList.remove("hidden");
}
 
/* ---------- Start ---------- */
render();