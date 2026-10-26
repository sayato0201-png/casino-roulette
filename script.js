// ===== 基本データ =====

// ヨーロピアンルーレットの盤の並び（時計回り）
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const START_BALANCE = 10000;
const SPIN_TIME = 6000; // 回転する時間（ミリ秒）

function colorOf(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

// 賭けたマス(key)と出た数字(n)から「何倍で戻ってくるか」を返す（外れは0）
function payoutRate(key, n) {
  if (key.startsWith("n")) return Number(key.slice(1)) === n ? 36 : 0;
  if (n === 0) return 0;
  switch (key) {
    case "red":   return RED_NUMBERS.has(n) ? 2 : 0;
    case "black": return !RED_NUMBERS.has(n) ? 2 : 0;
    case "odd":   return n % 2 === 1 ? 2 : 0;
    case "even":  return n % 2 === 0 ? 2 : 0;
    case "low":   return n <= 18 ? 2 : 0;
    case "high":  return n >= 19 ? 2 : 0;
    case "d1":    return n <= 12 ? 3 : 0;
    case "d2":    return n >= 13 && n <= 24 ? 3 : 0;
    case "d3":    return n >= 25 ? 3 : 0;
    case "c1":    return n % 3 === 1 ? 3 : 0;
    case "c2":    return n % 3 === 2 ? 3 : 0;
    case "c3":    return n % 3 === 0 ? 3 : 0;
  }
  return 0;
}

// ===== 状態 =====

let balance = loadNumber("roulette-balance", START_BALANCE);
let history = loadList("roulette-history");
let bets = {};        // { key: 枚数 }
let betLog = [];      // 「1つ戻す」用に置いた順番を記録
let lastBets = {};    // 「前回と同じ」用
let chipValue = 50;
let spinning = false;

function loadNumber(name, fallback) {
  try {
    const v = Number(localStorage.getItem(name));
    return localStorage.getItem(name) !== null && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function loadList(name) {
  try {
    return JSON.parse(localStorage.getItem(name)) || [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem("roulette-balance", balance);
    localStorage.setItem("roulette-history", JSON.stringify(history));
  } catch {
    // 保存できない環境（プライベートモードなど）でも遊べるようにする
  }
}

// ===== 画面の要素 =====

const $ = (id) => document.getElementById(id);
const tableEl = $("table");
const cells = {}; // key → マスの要素

// ===== ベットテーブルを作る =====

function addCell(key, label, className, col, row) {
  const cell = document.createElement("div");
  cell.className = "cell " + className;
  cell.innerHTML = label;
  cell.style.gridColumn = col;
  cell.style.gridRow = row;
  cell.addEventListener("click", () => placeBet(key));
  cell.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    removeBet(key);
  });
  tableEl.appendChild(cell);
  cells[key] = cell;
}

function buildTable() {
  addCell("n0", "0", "green", "1", "1 / 4");

  for (let n = 1; n <= 36; n++) {
    const col = Math.ceil(n / 3) + 1;
    const row = 3 - ((n - 1) % 3);
    addCell("n" + n, String(n), colorOf(n), String(col), String(row));
  }

  addCell("c3", "2 to 1", "outside", "14", "1");
  addCell("c2", "2 to 1", "outside", "14", "2");
  addCell("c1", "2 to 1", "outside", "14", "3");

  addCell("d1", "1st 12", "outside", "2 / 6", "4");
  addCell("d2", "2nd 12", "outside", "6 / 10", "4");
  addCell("d3", "3rd 12", "outside", "10 / 14", "4");

  addCell("low", "1 - 18", "outside", "2 / 4", "5");
  addCell("even", "EVEN", "outside", "4 / 6", "5");
  addCell("red", '<span class="diamond red">◆</span>', "outside", "6 / 8", "5");
  addCell("black", '<span class="diamond black">◆</span>', "outside", "8 / 10", "5");
  addCell("odd", "ODD", "outside", "10 / 12", "5");
  addCell("high", "19 - 36", "outside", "12 / 14", "5");
}

// ===== ベット操作 =====

function totalBet() {
  return Object.values(bets).reduce((sum, v) => sum + v, 0);
}

function placeBet(key, amount = chipValue, log = true) {
  if (spinning) return false;
  if (balance < amount) {
    showMessage("チップが足りません…", "lose");
    return false;
  }
  balance -= amount;
  bets[key] = (bets[key] || 0) + amount;
  if (log) betLog.push({ key, amount });
  clearWinHighlight();
  render();
  return true;
}

function removeBet(key) {
  if (spinning || !bets[key]) return;
  balance += bets[key];
  delete bets[key];
  betLog = betLog.filter((b) => b.key !== key);
  render();
}

function undoBet() {
  if (spinning) return;
  const last = betLog.pop();
  if (!last) return;
  balance += last.amount;
  bets[last.key] -= last.amount;
  if (bets[last.key] <= 0) delete bets[last.key];
  render();
}

function clearBets() {
  if (spinning) return;
  balance += totalBet();
  bets = {};
  betLog = [];
  render();
}

function rebet() {
  if (spinning) return;
  const need = Object.values(lastBets).reduce((s, v) => s + v, 0);
  if (need === 0) return;
  clearBets();
  if (need > balance) {
    showMessage("前回と同じ分のチップがありません…", "lose");
    return;
  }
  for (const [key, amount] of Object.entries(lastBets)) placeBet(key, amount);
}

function doubleBets() {
  if (spinning) return;
  const total = totalBet();
  if (total === 0) return;
  if (total > balance) {
    showMessage("倍にするチップが足りません…", "lose");
    return;
  }
  for (const [key, amount] of Object.entries({ ...bets })) placeBet(key, amount);
}

// ===== 表示の更新 =====

function render() {
  $("balance").textContent = balance.toLocaleString();
  $("total-bet").textContent = totalBet().toLocaleString();

  for (const [key, cell] of Object.entries(cells)) {
    let chip = cell.querySelector(".bet-chip");
    if (bets[key]) {
      if (!chip) {
        chip = document.createElement("span");
        chip.className = "bet-chip";
        cell.appendChild(chip);
      }
      chip.textContent = formatShort(bets[key]);
    } else if (chip) {
      chip.remove();
    }
  }

  const noBets = totalBet() === 0;
  $("spin").disabled = spinning || noBets;
  $("undo").disabled = spinning || betLog.length === 0;
  $("clear").disabled = spinning || noBets;
  $("double").disabled = spinning || noBets;
  $("rebet").disabled = spinning || Object.keys(lastBets).length === 0;
  $("refill").hidden = spinning || balance + totalBet() >= 10;

  renderHistory();
}

function formatShort(v) {
  return v >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "K" : String(v);
}

function renderHistory() {
  const el = $("history");
  if (history.length === 0) {
    el.innerHTML = '<span class="empty">まだありません</span>';
    return;
  }
  el.innerHTML = history
    .map((n) => `<span class="hist ${colorOf(n)}">${n}</span>`)
    .join("");
}

function showMessage(text, type = "") {
  const el = $("message");
  el.textContent = text;
  el.className = "message " + type;
}

function clearWinHighlight() {
  document.querySelectorAll(".cell.win").forEach((c) => c.classList.remove("win"));
}

function highlightWinners(n) {
  clearWinHighlight();
  for (const key of Object.keys(cells)) {
    if (payoutRate(key, n) > 0) cells[key].classList.add("win");
  }
}

// ===== ルーレット盤の描画 =====

const canvas = $("wheel");
const ctx = canvas.getContext("2d");
const SEG = (Math.PI * 2) / WHEEL_ORDER.length; // 1マスの角度

const R_RIM = 198;      // 外側の木のふち
const R_TRACK = 172;    // 玉が回る位置
const R_NUMBERS = 152;  // 数字の帯の外側
const R_POCKET = 126;   // 玉が入るポケットの外側
const R_CONE = 100;     // 真ん中の円すい
const R_BALL_IN = 113;  // ポケットに入った玉の位置

let wheelAngle = 0;
let ballAngle = 0;
let ballRadius = R_BALL_IN;
let resultIndex = 0; // 玉が入っているポケット（WHEEL_ORDER の番号）
let spinState = null;

function setupCanvas() {
  // 高解像度の画面でもくっきり見えるようにする
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 400 * dpr;
  canvas.height = 400 * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawWheel() {
  ctx.clearRect(0, 0, 400, 400);
  ctx.save();
  ctx.translate(200, 200);

  // 外側の木のふち
  let g = ctx.createRadialGradient(0, 0, R_TRACK, 0, 0, R_RIM);
  g.addColorStop(0, "#3b2210");
  g.addColorStop(0.5, "#7a4a22");
  g.addColorStop(1, "#2a160a");
  circle(R_RIM, g);
  circle(R_RIM - 4, "#5a3518");

  // 玉が転がる溝
  g = ctx.createRadialGradient(0, 0, R_NUMBERS, 0, 0, R_RIM - 6);
  g.addColorStop(0, "#1a0f07");
  g.addColorStop(1, "#4a2c14");
  circle(R_RIM - 8, g);

  // ここから下は盤と一緒に回る部分
  ctx.save();
  ctx.rotate(wheelAngle);

  for (let i = 0; i < WHEEL_ORDER.length; i++) {
    const n = WHEEL_ORDER[i];
    const start = -Math.PI / 2 + i * SEG - SEG / 2;
    const color = { red: "#b8261a", black: "#151515", green: "#0e8a3a" }[colorOf(n)];

    // 数字の帯
    ctx.beginPath();
    ctx.arc(0, 0, R_NUMBERS, start, start + SEG);
    ctx.arc(0, 0, R_CONE, start + SEG, start, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // ポケット（少し暗くして奥行きを出す）
    ctx.beginPath();
    ctx.arc(0, 0, R_POCKET, start, start + SEG);
    ctx.arc(0, 0, R_CONE, start + SEG, start, true);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();

    // 仕切り
    ctx.beginPath();
    ctx.moveTo(Math.cos(start) * R_CONE, Math.sin(start) * R_CONE);
    ctx.lineTo(Math.cos(start) * R_NUMBERS, Math.sin(start) * R_NUMBERS);
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 数字
    ctx.save();
    ctx.rotate(i * SEG);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 0, -(R_POCKET + R_NUMBERS) / 2);
    ctx.restore();
  }

  ring(R_NUMBERS, "#d4af37", 2);
  ring(R_POCKET, "#d4af37", 1.5);

  // 真ん中の円すい
  g = ctx.createRadialGradient(-20, -20, 10, 0, 0, R_CONE);
  g.addColorStop(0, "#a8713d");
  g.addColorStop(1, "#4a2a12");
  circle(R_CONE, g);
  ring(R_CONE, "#d4af37", 2);

  // 真ん中の金の飾り（タレット）
  ctx.strokeStyle = "#e6c35c";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.rotate((k * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -60);
    ctx.stroke();
    circle(7, "#e6c35c", 0, -62);
    ctx.restore();
  }
  g = ctx.createRadialGradient(-5, -5, 2, 0, 0, 20);
  g.addColorStop(0, "#fff3c4");
  g.addColorStop(1, "#b8901f");
  circle(18, g);

  ctx.restore(); // 盤の回転おわり

  // 玉
  const a = ballAngle - Math.PI / 2;
  const bx = Math.cos(a) * ballRadius;
  const by = Math.sin(a) * ballRadius;
  g = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 8);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#b9b9b9");
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  circle(7, g, bx, by);
  ctx.shadowBlur = 0;

  ctx.restore();
}

function circle(r, fill, x = 0, y = 0) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function ring(r, color, width) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// ===== スピン =====

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function randomIndex() {
  // Math.random より偏りの少ない乱数を使う
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / WHEEL_ORDER.length) * WHEEL_ORDER.length;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % WHEEL_ORDER.length;
}

function spin() {
  if (spinning || totalBet() === 0) return;
  spinning = true;
  lastBets = { ...bets };
  clearWinHighlight();
  showMessage("No more bets!（ベット締め切り）");
  $("result-num").textContent = "?";
  $("result-num").className = "result-num";
  render();

  // 先に結果を決めて、玉がそのポケットに止まるように動かす
  const index = randomIndex();
  const wheelStart = wheelAngle;
  const wheelEnd = wheelStart + Math.PI * 2 * 3 + Math.random() * Math.PI * 2;
  const target = wheelEnd + index * SEG; // 止まったときの玉の角度
  const diff = (((target - ballAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  spinState = {
    startTime: performance.now(),
    index,
    wheelStart,
    wheelEnd,
    ballStart: ballAngle,
    ballEnd: ballAngle + diff - Math.PI * 2 * 7, // 玉は盤と反対向きに7周以上
  };
}

function updateSpin(now) {
  const t = Math.min((now - spinState.startTime) / SPIN_TIME, 1);
  const s = spinState;

  wheelAngle = s.wheelStart + (s.wheelEnd - s.wheelStart) * easeOutCubic(t);
  ballAngle = s.ballStart + (s.ballEnd - s.ballStart) * easeOutQuart(t);

  // 途中から玉が内側に落ちて、少し跳ねる
  const p = Math.min(Math.max((t - 0.55) / 0.35, 0), 1);
  const bounce = Math.sin(p * Math.PI * 4) * 7 * (1 - p);
  ballRadius = R_TRACK + (R_BALL_IN - R_TRACK) * easeInOut(p) + (p > 0 && p < 1 ? Math.abs(bounce) : 0);

  if (t >= 1) finishSpin(s.index);
}

function finishSpin(index) {
  spinState = null;
  spinning = false;
  resultIndex = index;
  ballRadius = R_BALL_IN;

  const n = WHEEL_ORDER[index];
  const color = colorOf(n);
  const resultEl = $("result-num");
  resultEl.textContent = n;
  resultEl.className = "result-num " + color;

  let payout = 0;
  for (const [key, amount] of Object.entries(bets)) {
    payout += amount * payoutRate(key, n);
  }
  const net = payout - totalBet();
  balance += payout;

  const colorName = { red: "赤", black: "黒", green: "緑" }[color];
  if (payout > 0) {
    showMessage(`${n}（${colorName}）！ 当たり ${payout.toLocaleString()} 枚（${net >= 0 ? "+" : ""}${net.toLocaleString()}）`, "win");
  } else {
    showMessage(`${n}（${colorName}）… 残念、はずれ（${net.toLocaleString()}）`, "lose");
  }

  highlightWinners(n);
  history.unshift(n);
  history = history.slice(0, 15);
  bets = {};
  betLog = [];
  save();
  render();
}

// ===== アニメーションのループ =====

let lastTime = performance.now();

function loop(now) {
  const dt = now - lastTime;
  lastTime = now;

  if (spinState) {
    updateSpin(now);
  } else {
    // 待っている間もゆっくり回す（玉はポケットの中）
    wheelAngle += dt * 0.00015;
    ballAngle = wheelAngle + resultIndex * SEG;
  }

  drawWheel();
  requestAnimationFrame(loop);
}

// ===== ボタンなどの設定 =====

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
    chip.classList.add("selected");
    chipValue = Number(chip.dataset.value);
  });
});

$("spin").addEventListener("click", spin);
$("undo").addEventListener("click", undoBet);
$("clear").addEventListener("click", clearBets);
$("rebet").addEventListener("click", rebet);
$("double").addEventListener("click", doubleBets);
$("refill").addEventListener("click", () => {
  balance = START_BALANCE;
  showMessage("チップを補充しました！");
  save();
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    spin();
  }
});

setupCanvas();
buildTable();
render();
requestAnimationFrame(loop);
