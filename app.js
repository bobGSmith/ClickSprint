const distanceReadout = document.querySelector("#distanceReadout");
const timeReadout = document.querySelector("#timeReadout");
const paceReadout = document.querySelector("#paceReadout");
const pbReadout = document.querySelector("#pbReadout");
const signalText = document.querySelector("#signalText");
const startButton = document.querySelector("#startButton");
const openLeaderboardButton = document.querySelector("#openLeaderboardButton");
const leftShoe = document.querySelector("#leftShoe");
const rightShoe = document.querySelector("#rightShoe");
const resultsPanel = document.querySelector("#resultsPanel");
const closeResultsButton = document.querySelector("#closeResultsButton");
const finishSubtitle = document.querySelector("#finishSubtitle");
const resultTime = document.querySelector("#resultTime");
const reactionTime = document.querySelector("#reactionTime");
const topSpeedReadout = document.querySelector("#topSpeedReadout");
const resultPbReadout = document.querySelector("#resultPbReadout");
const submitRunForm = document.querySelector("#submitRunForm");
const playerName = document.querySelector("#playerName");
const submitStatus = document.querySelector("#submitStatus");
const leaderboardList = document.querySelector("#leaderboardList");
const leaderboardModal = document.querySelector("#leaderboardModal");
const closeLeaderboardButton = document.querySelector("#closeLeaderboardButton");
const scoresTab = document.querySelector("#scoresTab");
const statsTab = document.querySelector("#statsTab");
const scoresPanel = document.querySelector("#scoresPanel");
const statsPanel = document.querySelector("#statsPanel");
const remoteLeaderboard = document.querySelector("#remoteLeaderboard");
const timeHistogram = document.querySelector("#timeHistogram");
const speedHistogram = document.querySelector("#speedHistogram");
const reactionHistogram = document.querySelector("#reactionHistogram");
const cpsChart = document.querySelector("#cpsChart");
const runner = document.querySelector("#runner");
const trackStage = document.querySelector(".track-stage");

const RACE_METERS = 100;
const TARGET_CLICKS_PER_SECOND = 15;
const TARGET_SECONDS = 10;
const METERS_PER_CLICK = RACE_METERS / (TARGET_CLICKS_PER_SECOND * TARGET_SECONDS);
const CLICKS_FOR_10M = Math.ceil(10 / METERS_PER_CLICK);
const COUNTDOWN_STEP_MS = 760;
const STORAGE_KEY = "tapSprintTopResults";
const PB_STORAGE_KEY = "tapSprintPersonalBests";
const LEGACY_STORAGE_KEY = "tapSprintTopTimes";
const FIREBASE_CONFIG = window.CLICKSPRINT_FIREBASE_CONFIG || {};

let state = "idle";
let distance = 0;
let raceStartAt = 0;
let goAt = 0;
let finishAt = 0;
let firstClickAt = 0;
let expectedFoot = "left";
let validClicks = [];
let countdownTimers = [];
let falseStartTimer = 0;
let signalTimer = 0;
let rafId = 0;
let currentResult = null;
let leaderboardResults = [];
let leaderboardSort = { key: "timeMs", direction: "asc" };

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatReaction(ms) {
  return Number.isFinite(ms) ? `${Math.round(ms)}ms` : "--";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function setSignal(text, mode = "") {
  if (mode === "intro") {
    signalText.innerHTML = `${text}<small>Tap shoes or press G and H keys to run</small>`;
  } else {
    signalText.textContent = text;
  }
  signalText.className = `signal ${mode}`.trim();
}

function loadLocalResults() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(stored) && stored.length) {
      return stored
        .filter((result) => Number.isFinite(result.timeMs))
        .map((result) => ({
          id: result.id || `${result.timeMs}-${result.createdAt || ""}`,
          name: result.name || "Local",
          timeMs: result.timeMs,
          topSpeedCps: Number.isFinite(result.topSpeedCps) ? result.topSpeedCps : 0,
          reactionMs: Number.isFinite(result.reactionMs) ? result.reactionMs : null,
          createdAt: result.createdAt || "",
        }))
        .slice(0, 10);
    }

    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
    return Array.isArray(legacy)
      ? legacy
          .filter(Number.isFinite)
          .map((timeMs) => ({ timeMs, topSpeedCps: 0, reactionMs: null, name: "Local" }))
          .slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

