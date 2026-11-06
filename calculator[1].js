// =====================================================
// calculator.js  -  the claim calculation (runs on the server)
// =====================================================

// Most that the policy pays for one claim, by disease / treatment type (sample values).
// Change these numbers to match your real policies.
const CATEGORY_LIMITS = {
  "Heart problem": 400000,
  "Leg injury / fracture": 150000,
  "Surgery / operation": 300000,
  "Cancer": 500000,
  "Kidney": 300000,
  "Maternity": 75000,
  "Fever / infection": 50000,
  "Other": 100000
};

function rupees(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

// Number of days between two dates (minimum 1)
function daysBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.max(1, Math.round(ms / 86400000));
}

// "used" = amount of the sum insured already approved earlier in the same policy year.
function calculate(d, used) {
  used = used || 0;
  const totalDays = daysBetween(d.admit, d.discharge);

  // Days that fall inside the policy period
  let coveredDays = totalDays;
  let splitNote = "";
  if (new Date(d.discharge) > new Date(d.policyEnd)) {
    coveredDays = Math.max(0, Math.round((new Date(d.policyEnd) - new Date(d.admit)) / 86400000) + 1);
    coveredDays = Math.min(coveredDays, totalDays);
    splitNote = "Stay crosses the policy end date. " + coveredDays + " of " + totalDays +
      " days fall in this policy year; the rest belong to the next policy year.";
  }
  if (new Date(d.admit) < new Date(d.policyStart)) {
    splitNote = "Admission is BEFORE the policy start date. This claim may be rejected.";
  }

  // Room rent
  const roomBill = d.roomRate * totalDays;
  let roomEligible = roomBill;
  let ratio = 1; // proportion applied to other heads
  if (d.roomLimit > 0 && d.roomRate > d.roomLimit) {
    ratio = d.roomLimit / d.roomRate;
    roomEligible = d.roomLimit * totalDays;
  }

  // ICU
  const icuBill = d.icuRate * d.icuDays;
  let icuEligible = icuBill;
  if (d.icuLimit > 0 && d.icuRate > d.icuLimit) {
    icuEligible = d.icuLimit * d.icuDays;
  }

  // Other heads are reduced in the same proportion as room rent (room rent capping)
  const doctorEligible = d.doctorFees * ratio;
  const medEligible = d.medicines; // medicines are normally NOT reduced
  const testEligible = d.tests * ratio;
  const otEligible = d.ot * ratio;
  const otherEligible = d.other * ratio;

  const totalBill = roomBill + icuBill + d.doctorFees + d.medicines + d.tests + d.ot + d.other;
  let eligible = roomEligible + icuEligible + doctorEligible + medEligible +
                 testEligible + otEligible + otherEligible;

  // Policy year split: only covered days are payable
  if (coveredDays < totalDays) {
    eligible = eligible * (coveredDays / totalDays);
  }

  // Limit for this disease / treatment type
  let limitNote = "";
  const catLimit = CATEGORY_LIMITS[d.category];
  if (catLimit && eligible > catLimit) {
    eligible = catLimit;
    limitNote = "The limit for " + d.category + " is " + rupees(catLimit) + ", so the claim is capped there.";
  }

  // Cannot exceed what is left of the sum insured
  let capNote = "";
  const remaining = Math.max(0, d.sumInsured - used);
  if (eligible > remaining) {
    eligible = remaining;
    capNote = used > 0
      ? "Only " + rupees(remaining) + " of the sum insured is left (" + rupees(used) + " already approved in this policy year)."
      : "Eligible amount limited to the sum insured.";
  }

  return {
    totalDays, coveredDays, ratio, splitNote, limitNote, capNote, totalBill, eligible, remaining,
    rows: [
      ["Room rent", roomBill, roomEligible],
      ["ICU", icuBill, icuEligible],
      ["Doctor / surgeon fees", d.doctorFees, doctorEligible],
      ["Medicines", d.medicines, medEligible],
      ["Tests and scans", d.tests, testEligible],
      ["Operation theatre", d.ot, otEligible],
      ["Other charges", d.other, otherEligible]
    ]
  };
}

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Amount already approved for the same patient, insurer and policy period
function usedBefore(c, list) {
  let total = 0;
  list.forEach(function (x) {
    if (x.id !== c.id && x.status === "Approved" &&
        same(x.patient, c.patient) &&
        x.insurer === c.insurer &&
        x.policyStart === c.policyStart && x.policyEnd === c.policyEnd) {
      total += calculate(x, 0).eligible;
    }
  });
  return total;
}

// Saved claims of the same patient from an earlier policy year
function previousYear(c, list) {
  return list.filter(function (x) {
    return x.id !== c.id && same(x.patient, c.patient) && x.policyEnd < c.policyStart;
  });
}

module.exports = { CATEGORY_LIMITS, calculate, usedBefore, previousYear };
