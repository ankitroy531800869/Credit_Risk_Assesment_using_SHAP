// Use the same origin for both local and deployed environments
const API_BASE = "";
const API_URL = `${API_BASE}/predict`;

const form = document.getElementById("loanForm");
const submitBtn = document.getElementById("submitBtn");
const states = {
  idle: document.getElementById("idle"),
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  result: document.getElementById("result"),
};

const INT_FIELDS = ["person_age", "cb_person_cred_hist_length"];
const FLOAT_FIELDS = [
  "person_income", "person_emp_length", "loan_amnt",
  "loan_int_rate", "loan_percent_income",
];

function show(name) {
  Object.entries(states).forEach(([key, el]) => (el.hidden = key !== name));
}

// Auto-calculate loan_percent_income until the user edits it by hand
const ratioInput = form.elements.loan_percent_income;
let ratioEdited = false;
ratioInput.addEventListener("input", () => (ratioEdited = ratioInput.value !== ""));

function updateRatio() {
  if (ratioEdited) return;
  const amount = parseFloat(form.elements.loan_amnt.value);
  const income = parseFloat(form.elements.person_income.value);
  ratioInput.value = amount > 0 && income > 0 ? (amount / income).toFixed(2) : "";
}
form.elements.loan_amnt.addEventListener("input", updateRatio);
form.elements.person_income.addEventListener("input", updateRatio);

form.addEventListener("reset", () => {
  ratioEdited = false;
  form.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  show("idle");
});

// Build the payload with the exact types the Pydantic model expects
function buildPayload() {
  const payload = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (INT_FIELDS.includes(el.name)) payload[el.name] = parseInt(el.value, 10);
    else if (FLOAT_FIELDS.includes(el.name)) payload[el.name] = parseFloat(el.value);
    else payload[el.name] = el.value;
  }
  return payload;
}

function validate() {
  let firstBad = null;
  for (const el of form.elements) {
    if (!el.name) continue;
    const bad = el.value === "" || (el.type === "number" && (isNaN(el.value) || Number(el.value) < Number(el.min || -Infinity)));
    el.classList.toggle("invalid", bad);
    if (bad && !firstBad) firstBad = el;
  }
  if (firstBad) firstBad.focus();
  return !firstBad;
}

form.addEventListener("input", (e) => e.target.classList?.remove("invalid"));

async function assess(event) {
  event?.preventDefault();
  if (!validate()) return;

  show("loading");
  submitBtn.disabled = true;
  submitBtn.textContent = "Assessing…";

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });

    if (!res.ok) {
      let detail = `Server responded with status ${res.status}.`;
      try {
        const body = await res.json();
        if (Array.isArray(body.detail)) {
          detail = body.detail.map((d) => `${d.loc.slice(1).join(".")}: ${d.msg}`).join(" · ");
        } else if (body.detail) {
          detail = String(body.detail);
        }
      } catch (_) { /* keep default message */ }
      throw new Error(detail);
    }

    renderResult(await res.json());
  } catch (err) {
    const offline = err instanceof TypeError;
    document.getElementById("errorMsg").textContent = offline
      ? "Can't reach the API. Check that uvicorn is running on port 8000 and that CORS is enabled."
      : err.message;
    show("error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Assess risk";
  }
}

function renderResult(data) {
  const prob = data.default_probability;
  const thr = data.threshold;
  const high = data.default_prediction === 1;

  const card = states.result;
  card.classList.toggle("high", high);
  card.classList.toggle("low", !high);

  document.getElementById("badge").textContent = data.Result;
  document.getElementById("verdict").textContent = high
    ? "The model flags this application as likely to default."
    : "The model sees this application as unlikely to default.";
  document.getElementById("thr").textContent = `${(thr * 100).toFixed(1)}%`;
  document.getElementById("pred").textContent = high ? "Default (1)" : "No default (0)";

  // Threshold tick: place it on the semicircle (left = 0%, right = 100%)
  const angle = Math.PI * (1 - thr);
  const cx = 100, cy = 100, r1 = 79, r2 = 101;
  const tick = document.getElementById("tick");
  tick.setAttribute("x1", cx + r1 * Math.cos(angle));
  tick.setAttribute("y1", cy - r1 * Math.sin(angle));
  tick.setAttribute("x2", cx + r2 * Math.cos(angle));
  tick.setAttribute("y2", cy - r2 * Math.sin(angle));

  // Reset dial, show card, then animate fill and count-up
  const arc = document.getElementById("arc");
  const pct = document.getElementById("pct");
  arc.style.transition = "none";
  arc.style.strokeDashoffset = 100;
  pct.textContent = "0.0%";
  show("result");

  requestAnimationFrame(() => requestAnimationFrame(() => {
    arc.style.transition = "";
    arc.style.strokeDashoffset = 100 - prob * 100;
  }));

  const start = performance.now();
  const duration = 1100;
  (function tickUp(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    pct.textContent = `${(prob * 100 * eased).toFixed(1)}%`;
    if (t < 1) requestAnimationFrame(tickUp);
  })(start);
}

form.addEventListener("submit", assess);
document.getElementById("retryBtn").addEventListener("click", () => assess());