function bestLocalValue(key, mode) {
  const values = loadLocalResults().map((result) => result[key]).filter(Number.isFinite);
  if (!values.length) return null;
  return mode === "max" ? Math.max(...values) : Math.min(...values);
}

function saveLocalResults(results) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results.slice(0, 10)));
  } catch {
    // Locked-down storage should not stop the race flow.
  }
}

function loadLocalPbs() {
  try {
    const stored = JSON.parse(localStorage.getItem(PB_STORAGE_KEY) || "{}");
    return {
      timeMs: Number.isFinite(stored.timeMs) ? stored.timeMs : bestLocalValue("timeMs", "min"),
      topSpeedCps: Number.isFinite(stored.topSpeedCps) ? stored.topSpeedCps : bestLocalValue("topSpeedCps", "max"),
      reactionMs: Number.isFinite(stored.reactionMs) ? stored.reactionMs : bestLocalValue("reactionMs", "min"),
    };
  } catch {
    return {
      timeMs: bestLocalValue("timeMs", "min"),
      topSpeedCps: bestLocalValue("topSpeedCps", "max"),
      reactionMs: bestLocalValue("reactionMs", "min"),
    };
  }
}

function saveLocalPbs(pbs) {
  try {
    localStorage.setItem(PB_STORAGE_KEY, JSON.stringify(pbs));
  } catch {
    // Locked-down storage should not stop the race flow.
  }
}

function updateLocalPbs(result) {
  const pbs = loadLocalPbs();
  const next = {
    timeMs: Number.isFinite(pbs.timeMs) ? Math.min(pbs.timeMs, result.timeMs) : result.timeMs,
    topSpeedCps: Number.isFinite(pbs.topSpeedCps) ? Math.max(pbs.topSpeedCps, result.topSpeedCps) : result.topSpeedCps,
    reactionMs: Number.isFinite(result.reactionMs)
      ? Number.isFinite(pbs.reactionMs)
        ? Math.min(pbs.reactionMs, result.reactionMs)
        : result.reactionMs
      : pbs.reactionMs,
  };
  saveLocalPbs(next);
}

function recordLocalResult(result) {
  const results = [...loadLocalResults(), result].sort((a, b) => a.timeMs - b.timeMs).slice(0, 10);
  saveLocalResults(results);
  return results.findIndex((entry) => entry.id === result.id);
}

function updatePbReadout() {
  const timePb = loadLocalPbs().timeMs;
  const text = Number.isFinite(timePb) ? formatSeconds(timePb) : "--";
  pbReadout.textContent = text;
  resultPbReadout.textContent = text;
}

function getPbFlags(result, previousPbs) {
  return {
    time: !Number.isFinite(previousPbs.timeMs) || result.timeMs < previousPbs.timeMs,
    speed: !Number.isFinite(previousPbs.topSpeedCps) || result.topSpeedCps > previousPbs.topSpeedCps,
    reaction: Number.isFinite(result.reactionMs) && (!Number.isFinite(previousPbs.reactionMs) || result.reactionMs < previousPbs.reactionMs),
  };
}

function renderFinishSubtitle(pbFlags) {
  const pbs = [];
  if (pbFlags.time) pbs.push("Time PB");
  if (pbFlags.speed) pbs.push("Top speed PB");
  if (pbFlags.reaction) pbs.push("Reaction PB");

  finishSubtitle.classList.toggle("new-pb", pbs.length > 0);
  finishSubtitle.textContent = pbs.length ? `New PB! ${pbs.join(" + ")}` : "Race complete";
}

function clearCountdownTimers() {
  countdownTimers.forEach((timer) => clearTimeout(timer));
  countdownTimers = [];
}

function resetRace() {
  clearCountdownTimers();
  clearTimeout(falseStartTimer);
  clearTimeout(signalTimer);
  cancelAnimationFrame(rafId);
  state = "idle";
  distance = 0;
  raceStartAt = 0;
  goAt = 0;
  finishAt = 0;
  firstClickAt = 0;
  expectedFoot = "left";
  validClicks = [];
  currentResult = null;
  startButton.hidden = false;
  startButton.textContent = "Start";
  resultsPanel.hidden = true;
  submitStatus.textContent = "";
  runner.className = "runner";
  setSignal("100m Tap Sprint", "intro");
  updateReadouts(0);
  updatePbReadout();
  updateTrack();
}

