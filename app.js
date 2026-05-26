const distanceReadout = document.querySelector("#distanceReadout");
const timeReadout = document.querySelector("#timeReadout");
const paceReadout = document.querySelector("#paceReadout");
const pbReadout = document.querySelector("#pbReadout");
const signalText = document.querySelector("#signalText");
const startButton = document.querySelector("#startButton");
const leftShoe = document.querySelector("#leftShoe");
const rightShoe = document.querySelector("#rightShoe");
const resultsPanel = document.querySelector("#resultsPanel");
const resultTime = document.querySelector("#resultTime");
const reactionTime = document.querySelector("#reactionTime");
const leaderboardList = document.querySelector("#leaderboardList");
const cpsChart = document.querySelector("#cpsChart");
const runner = document.querySelector("#runner");
const trackStage = document.querySelector(".track-stage");

const RACE_METERS = 100;
const TARGET_CLICKS_PER_SECOND = 15;
const TARGET_SECONDS = 10;
const METERS_PER_CLICK = RACE_METERS / (TARGET_CLICKS_PER_SECOND * TARGET_SECONDS);
const COUNTDOWN_STEP_MS = 760;
const STORAGE_KEY = "tapSprintTopTimes";

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

function loadTopTimes() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored.filter(Number.isFinite).slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveTopTimes(times) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(times.slice(0, 10)));
  } catch {
    // Private browsing or locked-down storage should not stop the race flow.
  }
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function setSignal(text, mode = "") {
  if (mode === "intro") {
    signalText.innerHTML = `${text}<small>Tap shoes or press G and H keys to run</small>`;
  } else {
    signalText.textContent = text;
  }
  signalText.className = `signal ${mode}`.trim();
}

function updatePbReadout() {
  const [pb] = loadTopTimes();
  pbReadout.textContent = pb ? formatSeconds(pb) : "--";
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
  startButton.hidden = false;
  startButton.textContent = "Start";
  resultsPanel.hidden = true;
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

function finishRace(now) {
  state = "finished";
  finishAt = now;
  cancelAnimationFrame(rafId);
  const totalMs = finishAt - raceStartAt;
  const leaderboardIndex = recordResult(totalMs);
  resultTime.textContent = formatSeconds(totalMs);
  reactionTime.textContent = firstClickAt ? `${Math.round(firstClickAt - goAt)}ms` : "--";
  setSignal("Finished");
  startButton.hidden = false;
  startButton.textContent = "Run Again";
  resultsPanel.hidden = false;
  updatePbReadout();
  renderLeaderboard(leaderboardIndex);
  updateReadouts(totalMs);
  drawChart(totalMs);
}

function recordResult(totalMs) {
  const times = [...loadTopTimes(), totalMs].sort((a, b) => a - b).slice(0, 10);
  saveTopTimes(times);
  return times.indexOf(totalMs);
}

function renderLeaderboard(newResultIndex) {
  const times = loadTopTimes();
  leaderboardList.innerHTML = times
    .map((time, index) => {
      const className = index === newResultIndex ? ' class="new-result"' : "";
      return `<li${className}>${formatSeconds(time)}</li>`;
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
});
bindShoe(leftShoe, "left");
bindShoe(rightShoe, "right");
resetRace();