function startCountdown() {
  resetRace();
  state = "countdown";
  startButton.hidden = true;
  setSignal("Ready");

  countdownTimers.push(setTimeout(() => setSignal("Set"), COUNTDOWN_STEP_MS));
  countdownTimers.push(
    setTimeout(() => {
      const randomDelay = Math.random() * 3000;
      state = "waiting";
      countdownTimers.push(setTimeout(startRace, randomDelay));
    }, COUNTDOWN_STEP_MS * 2),
  );
}

function startRace() {
  state = "running";
  goAt = performance.now();
  raceStartAt = goAt;
  setSignal("Go", "go");
  trackStage.classList.remove("go-flash");
  void trackStage.offsetWidth;
  trackStage.classList.add("go-flash");
  signalTimer = setTimeout(() => {
    if (state === "running") setSignal("");
  }, 520);
  rafId = requestAnimationFrame(tick);
}

function falseStart() {
  clearCountdownTimers();
  clearTimeout(signalTimer);
  cancelAnimationFrame(rafId);
  state = "false-start";
  setSignal("False start");
  startButton.hidden = true;
  leftShoe.classList.add("invalid");
  rightShoe.classList.add("invalid");
  setTimeout(() => {
    leftShoe.classList.remove("invalid");
    rightShoe.classList.remove("invalid");
  }, 220);
  falseStartTimer = setTimeout(resetRace, 1300);
}

function tick(now) {
  if (state !== "running") return;
  updateReadouts(now - raceStartAt);
  updateTrack();
  rafId = requestAnimationFrame(tick);
}

function recentCps(now) {
  return validClicks.filter((clickAt) => now - clickAt <= 1000).length;
}

function updateReadouts(elapsedMs) {
  const remaining = Math.max(0, RACE_METERS - distance);
  distanceReadout.textContent = `${remaining.toFixed(1)}m`;
  timeReadout.textContent = formatSeconds(elapsedMs);
  paceReadout.textContent = `${recentCps(performance.now()).toFixed(1)}/s`;
}

function updateTrack() {
  const progress = distance / RACE_METERS;
  const topPercent = 82 - progress * 72;
  runner.style.setProperty("--runner-top", `${topPercent.toFixed(2)}%`);
}

function handleShoeTap(foot) {
  if (state === "countdown" || state === "waiting") {
    falseStart();
    return;
  }

  if (state !== "running") return;

  const now = performance.now();
  if (foot !== expectedFoot) {
    const button = foot === "left" ? leftShoe : rightShoe;
    button.classList.add("invalid");
    setTimeout(() => button.classList.remove("invalid"), 190);
    return;
  }

  if (!firstClickAt) firstClickAt = now;
  validClicks.push(now);
  distance = Math.min(RACE_METERS, distance + METERS_PER_CLICK);
  expectedFoot = foot === "left" ? "right" : "left";

  const button = foot === "left" ? leftShoe : rightShoe;
  button.classList.add("active");
  setTimeout(() => button.classList.remove("active"), 80);
  runner.className = `runner step-${foot}`;

  updateReadouts(now - raceStartAt);
  updateTrack();

  if (distance >= RACE_METERS) finishRace(now);
}

function calculateTopSpeedCps(clicks) {
  if (clicks.length < CLICKS_FOR_10M) return 0;

  let best = 0;
  for (let start = 0; start <= clicks.length - CLICKS_FOR_10M; start += 1) {
    const end = start + CLICKS_FOR_10M - 1;
    const elapsedSeconds = (clicks[end] - clicks[start]) / 1000;
    if (elapsedSeconds > 0) {
      best = Math.max(best, (CLICKS_FOR_10M - 1) / elapsedSeconds);
    }
  }
  return best;
}

function finishRace(now) {
  state = "finished";
  finishAt = now;
  cancelAnimationFrame(rafId);

  const totalMs = finishAt - raceStartAt;
  const reactionMs = firstClickAt ? firstClickAt - goAt : null;
  const topSpeedCps = calculateTopSpeedCps(validClicks);
  currentResult = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "",
    timeMs: Math.round(totalMs),
    topSpeedCps: Number(topSpeedCps.toFixed(2)),
    reactionMs: Number.isFinite(reactionMs) ? Math.round(reactionMs) : null,
    createdAt: new Date().toISOString(),
  };

  const previousPbs = loadLocalPbs();
  const pbFlags = getPbFlags(currentResult, previousPbs);
  const leaderboardIndex = recordLocalResult(currentResult);
  updateLocalPbs(currentResult);
  resultTime.textContent = formatSeconds(currentResult.timeMs);
  reactionTime.textContent = formatReaction(currentResult.reactionMs);
  topSpeedReadout.textContent = `${currentResult.topSpeedCps.toFixed(1)}/s`;
  renderFinishSubtitle(pbFlags);
  setSignal("Finished");
  startButton.hidden = false;
  startButton.textContent = "Run Again";
  resultsPanel.hidden = false;
  submitRunForm.hidden = false;
  submitRunForm.querySelector("button").disabled = false;
  updatePbReadout();
  renderLocalLeaderboard(leaderboardIndex);
  updateReadouts(totalMs);
  drawChart(totalMs);
}

function renderLocalLeaderboard(newResultIndex) {
  const results = loadLocalResults();
  leaderboardList.innerHTML = results
    .map((result, index) => {
      const className = index === newResultIndex ? ' class="new-result"' : "";
      return `<li${className}>${formatSeconds(result.timeMs)} <span>${result.topSpeedCps.toFixed(1)}/s</span></li>`;
    })
    .join("");
}

function drawChart(totalMs) {
  const ctx = cpsChart.getContext("2d");
  const width = cpsChart.width;
  const height = cpsChart.height;
  const pad = 30;
  const bins = Math.max(1, Math.ceil(totalMs / 500));
  const counts = Array.from({ length: bins }, () => 0);

  validClicks.forEach((clickAt) => {
    const index = Math.min(bins - 1, Math.floor((clickAt - raceStartAt) / 500));
    counts[index] += 1;
  });

  const cpsValues = counts.map((count) => count * 2);
  const maxCps = Math.max(20, ...cpsValues);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0f120d";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 248, 235, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad + ((height - pad * 1.7) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - 10, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#67c7ff";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  cpsValues.forEach((cps, index) => {
    const x = pad + ((width - pad - 16) * index) / Math.max(1, bins - 1);
    const y = height - pad - (cps / maxCps) * (height - pad * 1.8);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#fff8eb";
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.fillText("Clicks/sec", pad, 24);
  ctx.fillStyle = "#cfc2a9";
  ctx.font = "700 18px system-ui, sans-serif";
  ctx.fillText(`peak ${Math.max(...cpsValues).toFixed(0)}/s`, width - 118, 24);
}

function firebaseReady() {
  return Boolean(FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.apiKey);
}

function firestoreBaseUrl() {
  const projectId = encodeURIComponent(FIREBASE_CONFIG.projectId);
  const apiKey = encodeURIComponent(FIREBASE_CONFIG.apiKey);
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function toFirestoreRun(result) {
  return {
    fields: {
      name: { stringValue: result.name },
      timeMs: { integerValue: String(result.timeMs) },
      topSpeedCps: { doubleValue: result.topSpeedCps },
      reactionMs: { integerValue: String(result.reactionMs ?? 0) },
      createdAt: { timestampValue: result.createdAt },
    },
  };
}

function fromFirestoreRun(doc) {
  const fields = doc.fields || {};
  return {
    id: doc.name || "",
    name: fields.name?.stringValue || "Runner",
    timeMs: Number(fields.timeMs?.integerValue || 0),
    topSpeedCps: Number(fields.topSpeedCps?.doubleValue || fields.topSpeedCps?.integerValue || 0),
    reactionMs: Number(fields.reactionMs?.integerValue || 0),
    createdAt: fields.createdAt?.timestampValue || "",
  };
}

async function submitRun(result) {
  if (!firebaseReady()) throw new Error("Firebase config is missing");

  const url = `${firestoreBaseUrl()}/leaderboard?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toFirestoreRun(result)),
  });

  if (!response.ok) throw new Error(`Firebase rejected the run (${response.status})`);
  return response.json();
}

async function fetchLeaderboard(limit = 100) {
  if (!firebaseReady()) return loadLocalResults();

  const apiKey = encodeURIComponent(FIREBASE_CONFIG.apiKey);
  const url = `${firestoreBaseUrl()}:runQuery?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "leaderboard" }],
        orderBy: [{ field: { fieldPath: "timeMs" }, direction: "ASCENDING" }],
        limit,
      },
    }),
  });

  if (!response.ok) throw new Error(`Could not load leaderboard (${response.status})`);
  const rows = await response.json();
  return rows.filter((row) => row.document).map((row) => fromFirestoreRun(row.document));
}

function renderRemoteLeaderboard(results) {
  leaderboardResults = [...results];
  if (!results.length) {
    remoteLeaderboard.innerHTML = '<p class="empty-state">No leaderboard runs yet.</p>';
    return;
  }

  const sortedResults = sortLeaderboardResults(results);
  const rows = sortedResults
    .map(
      (result, index) => `
        <div class="leaderboard-row">
          <span>${index + 1}</span>
          <strong>${escapeHtml(result.name || "Runner")}</strong>
          <span>${formatSeconds(result.timeMs)}</span>
          <span>${result.topSpeedCps.toFixed(1)}/s</span>
          <span>${formatReaction(result.reactionMs)}</span>
        </div>
      `,
    )
    .join("");

  const sortLabel = (key, label) => {
    const active = leaderboardSort.key === key;
    const arrow = active ? (leaderboardSort.direction === "asc" ? " ^" : " v") : "";
    return `${label}${arrow}`;
  };

  remoteLeaderboard.innerHTML = `
    <div class="leaderboard-row leaderboard-head">
      <span>#</span>
      <button type="button" data-sort="name">${sortLabel("name", "Name")}</button>
      <button type="button" data-sort="timeMs">${sortLabel("timeMs", "Time")}</button>
      <button type="button" data-sort="topSpeedCps">${sortLabel("topSpeedCps", "Top speed (10m)")}</button>
      <button type="button" data-sort="reactionMs">${sortLabel("reactionMs", "React")}</button>
    </div>
    ${rows}
  `;
}

function sortLeaderboardResults(results) {
  const { key, direction } = leaderboardSort;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...results].sort((a, b) => {
    if (key === "name") return multiplier * String(a.name || "").localeCompare(String(b.name || ""));
    return multiplier * ((a[key] ?? Number.POSITIVE_INFINITY) - (b[key] ?? Number.POSITIVE_INFINITY));
  });
}

function setLeaderboardSort(key) {
  if (leaderboardSort.key === key) {
    leaderboardSort.direction = leaderboardSort.direction === "asc" ? "desc" : "asc";
  } else {
    leaderboardSort = { key, direction: key === "topSpeedCps" ? "desc" : "asc" };
  }
  renderRemoteLeaderboard(leaderboardResults);
}

function getBucketCount(values, min, max) {
  const n = values.length;
  if (n <= 2) return n;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor((n - 1) * 0.25)];
  const q3 = sorted[Math.floor((n - 1) * 0.75)];
  const iqr = q3 - q1;
  const spread = max - min;
  if (spread === 0) return 1;

  if (iqr > 0) {
    const bucketWidth = (2 * iqr) / Math.cbrt(n);
    if (bucketWidth > 0) return Math.max(2, Math.min(14, Math.ceil(spread / bucketWidth)));
  }

  return Math.max(2, Math.min(12, Math.ceil(Math.log2(n) + 1)));
}

function drawHistogram(canvas, values, label, formatter, pbValue) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padLeft = 42;
  const padRight = 22;
  const chartTop = 42;
  const chartBottom = height - 34;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0f120d";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff8eb";
  ctx.font = "800 20px system-ui, sans-serif";
  ctx.fillText(label, padLeft, 24);

  if (!values.length) {
    ctx.fillStyle = "#cfc2a9";
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.fillText("No data yet", padLeft, height / 2);
    return;
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const sameValue = rawMin === rawMax;
  const min = sameValue ? rawMin - 0.5 : rawMin;
  const max = sameValue ? rawMax + 0.5 : rawMax;
  const spread = max - min || 1;
  const bucketCount = getBucketCount(values, min, max);
  const buckets = values.length <= 2 ? values.map(() => 1) : Array.from({ length: bucketCount }, () => 0);
  if (values.length > 2) {
    values.forEach((value) => {
      const bucket = Math.min(bucketCount - 1, Math.floor(((value - min) / spread) * bucketCount));
      buckets[bucket] += 1;
    });
  }

  const maxBucket = Math.max(...buckets);
  const chartHeight = chartBottom - chartTop;
  const chartWidth = width - padLeft - padRight;
  const barGap = values.length <= 2 ? 0 : 3;
  const barWidth = (chartWidth - barGap * (bucketCount - 1)) / bucketCount;

  ctx.strokeStyle = "rgba(255, 248, 235, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, chartBottom);
  ctx.lineTo(width - padRight, chartBottom);
  ctx.stroke();

  buckets.forEach((count, index) => {
    const barHeight = (count / maxBucket) * chartHeight;
    const x = padLeft + index * (barWidth + barGap);
    const y = chartBottom - barHeight;
    const gradient = ctx.createLinearGradient(0, y, 0, chartBottom);
    gradient.addColorStop(0, "#8be0ff");
    gradient.addColorStop(1, "#2c83ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth, barHeight);
  });

  if (Number.isFinite(pbValue)) {
    const x = padLeft + ((pbValue - min) / spread) * chartWidth;
    ctx.strokeStyle = "#ffd34d";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, chartTop);
    ctx.lineTo(x, chartBottom);
    ctx.stroke();
    ctx.fillStyle = "#ffd34d";
    ctx.font = "900 14px system-ui, sans-serif";
    ctx.fillText("PB", Math.min(width - padRight - 22, Math.max(padLeft, x + 5)), chartTop + 14);
  }

  ctx.fillStyle = "#cfc2a9";
  ctx.font = "700 16px system-ui, sans-serif";
  ctx.fillText(formatter(rawMin), padLeft, height - 12);
  const maxLabel = formatter(rawMax);
  ctx.fillText(maxLabel, width - padRight - ctx.measureText(maxLabel).width, height - 12);
}

function renderStats(results) {
  const pbs = loadLocalPbs();
  const times = results.map((result) => result.timeMs).filter(Number.isFinite);
  const speeds = results.map((result) => result.topSpeedCps).filter(Number.isFinite);
  const reactions = results.map((result) => result.reactionMs).filter(Number.isFinite);
  drawHistogram(timeHistogram, times, "Best times", formatSeconds, pbs.timeMs);
  drawHistogram(speedHistogram, speeds, "Top speeds (10m)", (value) => `${value.toFixed(1)}/s`, pbs.topSpeedCps);
  drawHistogram(reactionHistogram, reactions, "Best reactions", formatReaction, pbs.reactionMs);
}

async function openLeaderboard() {
  leaderboardModal.hidden = false;
  remoteLeaderboard.innerHTML = '<p class="empty-state">Loading...</p>';
  try {
    const results = await fetchLeaderboard(100);
    renderRemoteLeaderboard(results);
    renderStats(results);
  } catch (error) {
    remoteLeaderboard.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    renderStats(loadLocalResults());
  }
}

function setLeaderboardTab(tab) {
  const statsActive = tab === "stats";
  statsTab.classList.toggle("active", statsActive);
  scoresTab.classList.toggle("active", !statsActive);
  statsPanel.hidden = !statsActive;
  scoresPanel.hidden = statsActive;
}

function bindShoe(button, foot) {
  button.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      handleShoeTap(foot);
    },
    { passive: false },
  );
}

startButton.addEventListener("click", startCountdown);
closeResultsButton.addEventListener("click", () => {
  resultsPanel.hidden = true;
});
openLeaderboardButton.addEventListener("click", openLeaderboard);
remoteLeaderboard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort]");
  if (button) setLeaderboardSort(button.dataset.sort);
});
closeLeaderboardButton.addEventListener("click", () => {
  leaderboardModal.hidden = true;
});
scoresTab.addEventListener("click", () => setLeaderboardTab("scores"));
statsTab.addEventListener("click", () => setLeaderboardTab("stats"));
submitRunForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentResult) return;

  const name = playerName.value.trim().slice(0, 18);
  if (!name) {
    submitStatus.textContent = "Enter a name first.";
    return;
  }

  currentResult.name = name;
  submitRunForm.querySelector("button").disabled = true;
  submitStatus.textContent = "Submitting...";

  try {
    await submitRun(currentResult);
    submitStatus.textContent = "Submitted.";
  } catch (error) {
    submitStatus.textContent = error.message;
    submitRunForm.querySelector("button").disabled = false;
  }
});

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === "g") {
    event.preventDefault();
    handleShoeTap("left");
  }
  if (key === "h") {
    event.preventDefault();
    handleShoeTap("right");
  }
  if (key === "escape") {
    resultsPanel.hidden = true;
    leaderboardModal.hidden = true;
  }
});

bindShoe(leftShoe, "left");
bindShoe(rightShoe, "right");
resetRace();
