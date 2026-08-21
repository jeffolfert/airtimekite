// Airtime Kite — Hood River session
// Single-file canvas game. No frameworks. No build.

(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  const TWO_PI = Math.PI * 2;
  const BEST_KEY = "airtimeKiteBestV1";
  const REPAIR_URL = "https://www.airtimekite.com/";
  const VERSION = "2026.08.20.5";
  const versionEl = document.getElementById("version");
  if (versionEl) versionEl.textContent = VERSION;
  const repairLink = document.getElementById("repair-link");
  if (repairLink) repairLink.href = REPAIR_URL;

  const STATE = { TITLE: 0, PLAY: 1, WIPE: 2 };

  const PX = 10; // pixels per meter at zoom 1

  // ---------- utilities ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  function wrapLines(g, text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = line + " " + words[i];
      if (g.measureText(next).width <= maxWidth) line = next;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
    return lines;
  }

  function wrapAddress(g, text, maxWidth) {
    if (g.measureText(text).width <= maxWidth) return [text];
    const parts = String(text).split(/\s+·\s+/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => g.measureText(p).width <= maxWidth)) return parts;
    return wrapLines(g, text, maxWidth);
  }

  const wrap = (v, a, b) => {
    const r = b - a;
    return ((((v - a) % r) + r) % r) + a;
  };

  function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const h = (n) => {
      const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    return lerp(h(i), h(i + 1), u);
  }

  function fbm(x, oct) {
    let v = 0, a = 0.5, f = 1, s = 0;
    for (let i = 0; i < oct; i++) {
      v += a * noise1(x * f);
      s += a;
      a *= 0.5;
      f *= 2.03;
    }
    return v / s;
  }

  // ---------- audio (tiny, synthesized) ----------
  const audio = {
    ctx: null,
    wind: null,
    gain: null,
    started: false,
  };

  function ensureAudio() {
    if (audio.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    audio.ctx = ac;
    audio.started = true;

    // Filtered noise = gorge wind
    const bufSize = 2 * ac.sampleRate;
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufSize; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[i] = last * 2.2;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.7;
    const g = ac.createGain();
    g.gain.value = 0.0;
    src.connect(filter);
    filter.connect(g);
    g.connect(ac.destination);
    src.start();
    audio.wind = { filter, gain: g };
    audio.gain = g;
  }

  function setWindHum(knots, speed) {
    if (!audio.wind) return;
    const t = audio.ctx.currentTime;
    const amt = clamp((knots - 8) / 28, 0, 1) * 0.055 + clamp(speed / 28, 0, 1) * 0.02;
    audio.wind.gain.gain.setTargetAtTime(amt, t, 0.25);
    audio.wind.filter.frequency.setTargetAtTime(280 + knots * 12, t, 0.3);
  }

  function blip(freq, dur, type, vol) {
    if (!audio.ctx) return;
    const ac = audio.ctx;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.08, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur);
  }

  function whoosh() {
    if (!audio.ctx) return;
    const ac = audio.ctx;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(140, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(420, ac.currentTime + 0.18);
    g.gain.setValueAtTime(0.05, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.28);
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    o.connect(f);
    f.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.3);
  }

  function splash() {
    if (!audio.ctx) return;
    const ac = audio.ctx;
    const n = ac.createBufferSource();
    const buf = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 700;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.18, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.28);
    n.connect(f);
    f.connect(g);
    g.connect(ac.destination);
    n.start();
  }

  // ---------- input ----------
  const keys = Object.create(null);
  const pointer = {
    down: false,
    x: 0,
    y: 0,
    id: null,
  };
  const joy = {
    active: false,
    id: null,
    cx: 0,
    cy: 0,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
  };
  const buttons = {
    pop: false,
    grab: false,
    edge: false,
    popId: null,
    grabId: null,
    edgeId: null,
  };
  let popPressed = false;
  let popLatched = false;
  let startLatched = false;
  let touchMode = false;

  function keyOn(e, on) {
    const k = e.key;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Spacebar"].includes(k)) {
      e.preventDefault();
    }
    keys[k.toLowerCase()] = on;
    if (k === " " || k === "Spacebar") {
      if (on) popPressed = true;
      keys[" "] = on;
    }
    if (on && (k === " " || k === "Enter")) startLatched = true;
  }

  window.addEventListener("keydown", (e) => keyOn(e, true), { passive: false });
  window.addEventListener("keyup", (e) => keyOn(e, false), { passive: false });

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  }

  function hitBtn(p, b) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    return dx * dx + dy * dy <= b.r * b.r;
  }

  const layout = {
    joy: { x: 0, y: 0, r: 70 },
    pop: { x: 0, y: 0, r: 48 },
    grab: { x: 0, y: 0, r: 38 },
    edge: { x: 0, y: 0, r: 34 },
    repair: { x: 0, y: 0, w: 0, h: 0, visible: false },
  };

  const shopDance = {
    active: false,
    t: 0,
    duration: 2,
    opened: false,
    waitTap: false,
  };

  function layoutTouch(w, h) {
    const pad = Math.max(28, w * 0.03);
    const jr = clamp(h * 0.11, 56, 84);
    layout.joy.r = jr;
    layout.joy.x = pad + jr + 8;
    layout.joy.y = h - pad - jr - 8;
    layout.pop.r = clamp(h * 0.075, 40, 56);
    layout.pop.x = w - pad - layout.pop.r - 8;
    layout.pop.y = h - pad - layout.pop.r - 18;
    layout.grab.r = clamp(h * 0.058, 32, 44);
    layout.grab.x = layout.pop.x - layout.pop.r - layout.grab.r - 18;
    layout.grab.y = layout.pop.y + 10;
    layout.edge.r = clamp(h * 0.05, 28, 40);
    layout.edge.x = layout.pop.x + 6;
    layout.edge.y = layout.pop.y - layout.pop.r - layout.edge.r - 14;
  }

  function hitRepair(p) {
    const b = layout.repair;
    if (!b.visible) return false;
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  function launchAirtime() {
    try {
      const w = window.open(REPAIR_URL, "_blank", "noopener,noreferrer");
      if (w) return true;
    } catch (err) {}
    return false;
  }

  function openRepair() {
    launchAirtime();
  }

  function onPointerDown(e) {
    touchMode = e.pointerType === "touch" || e.pointerType === "pen";
    const p = canvasPos(e);
    pointer.down = true;
    pointer.x = p.x;
    pointer.y = p.y;
    if (state === STATE.WIPE && hitRepair(p)) {
      openRepair();
      return;
    }
    startLatched = true;
    ensureAudio();
    document.body.classList.add("started");

    if (state !== STATE.PLAY) {
      pointer.id = e.pointerId;
      return;
    }

    if (hitBtn(p, layout.pop)) {
      buttons.pop = true;
      buttons.popId = e.pointerId;
      popPressed = true;
      return;
    }
    if (hitBtn(p, layout.grab)) {
      buttons.grab = true;
      buttons.grabId = e.pointerId;
      return;
    }
    if (hitBtn(p, layout.edge)) {
      buttons.edge = true;
      buttons.edgeId = e.pointerId;
      return;
    }
    // joystick — left half or near pad
    if (p.x < canvas.width * 0.55 || hitBtn(p, layout.joy)) {
      joy.active = true;
      joy.id = e.pointerId;
      joy.cx = layout.joy.x;
      joy.cy = layout.joy.y;
      updateJoy(p);
    } else {
      buttons.pop = true;
      buttons.popId = e.pointerId;
      popPressed = true;
    }
  }

  function updateJoy(p) {
    const dx = p.x - joy.cx;
    const dy = p.y - joy.cy;
    const m = Math.hypot(dx, dy) || 1;
    const max = layout.joy.r * 0.72;
    const s = Math.min(1, m / max);
    joy.x = (dx / m) * s;
    joy.y = (dy / m) * s;
    joy.px = joy.cx + joy.x * max;
    joy.py = joy.cy + joy.y * max;
  }

  function onPointerMove(e) {
    const p = canvasPos(e);
    pointer.x = p.x;
    pointer.y = p.y;
    if (joy.active && e.pointerId === joy.id) updateJoy(p);
    canvas.style.cursor = (state === STATE.WIPE && hitRepair(p)) ? "pointer" : (document.body.classList.contains("started") ? "none" : "crosshair");
  }

  function onPointerUp(e) {
    if (e.pointerId === joy.id) {
      joy.active = false;
      joy.id = null;
      joy.x = 0;
      joy.y = 0;
    }
    if (e.pointerId === buttons.popId) {
      buttons.pop = false;
      buttons.popId = null;
    }
    if (e.pointerId === buttons.grabId) {
      buttons.grab = false;
      buttons.grabId = null;
    }
    if (e.pointerId === buttons.edgeId) {
      buttons.edge = false;
      buttons.edgeId = null;
    }
    if (e.pointerId === pointer.id) pointer.down = false;
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- world / run state ----------
  let state = STATE.TITLE;
  let time = 0;
  let runTime = 0;
  let dpr = 1;
  let W = 800;
  let H = 600;
  let waterY = 420;
  let shake = 0;
  let flash = 0;

  const rider = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    lean: 0,
    spin: 0,
    spinV: 0,
    onWater: true,
    edge: 0,
    boardAngle: 0,
  };

  const kite = {
    pos: 0.15,
    h: 0.72,
    vpos: 0,
    vh: 0,
    angle: 0,
    pull: 0,
    send: 0,
    visX: 0,
    visY: 0,
    loopAccum: 0,
    lastAtan: 0,
    torn: false,
  };

  const wind = {
    knots: 18,
    target: 18,
    gust: 0,
    dir: 1,
    next: 4,
    label: "W",
  };

  const run = {
    dist: 0,
    air: 0,
    score: 0,
    combo: 0,
    comboT: 0,
    maxAir: 0,
    maxSpeed: 0,
    tricks: [],
    jumpCount: 0,
    loops: 0,
    grabs: 0,
    passes: 0,
    thisJump: {
      air: 0,
      grabbed: false,
      looped: false,
      passed: false,
      scoredJump: false,
      path: 0,
      peakY: 0,
    },
  };

  let best = null;
  try {
    best = JSON.parse(localStorage.getItem(BEST_KEY) || "null");
  } catch (e) {
    best = null;
  }

  let wipe = {
    t: 0,
    why: "",
    tag: "",
    final: null,
    quote: null,
  };

  const bladder = {
    blown: false,
    t: 0,
    next: 14,
  };

  const chaos = {
    next: 16,
  };

  const birds = [];
  let birdClock = 9;

  const barges = [];
  let bargeClock = 18;

  const windsurfers = [];
  let windsurfClock = 11;

  const spray = [];
  const pops = [];
  const foams = [];
  const gustMarks = [];

  const WIPE_LINES = {
    yoink: [
      "YOINKED",
      "THE GORGE SAID NO",
      "THAT GUST HAD PLANS",
      "OVERPOWERED",
      "WELCOME TO THE GORGE",
    ],
    stall: [
      "SOFT. TOO SOFT.",
      "KITE WENT FISHING",
      "UNDERPOWERED",
      "WAITING ON THE WIND",
      "SINKING",
    ],
    crash: [
      "THAT LANDING COUNTED",
      "BOARD SAID GOODBYE",
      "BACK TO THE RIVER",
      "ALMOST STYLISH",
    ],
    waterkite: [
      "KITE IN THE RIVER",
      "RELAUNCH PRACTICE",
      "LINES IN THE DRINK",
    ],
    bladder: [
      "BLADDER EXPLODED.",
      "THERE GOES THE LEADING EDGE",
      "POP. THAT'S A BLADDER.",
      "SOMEONE CALL AIRTIME",
      "THAT KITE JUST SIGHED",
    ],
    edge: [
      "EDGE CATCH",
      "CAUGHT AN EDGE",
      "FIN IN THE CHOP",
      "THAT RAIL BIT BACK",
      "BOARDED YOURSELF",
    ],
    loopfail: [
      "LOOP GONE WRONG",
      "THAT LOOP HAD IDEAS",
      "KITE ATE THE LINES",
      "WINDOW? WHAT WINDOW",
      "SENT IT. THE RIVER KEPT IT",
    ],
    gustslam: [
      "GUST SLAM",
      "NUCLEAR FROM BEHIND",
      "THE GORGE SAID SIT DOWN",
      "THAT PUFF WAS PERSONAL",
      "WEST WIND TAX",
    ],
    chop: [
      "CHOP TO THE FACE",
      "RIVER SAID NO",
      "WHITECAP WHIPLASH",
      "HOLE IN THE FACE",
      "COLUMBIA SLAP",
    ],
    bird: [
      "BIRD STRIKE",
    ],
    barge: [
      "BARGE",
      "GRAIN TRAIN",
      "TUG SAID EXCUSE ME",
      "THAT IS NOT A KICKER",
      "COMMERCIAL TRAFFIC",
    ],
    windsurfer: [
      "WINDSURFER",
      "SAIL COLLISION",
      "THAT WAS A PERSON",
      "EVENT SITE TRAFFIC",
      "WATCH THE RIG",
    ],
  };

  const BLADDER_PARTS = [
    "leading-edge bladder",
    "strut bladder",
    "both struts",
    "leading edge and a valve",
    "blown bladder and a seam",
    "one-point hose and a strut",
    "the whole leading edge",
  ];
  const BLADDER_NOTES = [
    "Today if you drop it at the shop.",
    "We've got that one on the shelf.",
    "Drop it at the shop.",
    "This afternoon if you bring it by 4.",
    "Classic Gorge day. We'll get you riding.",
    "Hood River special — back on the water soon.",
    "Leave it at Airtime. We'll call when it's done.",
    "Couple hours if the sewing machine is free.",
  ];
  const BARGE_PARTS = [
    "leading edge vs a hopper",
    "canopy and a bent bar",
    "torn strut and the chicken loop",
    "one side of the leading edge",
    "a wrapped line and a dinged board",
  ];
  const CRASH_PARTS = [
    "stretched lines and a dinged board",
    "cracked board and a blown valve",
    "a tweaked bar and the leading edge",
    "both tips and a seam",
  ];
  const LOOP_PARTS = [
    "a twisted line set",
    "bridle and a wrapped leading edge",
    "lines through the canopy",
    "the bar and a cooked bridle",
  ];
  const WATER_PARTS = [
    "a soaked bladder and a valve",
    "lines and a rinse",
    "sand in the valve and a strut",
    "a soggy leading edge",
  ];
  const REPAIR_WIPES = {
    bladder: true,
    bird: true,
    barge: true,
    crash: true,
    loopfail: true,
    waterkite: true,
  };

  function isRepairWipe(kind) {
    return !!REPAIR_WIPES[kind];
  }

  // ---------- particles ----------
  function emitSpray(n, x, y, vx, heavy) {
    for (let i = 0; i < n; i++) {
      spray.push({
        x: x + rand(-0.6, 0.4),
        y: Math.max(0.05, y) + rand(0, 0.25),
        vx: -Math.abs(vx) * rand(0.08, 0.25) + rand(-2, 1),
        vy: rand(1.6, 5.5) * (heavy ? 1.35 : 1),
        life: rand(0.28, 0.7),
        age: 0,
        r: rand(1.2, 3.4) * (heavy ? 1.4 : 1),
      });
    }
  }

  function emitSplash(x, y, power) {
    const n = 14 + (power * 18) | 0;
    for (let i = 0; i < n; i++) {
      spray.push({
        x: x + rand(-1.4, 1.4),
        y: 0.05,
        vx: rand(-8, 6),
        vy: rand(3, 14) * (0.6 + power),
        life: rand(0.35, 0.9),
        age: 0,
        r: rand(2, 5),
      });
    }
    splash();
  }

  function popup(text, color, big) {
    pops.push({
      text,
      color: color || "#fff6c8",
      x: rider.x,
      y: rider.y + 40,
      vy: big ? -70 : -50,
      age: 0,
      life: big ? 1.5 : 1.1,
      big: !!big,
    });
  }

  function popBladderSfx() {
    if (!audio.ctx) return;
    const ac = audio.ctx;
    blip(86, 0.2, "square", 0.11);
    blip(190, 0.14, "sawtooth", 0.07);
    const n = ac.createBufferSource();
    const buf = ac.createBuffer(1, ac.sampleRate * 0.35, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 420;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.16, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.4);
    n.connect(f);
    f.connect(g);
    g.connect(ac.destination);
    n.start();
  }

  function makeEstimate(kind) {
    const steps = 45 + Math.round(Math.random() * 27) * 5;
    if (kind === "bird") {
      return {
        price: clamp(steps + 20, 65, 200),
        part: "canopy shredded",
        note: pick(BLADDER_NOTES),
      };
    }
    if (kind === "barge") {
      return {
        price: clamp(steps + 25, 70, 210),
        part: pick(BARGE_PARTS),
        note: pick(BLADDER_NOTES),
      };
    }
    if (kind === "crash") {
      return {
        price: clamp(steps + 10, 55, 190),
        part: pick(CRASH_PARTS),
        note: pick(BLADDER_NOTES),
      };
    }
    if (kind === "loopfail") {
      return {
        price: clamp(steps + 15, 60, 195),
        part: pick(LOOP_PARTS),
        note: pick(BLADDER_NOTES),
      };
    }
    if (kind === "waterkite") {
      return {
        price: clamp(steps, 45, 160),
        part: pick(WATER_PARTS),
        note: pick(BLADDER_NOTES),
      };
    }
    return {
      price: clamp(steps, 45, 180),
      part: pick(BLADDER_PARTS),
      note: pick(BLADDER_NOTES),
    };
  }

  function explodeBladder() {
    if (bladder.blown || state !== STATE.PLAY) return;
    bladder.blown = true;
    bladder.t = 0;
    kite.pull = 0;
    kite.send = 0;
    shake = 16;
    flash = 0.55;
    popup("BLADDER EXPLODED.", "#ffb080", true);
    const kp = kiteScreenPos();
    for (let i = 0; i < 30; i++) {
      spray.push({
        x: kp.x + rand(-1.4, 1.4),
        y: kp.y + rand(-0.8, 0.5),
        vx: rand(-11, 11),
        vy: rand(-3, 15),
        life: rand(0.4, 1.15),
        age: 0,
        r: rand(2, 7),
      });
    }
    popBladderSfx();
  }

  function maybeExplode(dt) {
    if (bladder.blown || state !== STATE.PLAY) return;
    if (runTime < 6.5) return;
    bladder.next -= dt;
    if (bladder.next <= 0) {
      if (Math.random() < 0.52 + clamp(kite.pull, 0, 1) * 0.12) explodeBladder();
      else bladder.next = rand(8, 18);
    }
  }

  function crashThud() {
    if (!audio.ctx) return;
    blip(70, 0.18, "square", 0.09);
    blip(120, 0.12, "sawtooth", 0.05);
    splash();
  }

  function birdSquawk() {
    if (!audio.ctx) return;
    const ac = audio.ctx;
    blip(620, 0.09, "square", 0.05);
    blip(880, 0.07, "sawtooth", 0.035);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(740, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(280, ac.currentTime + 0.16);
    g.gain.setValueAtTime(0.06, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.2);
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.22);
  }

  function bargeHorn() {
    if (!audio.ctx) return;
    const ac = audio.ctx;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(92, ac.currentTime);
    o.frequency.linearRampToValueAtTime(74, ac.currentTime + 0.55);
    g.gain.setValueAtTime(0.07, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.7);
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 240;
    o.connect(f);
    f.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.72);
  }

  function bargeNear() {
    for (let i = 0; i < barges.length; i++) {
      const b = barges[i];
      if (b.sinking) continue;
      if (rider.x > b.x - 28 && rider.x < b.x + b.len + 10) return true;
    }
    return false;
  }

  function windsurfNear() {
    for (let i = 0; i < windsurfers.length; i++) {
      const w = windsurfers[i];
      if (rider.x > w.x - 16 && rider.x < w.x + 12) return true;
    }
    return false;
  }

  function bargeOccupies(x, pad) {
    for (let i = 0; i < barges.length; i++) {
      const b = barges[i];
      if (b.sinking) continue;
      if (x > b.x - pad && x < b.x + b.len + pad) return true;
    }
    return false;
  }

  function maybeChaos(dt) {
    if (state !== STATE.PLAY || bladder.blown) return;
    if (runTime < 10) return;
    if (bargeNear() || windsurfNear()) {
      chaos.next = Math.max(chaos.next, 3.5);
      return;
    }
    chaos.next -= dt;
    if (chaos.next > 0) return;
    chaos.next = rand(14, 24);
    if (Math.random() > 0.35) return;

    let kind = "chop";
    if (!rider.onWater && Math.abs(kite.loopAccum) > 1.8) kind = "loopfail";
    else if (!rider.onWater && Math.random() < 0.42) kind = "loopfail";
    else if (wind.gust > 0.45 || wind.knots > 24) kind = "gustslam";
    else if (rider.onWater && rider.edge > 0.45) kind = "edge";
    else kind = pick(["chop", "edge", "gustslam", "chop"]);

    crashThud();
    beginWipe(kind);
  }

  function spawnBird() {
    const kp = kiteScreenPos();
    const fromLeft = Math.random() < 0.5;
    const kind = Math.random() < 0.55 ? "gull" : "osprey";
    const high = kind === "osprey";
    birds.push({
      x: kp.x + (fromLeft ? -30 : 30) + rand(-8, 8),
      y: kp.y + (high ? rand(8, 18) : rand(1, 12)),
      vx: fromLeft ? rand(9, 15) : -rand(9, 15),
      vy: high ? -rand(0.5, 2.5) : rand(-2, 2),
      kind,
      wing: rand(0, TWO_PI),
      dive: false,
      hit: false,
      scored: false,
      close: false,
      age: 0,
    });
    if (Math.random() < 0.4) blip(540, 0.06, "triangle", 0.03);
  }

  function emitBirdBurst(x, y) {
    for (let i = 0; i < 18; i++) {
      spray.push({
        x: x + rand(-0.45, 0.45),
        y: y + rand(-0.35, 0.35),
        vx: rand(-16, 16),
        vy: rand(-4, 18),
        life: rand(0.28, 0.72),
        age: 0,
        r: rand(2, 6),
        col: Math.random() < 0.55 ? "rgba(255,210,110," : "rgba(255,140,70,",
      });
    }
  }

  function explodeSessionBirds() {
    let n = 0;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      if (b.exploded) continue;
      b.exploded = true;
      b.hit = true;
      b.scored = true;
      b.boomT = 0;
      b.vx = rand(-16, 16);
      b.vy = rand(5, 18);
      emitFeathers(b.x, b.y, b.kind);
      emitBirdBurst(b.x, b.y);
      birdSquawk();
      n += 1;
    }
    return n;
  }

  function sinkSessionBarges() {
    let n = 0;
    for (let i = 0; i < barges.length; i++) {
      const b = barges[i];
      if (b.sinking) continue;
      b.sinking = true;
      b.sinkT = 0;
      emitSplash(b.x + b.len * 0.35, 0, 1.25);
      emitSplash(b.x + b.len * 0.75, 0, 1.05);
      bargeHorn();
      n += 1;
    }
    if (n) bargeClock = Math.max(bargeClock, 12);
    return n;
  }

  function landingOnBarge() {
    for (let i = 0; i < barges.length; i++) {
      const b = barges[i];
      if (b.sinking) continue;
      if (bargeObstacleHeight(b, rider.x) > 0) return true;
    }
    return false;
  }

  function isGreatAir() {
    // Past MEGA AIR and a real peak — weak hops and skim loaded pops do not count.
    return run.thisJump.scoredJump && run.thisJump.air >= 3.25 && run.thisJump.peakY >= 15.5;
  }

  function celebrateGreatAir() {
    const birdsN = explodeSessionBirds();
    const bargeN = sinkSessionBarges();
    if (!birdsN && !bargeN) return;
    if (birdsN) addScore(220 + birdsN * 90, "BIRDS DOWN", "#ffd36a", true);
    if (bargeN) addScore(380, "BARGE SUNK", "#9ad0ff", true);
    if (birdsN && bargeN) popup("THE GORGE SAID YES", "#fff6d8", true);
    shake = Math.max(shake, 11);
    flash = Math.max(flash, 0.3);
    whoosh();
  }

  function emitFeathers(x, y, kind) {
    const col = kind === "osprey" ? "rgba(176,118,58," : "rgba(236,236,242,";
    for (let i = 0; i < 16; i++) {
      spray.push({
        x: x + rand(-0.5, 0.5),
        y: y + rand(-0.4, 0.4),
        vx: rand(-9, 9),
        vy: rand(-2, 11),
        life: rand(0.4, 0.95),
        age: 0,
        r: rand(1.4, 3.4),
        col,
      });
    }
  }

  function kiteCanopyHit(bx, by, birdR) {
    const kp = kiteScreenPos();
    const dx = bx - kp.x;
    const dy = by - kp.y;
    const scale = 1 + clamp(kite.pull * 0.15, 0, 0.25);
    const hw = (46 * scale) / PX + birdR;
    const hh = (16 * scale) / PX + birdR;
    return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1;
  }

  function onBirdHit(b) {
    if (b.hit || state !== STATE.PLAY || bladder.blown) return;
    b.hit = true;
    b.scored = true;
    b.vx += rand(-8, 8);
    b.vy += rand(3, 8);
    shake = 14;
    flash = 0.35;
    birdSquawk();
    emitFeathers(b.x, b.y, b.kind);

    const kp = kiteScreenPos();
    kite.vpos += (b.x > kp.x ? -1 : 1) * rand(5, 9);
    kite.vh += rand(-6.5, -1.2);
    kite.pos = clamp(kite.pos + rand(-0.28, 0.28), -0.98, 0.98);
    kite.h = clamp(kite.h + rand(-0.18, -0.04), 0.16, 0.98);
    rider.vx *= 0.78;
    if (!rider.onWater) rider.vy += rand(-2, 6);

    kite.torn = true;
    popup("BIRD STRIKE", "#ffd36a", true);
    beginWipe("bird");
  }

  function stepBirds(dt) {
    if (state === STATE.PLAY && !bladder.blown) {
      birdClock -= dt;
      if (birdClock <= 0 && birds.length < 2) {
        spawnBird();
        if (Math.random() < 0.22) spawnBird();
        birdClock = rand(10, 16);
      }
    }

    const kp = kiteScreenPos();
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      b.age += dt;
      b.wing += dt * (b.dive ? 18 : 11);

      if (state === STATE.PLAY && !b.hit && !bladder.blown && b.age > 0.35) {
        b.dive = true;
        const dx = kp.x - b.x;
        const dy = kp.y - b.y;
        const dist = Math.hypot(dx, dy) || 1;
        const spd = b.kind === "osprey" ? 16.5 : 14.2;
        const aim = b.kind === "osprey" ? 0.54 : 0.44;
        const k = 1 - Math.pow(1 - aim, dt * 7);
        b.vx = lerp(b.vx, (dx / dist) * spd, k);
        b.vy = lerp(b.vy, (dy / dist) * spd, k);

        const birdR = b.kind === "osprey" ? 1.4 : 1.1;
        if (kiteCanopyHit(b.x, b.y, birdR)) {
          onBirdHit(b);
        } else if (!b.scored && dist < 7.2 && b.age > 0.7) {
          b.close = true;
        } else if (b.close && !b.hit && !b.scored && dist > 5.6) {
          b.scored = true;
          addScore(140, "DODGED", "#c8f7ff", false);
        }
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.exploded) {
        b.boomT = (b.boomT || 0) + dt;
        if (b.boomT > 0.5) {
          birds.splice(i, 1);
          continue;
        }
      }
      if (b.age > 6.5 || Math.abs(b.x - rider.x) > 90) birds.splice(i, 1);
    }
  }

  function spawnBarge() {
    // 1 grain barge + tug is the usual Columbia traffic; sometimes a double.
    // Length is tuned so a loaded pop with enough air can clear and land clean.
    const units = Math.random() < 0.62 ? 1 : 2;
    const bargeLen = 14;
    const tugLen = 12;
    const gap = 2;
    const len = tugLen + units * bargeLen + (units + 1) * gap;
    barges.push({
      x: rider.x + rand(88, 138),
      vx: -rand(2.4, 3.6),
      units,
      tugLen,
      bargeLen,
      gap,
      len,
      horned: false,
      cleared: false,
      scored: false,
      sinking: false,
      sinkT: 0,
    });
    popup("BARGE UPRIVER", "#d8c49a", false);
  }

  // Visual heights (PX=10): hoppers ~5.6m, tug stack ~6.8m, deck/couplings ~2.8m.
  function bargeObstacleHeight(b, x) {
    if (x < b.x - 0.8 || x > b.x + b.len + 0.8) return 0;
    let cx = b.x + b.gap;
    for (let u = 0; u < b.units; u++) {
      if (x >= cx - 0.35 && x <= cx + b.bargeLen + 0.35) return 5.7;
      cx += b.bargeLen + b.gap;
    }
    if (x >= cx - 0.25 && x <= cx + b.tugLen + 1.0) return 6.8;
    return 2.5;
  }

  function stepBarges(dt) {
    if (state === STATE.PLAY && !bladder.blown) {
      bargeClock -= dt;
      if (bargeClock <= 0 && barges.length === 0) {
        spawnBarge();
        bargeClock = rand(24, 40);
      }
    }

    for (let i = barges.length - 1; i >= 0; i--) {
      const b = barges[i];
      b.x += b.vx * dt;
      if (b.sinking) {
        b.sinkT += dt;
        b.vx *= 0.985;
        if (Math.random() < 0.55) {
          emitSpray(2, b.x + rand(0, b.len), rand(0, 0.2), 3, true);
        }
        if (b.sinkT > 2.35) barges.splice(i, 1);
        continue;
      }
      if (!b.horned && b.x - rider.x < 58 && rider.x < b.x + b.len + 20) {
        b.horned = true;
        bargeHorn();
      }
      if (state === STATE.PLAY && !bladder.blown) {
        const hitH = bargeObstacleHeight(b, rider.x);
        if (hitH > 0 && rider.y < hitH) {
          crashThud();
          beginWipe("barge");
        } else if (hitH > 0 && rider.y >= hitH) {
          b.cleared = true;
        } else if (!b.scored && b.cleared && rider.x > b.x + b.len + 1.2) {
          b.scored = true;
          addScore(420, "BARGE JUMP", "#ffe08a", true);
          blip(360, 0.12, "triangle", 0.05);
          blip(540, 0.14, "sine", 0.05);
        }
      }
      if (b.x + b.len < rider.x - 70) barges.splice(i, 1);
    }
  }

  function drawBarges(g) {
    for (const b of barges) {
      const sx = wx(b.x);
      if (sx > W + 80 || sx + b.len * PX < -80) continue;
      const sy = wy(0);
      g.save();
      const sinkT = b.sinking ? b.sinkT : 0;
      if (sinkT > 0) {
        const midX = sx + b.len * PX * 0.5;
        g.globalAlpha = 1 - clamp((sinkT - 0.7) / 1.6, 0, 0.88);
        g.translate(midX, sy + sinkT * 48);
        g.rotate(sinkT * 0.2);
        g.translate(-midX, -sy);
      }

      // wake
      g.fillStyle = "rgba(210,236,250,0.22)";
      g.beginPath();
      g.moveTo(sx - 18, sy + 6);
      g.lineTo(sx + b.len * PX + 24, sy + 4);
      g.lineTo(sx + b.len * PX + 8, sy + 18);
      g.lineTo(sx + 10, sy + 20);
      g.closePath();
      g.fill();

      let x = b.x + b.gap;
      for (let u = 0; u < b.units; u++) {
        const bx = wx(x);
        const bw = b.bargeLen * PX;
        const deckY = sy - 28;
        g.fillStyle = "rgba(10,16,22,0.35)";
        g.fillRect(bx - 4, sy + 4, bw + 8, 10);
        g.fillStyle = "#2a241c";
        g.fillRect(bx, deckY, bw, 34);
        g.fillStyle = "#4a3a2a";
        g.fillRect(bx + 3, deckY + 4, bw - 6, 10);
        // grain hoppers
        const hops = 3;
        const hw = (bw - 16) / hops;
        for (let h = 0; h < hops; h++) {
          const hx = bx + 8 + h * hw;
          g.fillStyle = "#6a5340";
          g.beginPath();
          g.moveTo(hx, deckY + 6);
          g.lineTo(hx + hw * 0.5, deckY - 28);
          g.lineTo(hx + hw - 4, deckY + 6);
          g.closePath();
          g.fill();
          g.fillStyle = "#8a6a48";
          g.fillRect(hx + 3, deckY + 6, hw - 10, 12);
        }
        g.fillStyle = "rgba(255,220,160,0.45)";
        g.font = "700 9px Trebuchet MS, sans-serif";
        g.textAlign = "center";
        g.fillText("COLUMBIA GRAIN", bx + bw * 0.5, deckY + 20);
        x += b.bargeLen + b.gap;
      }

      // tug pushing from the upriver end
      const tx = wx(x);
      const tw = b.tugLen * PX;
      const ty = sy - 28;
      g.fillStyle = "#1c1a16";
      g.fillRect(tx, ty + 10, tw, 22);
      g.fillStyle = "#c45a22";
      g.fillRect(tx + 8, ty - 18, tw * 0.55, 30);
      g.fillStyle = "#2a4050";
      g.fillRect(tx + 14, ty - 34, tw * 0.36, 18);
      g.fillStyle = "#d8e6f0";
      g.fillRect(tx + 18, ty - 30, 10, 8);
      g.fillRect(tx + 30, ty - 30, 8, 8);
      // stack
      g.fillStyle = "#2a221c";
      g.fillRect(tx + tw * 0.72, ty - 40, 8, 28);
      g.fillStyle = "rgba(200,200,200,0.35)";
      const puff = time * 0.7;
      g.beginPath();
      g.arc(tx + tw * 0.72 + 4 + Math.sin(puff) * 3, ty - 48 - (puff % 1) * 10, 6, 0, TWO_PI);
      g.arc(tx + tw * 0.72 + 10, ty - 58, 5, 0, TWO_PI);
      g.fill();
      g.fillStyle = "#e8d2a0";
      g.font = "800 9px Trebuchet MS, sans-serif";
      g.textAlign = "center";
      g.fillText("GORGE", tx + tw * 0.38, ty + 2);
      // bow fender
      g.fillStyle = "#3a3028";
      g.beginPath();
      g.moveTo(tx + tw, ty + 10);
      g.lineTo(tx + tw + 10, ty + 22);
      g.lineTo(tx + tw, ty + 32);
      g.fill();

      g.restore();
    }
  }

  const WINDSURF_SAILS = [
    ["#ff8a2b", "#2ec4b6"],
    ["#4d8cbc", "#fff6d8"],
    ["#e27a2a", "#1b2430"],
    ["#ff5ad5", "#7ecbff"],
  ];

  function spawnWindsurfer() {
    if (windsurfers.length >= 2) return false;
    const x = rider.x + rand(40, 78);
    if (bargeOccupies(x, 22)) return false;
    for (let i = 0; i < windsurfers.length; i++) {
      if (Math.abs(windsurfers[i].x - x) < 36) return false;
    }
    const toward = Math.random() < 0.55;
    const colors = pick(WINDSURF_SAILS);
    windsurfers.push({
      x,
      vx: toward ? -rand(1.6, 3.4) : rand(1.2, 3.2),
      facing: toward ? -1 : 1,
      phase: rand(0, TWO_PI),
      c0: colors[0],
      c1: colors[1],
      cleared: false,
      scored: false,
    });
    return true;
  }

  function stepWindsurfers(dt) {
    if (state === STATE.PLAY && !bladder.blown && runTime > 7) {
      windsurfClock -= dt;
      if (windsurfClock <= 0) {
        if (spawnWindsurfer()) windsurfClock = rand(13, 22);
        else windsurfClock = rand(3, 6);
      }
    }

    const hitW = 1.9;
    const hitH = 4.4;
    for (let i = windsurfers.length - 1; i >= 0; i--) {
      const w = windsurfers[i];
      w.x += w.vx * dt;
      w.phase += dt;
      if (state === STATE.PLAY && !bladder.blown) {
        if (rider.x > w.x - hitW && rider.x < w.x + hitW) {
          if (rider.y < hitH) {
            crashThud();
            beginWipe("windsurfer");
          } else {
            w.cleared = true;
          }
        } else if (!w.scored && w.cleared && rider.x > w.x + hitW + 0.6) {
          w.scored = true;
          addScore(160, "SAIL BY", "#9ad0ff", false);
          blip(480, 0.09, "triangle", 0.04);
        }
      }
      if (w.x < rider.x - 55 || w.x > rider.x + 110) windsurfers.splice(i, 1);
    }
  }

  function drawWindsurfers(g) {
    for (const w of windsurfers) {
      const x = wx(w.x);
      if (x < -70 || x > W + 70) continue;
      const y = wy(0) + Math.sin(time * 6.5 + w.phase) * 2.2;
      g.save();
      g.translate(x, y);
      if (w.facing < 0) g.scale(-1, 1);

      g.fillStyle = "rgba(210,236,250,0.22)";
      g.beginPath();
      g.moveTo(-28, 8);
      g.lineTo(26, 6);
      g.lineTo(18, 16);
      g.lineTo(-16, 17);
      g.closePath();
      g.fill();

      g.fillStyle = "#eef4f8";
      g.beginPath();
      g.moveTo(-20, 4);
      g.quadraticCurveTo(2, -1, 24, 3);
      g.quadraticCurveTo(4, 9, -20, 7);
      g.closePath();
      g.fill();
      g.fillStyle = "#e27a2a";
      g.fillRect(-3, 2.5, 12, 2.6);
      g.fillStyle = "#1a2430";
      g.beginPath();
      g.moveTo(3, 7);
      g.lineTo(7, 15);
      g.lineTo(-1, 7);
      g.fill();

      const lean = 0.32 + Math.sin(time * 3.1 + w.phase) * 0.07;
      g.save();
      g.rotate(-lean);
      g.strokeStyle = "#1a1f28";
      g.lineWidth = 3.2;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(1, 2);
      g.lineTo(-5, 8);
      g.moveTo(1, 2);
      g.lineTo(7, 8);
      g.stroke();
      g.fillStyle = "#163848";
      g.beginPath();
      g.ellipse(0, -6, 5.4, 8.2, 0, 0, TWO_PI);
      g.fill();
      g.strokeStyle = "#e27a2a";
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(0, -3, 5, 0.15, Math.PI - 0.15);
      g.stroke();
      g.strokeStyle = "#d7b39a";
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(3, -10);
      g.lineTo(16, -18);
      g.stroke();
      g.fillStyle = "#e8c2a4";
      g.beginPath();
      g.arc(1, -16, 4.2, 0, TWO_PI);
      g.fill();
      g.fillStyle = "#2b333e";
      g.beginPath();
      g.arc(1, -17, 4.3, Math.PI, TWO_PI);
      g.fill();
      g.restore();

      g.save();
      g.rotate(-0.38 + Math.sin(time * 2.1 + w.phase) * 0.05);
      g.strokeStyle = "#d8dde2";
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(2, 1);
      g.lineTo(-7, -50);
      g.stroke();
      g.beginPath();
      g.moveTo(2, 1);
      g.lineTo(-7, -50);
      g.lineTo(30, -16);
      g.closePath();
      const sg = g.createLinearGradient(-7, -50, 30, 4);
      sg.addColorStop(0, w.c0);
      sg.addColorStop(0.5, "#fff6d8");
      sg.addColorStop(1, w.c1);
      g.fillStyle = sg;
      g.fill();
      g.strokeStyle = "rgba(30,18,10,0.28)";
      g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = "#2a241c";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(0, -17);
      g.lineTo(28, -16);
      g.stroke();
      g.restore();

      g.restore();
    }
  }

  function drawBirds(g) {
    for (const b of birds) {
      const x = wx(b.x);
      const y = wy(b.y);
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
      const flap = Math.sin(b.wing);
      const osprey = b.kind === "osprey";
      g.save();
      g.translate(x, y);
      g.rotate(Math.atan2(-b.vy, b.vx) * 0.45 + (b.exploded ? (b.boomT || 0) * 14 : 0));
      if (b.vx < 0) g.scale(-1, 1);
      if (b.exploded) {
        const s = clamp(1 - (b.boomT || 0) * 1.6, 0.15, 1);
        g.scale(s * 1.2, s * 0.7);
        g.globalAlpha = clamp(1 - (b.boomT || 0) * 1.8, 0, 1);
      }

      // wings
      g.fillStyle = osprey ? "#6a4a2c" : "#f2f2f6";
      g.beginPath();
      g.ellipse(-2, flap * 5, osprey ? 16 : 13, osprey ? 4.2 : 3.4, -0.35 + flap * 0.7, 0, TWO_PI);
      g.ellipse(10, -flap * 5, osprey ? 16 : 13, osprey ? 4.2 : 3.4, 0.35 - flap * 0.7, 0, TWO_PI);
      g.fill();
      if (osprey) {
        g.fillStyle = "#efe6d2";
        g.beginPath();
        g.ellipse(4, 1, 7, 3.2, 0, 0, TWO_PI);
        g.fill();
      }
      // body
      g.fillStyle = osprey ? "#4a3220" : "#ececf2";
      g.beginPath();
      g.ellipse(4, 1, osprey ? 9 : 7.5, osprey ? 4.2 : 3.4, 0, 0, TWO_PI);
      g.fill();
      // head
      g.fillStyle = osprey ? "#efe6d2" : "#ffffff";
      g.beginPath();
      g.arc(12, 0, osprey ? 3.6 : 3, 0, TWO_PI);
      g.fill();
      g.fillStyle = "#f2a030";
      g.beginPath();
      g.moveTo(14.5, 0.4);
      g.lineTo(19, 1.2);
      g.lineTo(14.5, 2.2);
      g.fill();
      g.fillStyle = "#1a1410";
      g.beginPath();
      g.arc(12.6, -0.6, 0.7, 0, TWO_PI);
      g.fill();
      // tail
      g.fillStyle = osprey ? "#2c2016" : "#d0d4dc";
      g.beginPath();
      g.moveTo(-4, 0);
      g.lineTo(-12, -3);
      g.lineTo(-11, 3);
      g.fill();
      g.restore();
    }
  }

  // ---------- scoring ----------
  function addScore(n, label, color, big) {
    const mult = 1 + run.combo * 0.35;
    const got = Math.round(n * mult);
    run.score += got;
    if (label) {
      run.tricks.push(label);
      popup((mult > 1.05 ? "x" + mult.toFixed(1) + " " : "") + label + "  +" + got, color, big);
    }
    run.combo += 1;
    run.comboT = 2.4;
  }

  function loadBest() {
    return best;
  }

  function saveBest() {
    const rec = {
      score: run.score | 0,
      dist: run.dist,
      air: run.air,
      loops: run.loops,
      jumps: run.jumpCount,
    };
    if (!best || rec.score > best.score) {
      best = rec;
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(best));
      } catch (e) {}
      return true;
    }
    return false;
  }

  // ---------- reset / start ----------
  function resetRun() {
    rider.x = 0;
    rider.y = 0;
    rider.vx = 6;
    rider.vy = 0;
    rider.lean = 0;
    rider.spin = 0;
    rider.spinV = 0;
    rider.onWater = true;
    rider.edge = 0.4;
    rider.boardAngle = 0;

    kite.pos = 0.22;
    kite.h = 0.7;
    kite.vpos = 0;
    kite.vh = 0;
    kite.pull = 0.4;
    kite.send = 0;
    kite.loopAccum = 0;
    kite.lastAtan = Math.atan2(kite.h - 0.5, kite.pos);

    wind.knots = rand(15, 20);
    wind.target = wind.knots;
    wind.gust = 0;
    wind.next = rand(5, 9);

    run.dist = 0;
    run.air = 0;
    run.score = 0;
    run.combo = 0;
    run.comboT = 0;
    run.maxAir = 0;
    run.maxSpeed = 0;
    run.tricks.length = 0;
    run.jumpCount = 0;
    run.loops = 0;
    run.grabs = 0;
    run.passes = 0;
    run.thisJump.air = 0;
    run.thisJump.grabbed = false;
    run.thisJump.looped = false;
    run.thisJump.passed = false;
    run.thisJump.scoredJump = false;
    run.thisJump.path = 0;
    run.thisJump.peakY = 0;

    rider.yank = 0;
    rider.stall = 0;
    cam.x = rider.x * PX + 80;
    cam.y = 0;

    spray.length = 0;
    pops.length = 0;
    foams.length = 0;
    gustMarks.length = 0;
    runTime = 0;
    shake = 0;
    flash = 0;
    wipe.t = 0;
    wipe.final = null;
    wipe.quote = null;
    bladder.blown = false;
    bladder.t = 0;
    bladder.next = rand(11, 24);
    kite.torn = false;
    chaos.next = rand(12, 18);
    birds.length = 0;
    barges.length = 0;
    windsurfers.length = 0;
    birdClock = rand(7, 12);
    bargeClock = rand(14, 22);
    windsurfClock = rand(8, 14);
    layout.repair.visible = false;
    if (repairLink) repairLink.style.display = "none";
    shopDance.active = false;
    shopDance.t = 0;
    shopDance.opened = false;
    shopDance.waitTap = false;
  }

  function startPlay() {
    resetRun();
    state = STATE.PLAY;
    ensureAudio();
    if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
    blip(440, 0.08, "sine", 0.06);
    blip(660, 0.12, "sine", 0.05);
    document.body.classList.add("started");
  }

  function beginWipe(kind) {
    if (state !== STATE.PLAY) return;
    state = STATE.WIPE;
    wipe.t = 0;
    wipe.why = kind;
    wipe.tag = pick(WIPE_LINES[kind] || WIPE_LINES.crash);
    wipe.quote = isRepairWipe(kind) ? makeEstimate(kind) : null;
    rider.spinV = rand(-10, 10);
    rider.vy = Math.min(rider.vy, -2);
    shake = 12;
    flash = 0.35;
    emitSplash(rider.x, 0, 1.1);
    setWindHum(8, 0);
    const record = saveBest();
    wipe.final = {
      score: run.score | 0,
      dist: run.dist,
      air: run.air,
      record,
    };
  }

  // ---------- resize ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = (W * dpr) | 0;
    canvas.height = (H * dpr) | 0;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    waterY = H * 0.62;
    layoutTouch(W, H);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- control read ----------
  function controls() {
    const left = !!(keys["arrowleft"] || keys["a"]);
    const right = !!(keys["arrowright"] || keys["d"]);
    const up = !!(keys["arrowup"] || keys["w"]);
    const down = !!(keys["arrowdown"] || keys["s"]);
    const grab = !!(keys["shift"] || keys["g"] || buttons.grab);
    const edgeKey = down || buttons.edge;

    let kx = 0;
    let ky = 0;
    if (left) kx -= 1;
    if (right) kx += 1;
    if (up) ky -= 1;
    if (down) ky += 1;
    if (joy.active) {
      kx = joy.x;
      ky = joy.y;
    }

    const pop = popPressed || buttons.pop || !!(keys[" "]);
    const popEdge = popPressed;
    popPressed = false;

    return {
      kx: clamp(kx, -1, 1),
      ky: clamp(ky, -1, 1),
      grab,
      edge: edgeKey || (joy.active && joy.y > 0.45),
      pop: popEdge || (pop && rider.onWater),
      popHold: pop,
    };
  }

  // ---------- physics ----------
  function stepWind(dt) {
    wind.next -= dt;
    if (wind.next <= 0) {
      // Gorge session: long west, then a hole, then a nuke
      const roll = Math.random();
      if (roll < 0.18) {
        wind.target = rand(8, 12); // hole
        wind.next = rand(3.5, 6);
        popup("HOLE", "#9fd4ff", false);
      } else if (roll < 0.38) {
        wind.target = rand(24, 32); // nuclear
        wind.next = rand(4, 7);
        popup("GUST COMING", "#ffb36b", true);
        gustMarks.push({ t: 0, life: 2.2 });
      } else {
        wind.target = rand(14, 22);
        wind.next = rand(6, 11);
      }
    }
    wind.knots = lerp(wind.knots, wind.target, 1 - Math.pow(0.12, dt));
    // micro texture
    wind.knots += Math.sin(time * 1.7) * 0.15 + Math.sin(time * 4.1) * 0.08;
    wind.gust = clamp((wind.knots - 20) / 12, 0, 1);
  }

  function stepKite(dt, c) {
    if (bladder.blown) {
      bladder.t += dt;
      kite.pull = 0;
      kite.send = lerp(kite.send, 0, 1 - Math.pow(0.02, dt));
      kite.h = lerp(kite.h, 0.2, 1 - Math.pow(0.08, dt));
      kite.pos += Math.sin(bladder.t * 18) * 0.014;
      kite.vpos *= 0.9;
      kite.vh *= 0.9;
      if (bladder.t > 0.58 && state === STATE.PLAY) beginWipe("bladder");
      return;
    }

    const steer = 2.15;
    const wantPos = kite.pos + c.kx * steer * dt * 1.8;
    const wantH = kite.h - c.ky * steer * dt * 1.15;

    // spring toward desired + player rate
    kite.vpos += (c.kx * 7.5 - kite.vpos * 4.2) * dt;
    kite.vh += (-c.ky * 6.2 - kite.vh * 4.4) * dt;

    kite.pos += kite.vpos * dt;
    kite.h += kite.vh * dt;

    kite.pos = clamp(kite.pos, -0.98, 0.98);
    kite.h = clamp(kite.h, 0.16, 0.98);

    // bounce off edges
    if (kite.pos <= -0.98 || kite.pos >= 0.98) kite.vpos *= -0.25;
    if (kite.h <= 0.16 || kite.h >= 0.98) kite.vh *= -0.2;

    const speed = Math.hypot(kite.vpos, kite.vh);
    kite.send = lerp(kite.send, speed, 1 - Math.pow(0.02, dt));

    // pull model — power zone is low-mid window, slightly in from the edge
    const heightPow = 1 - Math.abs(kite.h - 0.38) * 0.85;
    const sidePow = 0.55 + 0.45 * (1 - Math.abs(kite.pos) * 0.35);
    const zone = clamp(heightPow, 0.15, 1) * sidePow;
    const wind01 = clamp((wind.knots - 6) / 24, 0, 1.35);
    const sendBoost = kite.send * (0.55 + 0.7 * (1 - kite.h));
    kite.pull = wind01 * (0.28 + 0.72 * zone) + sendBoost * 0.22;
    if (kite.torn) {
      kite.pull *= 0.84;
      kite.pos += Math.sin(time * 14) * 0.004;
    }

    kite.angle = Math.atan2(-1, kite.pos * 1.4);

    // loop winding around window center
    const at = Math.atan2(kite.h - 0.52, kite.pos);
    let d = at - kite.lastAtan;
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    kite.lastAtan = at;
    if (!rider.onWater) kite.loopAccum += d;
    else kite.loopAccum = 0;
  }

  function stepRider(dt, c) {
    const pull = kite.pull;
    rider.edge = lerp(rider.edge, c.edge ? 1 : (c.ky > 0.35 ? 0.75 : 0.12), 1 - Math.pow(0.04, dt));

    // drive: kite a bit ahead of the rider pulls you downwind/across
    const along = 0.62 + 0.38 * Math.max(0, kite.pos * 0.35 + 0.65);
    const edgeDrive = 0.55 + 0.7 * rider.edge;
    const accel = pull * 26 * along * edgeDrive;
    const drag = 0.55 + rider.edge * 0.35 + clamp(rider.vx, 0, 30) * 0.032;
    rider.vx += (accel - rider.vx * drag) * dt;
    rider.vx = clamp(rider.vx, -2, 34);

    // slight x from kite side
    rider.x += rider.vx * dt;
    run.dist = rider.x / 1; // meters (vx is m/s-ish)
    run.maxSpeed = Math.max(run.maxSpeed, rider.vx);

    if (rider.onWater) {
      rider.y = Math.sin(time * 6 + rider.x * 0.08) * 0.04 * clamp(rider.vx / 10, 0.3, 1);
      rider.vy = 0;
      rider.spin *= 0.8;
      rider.spinV *= 0.7;
      rider.boardAngle = lerp(rider.boardAngle, rider.lean * 0.25 - rider.edge * 0.15, 0.2);

      // jump / pop
      const loaded = rider.vx > 7.2 && rider.edge > 0.28 && pull > 0.38;
      const loft = clamp((kite.h - 0.45) * 1.4, 0, 1);
      const sendUp = Math.max(0, kite.vh) + kite.send * 0.35;
      if (c.pop && loaded) {
        let pop = 11.4 + rider.vx * 0.4 + pull * 6.2 + sendUp * 3.5 + loft * 4.0;
        for (let i = 0; i < barges.length; i++) {
          const ahead = barges[i].x - rider.x;
          if (ahead > 4 && ahead < 26) {
            pop += 3.4;
            break;
          }
        }
        rider.vy = pop;
        rider.onWater = false;
        rider.spinV = (kite.vpos + (c.grab ? 2 : 0.4)) * 1.1;
        run.jumpCount += 1;
        run.thisJump.air = 0;
        run.thisJump.grabbed = false;
        run.thisJump.looped = false;
        run.thisJump.passed = false;
        run.thisJump.scoredJump = false;
        run.thisJump.path = 0;
        run.thisJump.peakY = 0;
        kite.loopAccum = 0;
        emitSplash(rider.x, 0, 0.45 + pull * 0.4);
        whoosh();
        shake = 4;
      } else if (c.pop && !loaded && rider.vx > 3) {
        // weak hop
        rider.vy = 5.2 + pull * 3.4;
        rider.onWater = false;
        run.jumpCount += 1;
        run.thisJump.air = 0;
        run.thisJump.grabbed = false;
        run.thisJump.looped = false;
        run.thisJump.passed = false;
        run.thisJump.scoredJump = false;
        run.thisJump.peakY = 0;
        emitSpray(8, rider.x, 0, rider.vx, false);
      }

      // spray while planing
      if (rider.vx > 6 && Math.random() < 0.65) {
        emitSpray(rider.edge > 0.5 ? 3 : 1, rider.x - 0.4, 0, -rider.vx, rider.edge > 0.6);
      }
    } else {
      // airborne
      const kiteLift = pull * 8.4 * (0.52 + kite.h * 0.72);
      const loopLift = Math.abs(kite.loopAccum) > 1.2 ? 6.8 * pull : 0;
      rider.vy += (-15.2 + kiteLift + loopLift) * dt;
      rider.vy = clamp(rider.vy, -24, 38);
      rider.y += rider.vy * dt;
      run.thisJump.air += dt;
      run.air += dt;
      run.maxAir = Math.max(run.maxAir, run.thisJump.air);
      run.thisJump.peakY = Math.max(run.thisJump.peakY, rider.y);

      rider.spinV += kite.vpos * 1.8 * dt;
      if (c.grab) rider.spinV += 2.6 * dt;
      rider.spin += rider.spinV * dt;
      rider.boardAngle = rider.spin;

      if (!run.thisJump.scoredJump && run.thisJump.air > 0.18) {
        run.thisJump.scoredJump = true;
        addScore(40 + Math.round(rider.vx * 2), "JUMP", "#ffe28a", false);
      }
      if (c.grab && !run.thisJump.grabbed && run.thisJump.air > 0.12) {
        run.thisJump.grabbed = true;
        run.grabs += 1;
        addScore(75, "GRAB", "#7dffc3", false);
        blip(520, 0.09, "triangle", 0.06);
      }
      if (!run.thisJump.looped && Math.abs(kite.loopAccum) > TWO_PI * 0.92) {
        run.thisJump.looped = true;
        run.loops += 1;
        rider.vy += 5.5;
        rider.spinV += kite.loopAccum > 0 ? 8 : -8;
        addScore(300, "KITELOOP", "#ff8a4a", true);
        blip(300, 0.16, "sawtooth", 0.05);
        blip(600, 0.12, "sine", 0.06);
        shake = 7;
      }
      if (!run.thisJump.passed && run.thisJump.grabbed && Math.abs(rider.spin) > TWO_PI * 0.95) {
        run.thisJump.passed = true;
        run.passes += 1;
        addScore(450, "HANDLEPASS", "#ff5ad5", true);
        blip(720, 0.14, "square", 0.04);
      }
      if (run.thisJump.air > 1.45 && run.thisJump.scoredJump && run.thisJump.air < 1.45 + dt) {
        addScore(100, "BIG AIR", "#c8e7ff", false);
      }
      if (run.thisJump.air > 2.6 && run.thisJump.scoredJump && run.thisJump.air < 2.6 + dt) {
        addScore(180, "MEGA AIR", "#ffe08a", true);
      }

      if (rider.y <= 0 && rider.vy <= 0) {
        // land
        const hard = -rider.vy;
        rider.y = 0;
        rider.onWater = true;
        emitSplash(rider.x, 0, clamp(hard / 16, 0.25, 1.4));
        shake = hard * 0.45;
        if (!bladder.blown && hard > 24 && Math.abs(rider.spin % TWO_PI) > 1.55 && !run.thisJump.grabbed) {
          beginWipe("crash");
          return;
        }
        if (hard > 8) {
          addScore(30, "CLEAN", "#d4fff0", false);
        }
        if (isGreatAir() && !landingOnBarge()) celebrateGreatAir();
        rider.spin = 0;
        rider.spinV = 0;
        rider.vy = 0;
        // keep combo alive
        run.comboT = Math.max(run.comboT, 2.1);
      }
    }

    rider.lean = lerp(rider.lean, kite.pos * 0.55 - rider.edge * 0.2 + (c.grab && !rider.onWater ? 0.5 : 0), 0.18);

    // wipeout checks — short grace so the drop-in is always rideable
    if (state !== STATE.PLAY) return;
    if (bladder.blown) return;
    if (runTime < 2.2) {
      rider.yank = 0;
      rider.stall = 0;
    } else if (kite.h <= 0.165 && rider.y < 6 && pull < 0.22) {
      beginWipe("waterkite");
      return;
    }

    const yank = pull - (0.28 + rider.edge * 0.7 + clamp(rider.vx / 40, 0, 0.2));
    if (yank > 0.55 && rider.onWater) {
      rider.yank = (rider.yank || 0) + dt * (0.7 + yank);
      if (rider.yank > 0.85) {
        beginWipe("yoink");
        return;
      }
    } else {
      rider.yank = Math.max(0, (rider.yank || 0) - dt * 0.9);
    }

    if (pull < 0.18 && rider.vx < 4.2 && rider.onWater) {
      rider.stall = (rider.stall || 0) + dt;
      if (rider.stall > 1.6) {
        beginWipe("stall");
        return;
      }
    } else {
      rider.stall = Math.max(0, (rider.stall || 0) - dt * 0.7);
    }

    // distance score trickle
    run.score += rider.vx * dt * 0.55;
    if (!rider.onWater) run.score += dt * 12;

    if (run.comboT > 0) {
      run.comboT -= dt;
      if (run.comboT <= 0) run.combo = 0;
    }
  }

  function stepParticles(dt) {
    for (let i = spray.length - 1; i >= 0; i--) {
      const p = spray[i];
      p.age += dt;
      p.vy -= 22 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age > p.life || p.y < -0.2) spray.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      p.age += dt;
      p.y += p.vy * dt * 0.08;
      p.vy *= 0.96;
      if (p.age > p.life) pops.splice(i, 1);
    }
    for (let i = gustMarks.length - 1; i >= 0; i--) {
      gustMarks[i].t += dt;
      if (gustMarks[i].t > gustMarks[i].life) gustMarks.splice(i, 1);
    }
    if (spray.length > 220) spray.splice(0, spray.length - 220);
  }

  // ---------- camera ----------
  const cam = { x: 0, y: 0 };
  function stepCam(dt) {
    const targetX = rider.x * PX + 80;
    const targetY = -rider.y * PX * 0.62;
    cam.x = lerp(cam.x, targetX, 1 - Math.pow(0.05, dt));
    cam.y = lerp(cam.y, targetY, 1 - Math.pow(0.08, dt));
    shake *= Math.pow(0.04, dt);
    flash *= Math.pow(0.02, dt);
  }

  function wx(x) {
    return x * PX - cam.x + W * 0.38;
  }
  function wy(y) {
    return waterY - y * PX - cam.y;
  }

  // ---------- draw helpers ----------
  function sky(g) {
    const grd = g.createLinearGradient(0, 0, 0, H);
    const nuke = clamp((wind.knots - 16) / 16, 0, 1);
    grd.addColorStop(0, lerpHex("#1b3d66", "#243044", nuke));
    grd.addColorStop(0.45, lerpHex("#4d8cbc", "#5a6d80", nuke * 0.5));
    grd.addColorStop(0.72, lerpHex("#f0c27a", "#d9a56a", nuke * 0.3));
    grd.addColorStop(1, lerpHex("#c9894a", "#8d5a38", nuke * 0.2));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    // sun
    const sx = W * 0.78;
    const sy = H * 0.18;
    const sun = g.createRadialGradient(sx, sy, 4, sx, sy, 90);
    sun.addColorStop(0, "rgba(255,236,170,0.95)");
    sun.addColorStop(0.35, "rgba(255,196,110,0.35)");
    sun.addColorStop(1, "rgba(255,180,80,0)");
    g.fillStyle = sun;
    g.beginPath();
    g.arc(sx, sy, 90, 0, TWO_PI);
    g.fill();
    g.fillStyle = "#fff3c4";
    g.beginPath();
    g.arc(sx, sy, 16, 0, TWO_PI);
    g.fill();
  }

  function lerpHex(a, b, t) {
    const pa = hex(a);
    const pb = hex(b);
    const r = (pa.r + (pb.r - pa.r) * t) | 0;
    const g = (pa.g + (pb.g - pa.g) * t) | 0;
    const bl = (pa.b + (pb.b - pa.b) * t) | 0;
    return "rgb(" + r + "," + g + "," + bl + ")";
  }
  function hex(h) {
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function mountains(g) {
    const base = waterY - 20;
    // far ridge — hood-ish
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 16) {
      const wx0 = x + cam.x * 0.08;
      const y =
        base - 110 - fbm(wx0 * 0.004 + 20, 5) * 130 - Math.max(0, 80 - Math.abs(wx0 * 0.02 + 40) % 400 - 200) * 0.15;
      // peak
      const peak = Math.pow(Math.max(0, 1 - Math.abs(((wx0 * 0.015 + 12) % 50) - 25) / 12), 2) * 70;
      g.lineTo(x, y - peak);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = "#2d4a66";
    g.fill();

    // snow cap suggestion
    g.save();
    g.globalAlpha = 0.35;
    g.fillStyle = "#e9f3ff";
    g.beginPath();
    const hoodX = wrap(-cam.x * 0.08 + W * 0.62, -100, W + 200);
    g.moveTo(hoodX - 36, base - 168);
    g.lineTo(hoodX, base - 228);
    g.lineTo(hoodX + 34, base - 170);
    g.fill();
    g.restore();

    // mid basalt cliffs
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 24; x += 12) {
      const wx0 = x + cam.x * 0.22;
      const y = base - 28 - fbm(wx0 * 0.006 + 3, 4) * 90 - (noise1(wx0 * 0.03) > 0.72 ? 28 : 0);
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = "#3a332c";
    g.fill();

    // grass rim
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 10) {
      const wx0 = x + cam.x * 0.38;
      const y = base + 8 - fbm(wx0 * 0.01 + 9, 3) * 36;
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = "#3d4a28";
    g.fill();

    // launch / hook landmarks
    drawLandmark(g, 80, "EVENT SITE");
    drawLandmark(g, 420, "THE HOOK");
    drawLandmark(g, 860, "SWELL CITY");
    drawLandmark(g, 1400, "LORDS");
  }

  function drawLandmark(g, worldM, name) {
    const x = wx(worldM);
    if (x < -200 || x > W + 200) return;
    const y = waterY + 10 - 18;
    g.save();
    g.translate(x, y);
    // spit of land
    g.fillStyle = "#c2a06a";
    g.beginPath();
    g.moveTo(-90, 30);
    g.quadraticCurveTo(20, -18, 130, 36);
    g.lineTo(-90, 36);
    g.fill();
    g.fillStyle = "#5a6b32";
    g.beginPath();
    g.moveTo(-70, 24);
    g.quadraticCurveTo(10, -8, 90, 28);
    g.fill();
    // little trees
    g.fillStyle = "#2a3a1c";
    for (let i = 0; i < 5; i++) {
      const tx = -40 + i * 22 + Math.sin(worldM + i) * 4;
      g.fillRect(tx, -6, 4, 16);
      g.beginPath();
      g.arc(tx + 2, -8, 8, 0, TWO_PI);
      g.fill();
    }
    g.fillStyle = "rgba(255,236,200,0.55)";
    g.font = "600 11px Trebuchet MS, Segoe UI, sans-serif";
    g.textAlign = "center";
    g.fillText(name, 10, -22);
    g.restore();
  }

  function water(g) {
    const chop = clamp(wind.knots / 28, 0.2, 1.2);
    const grd = g.createLinearGradient(0, waterY - 30, 0, H);
    grd.addColorStop(0, "#1a5c78");
    grd.addColorStop(0.18, "#14506c");
    grd.addColorStop(0.55, "#0c3550");
    grd.addColorStop(1, "#071e30");
    g.fillStyle = grd;
    g.fillRect(0, waterY - 16, W, H - waterY + 16);

    // wave bands
    for (let layer = 0; layer < 4; layer++) {
      const z = 0.45 + layer * 0.2;
      g.beginPath();
      const amp = (5 + layer * 3) * chop;
      const y0 = waterY - 8 + layer * 16;
      g.moveTo(0, H);
      g.lineTo(0, y0);
      for (let x = 0; x <= W; x += 8) {
        const wx0 = x + cam.x * (0.4 + layer * 0.15);
        const y = y0 + Math.sin(wx0 * 0.03 + time * (2 + layer) + layer) * amp + Math.sin(wx0 * 0.01 + time) * amp * 0.4;
        g.lineTo(x, y);
      }
      g.lineTo(W, H);
      g.closePath();
      g.fillStyle = layer === 0 ? "rgba(180,230,255,0.16)" : "rgba(10, 40, 60, 0." + (18 + layer * 8) + ")";
      if (layer === 0) g.fillStyle = "rgba(200,236,255,0.14)";
      else if (layer === 1) g.fillStyle = "rgba(20,70,95,0.35)";
      else if (layer === 2) g.fillStyle = "rgba(12,48,70,0.4)";
      else g.fillStyle = "rgba(8,30,48,0.45)";
      g.fill();
    }

    // sparkles / whitecaps
    g.fillStyle = "rgba(230,250,255,0.55)";
    const n = (40 * chop) | 0;
    for (let i = 0; i < n; i++) {
      const seed = i * 97.13;
      const x = wrap((noise1(seed) * W * 3) - cam.x * 0.5 + time * (20 + (i % 7) * 8), 0, W);
      const y = waterY + 8 + (noise1(seed + 2) * (H - waterY - 20));
      if (y > H - 8) continue;
      g.globalAlpha = 0.25 + noise1(seed + time) * 0.5;
      g.fillRect(x, y, 3 + chop * 2, 1.2);
    }
    g.globalAlpha = 1;

    // surface line
    g.strokeStyle = "rgba(210,240,255,0.35)";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 10) {
      const y = waterY + Math.sin((x + cam.x) * 0.04 + time * 3) * 3 * chop;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  function windStreaks(g) {
    const n = 18 + (wind.knots * 0.6) | 0;
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const seed = i * 17.7;
      const y = ((noise1(seed) * H * 0.55 + time * 4) % (H * 0.55));
      const x = wrap(W - ((time * (80 + wind.knots * 6) + seed * 40) % (W + 120)), -40, W + 40);
      const len = 30 + wind.knots;
      g.globalAlpha = 0.08 + wind.gust * 0.12;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - len, y + 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  function kiteScreenPos() {
    const span = 19;
    const lift = 8 + kite.h * 16;
    return {
      x: rider.x + kite.pos * span,
      y: rider.y + lift,
    };
  }

  function drawLines(g, kx, ky, hx, hy) {
    g.lineWidth = 1.15;
    g.strokeStyle = "rgba(230,240,250,0.55)";
    const spread = 10;
    for (let i = -1; i <= 1; i += 2) {
      g.beginPath();
      g.moveTo(hx + i * 4, hy - 6);
      g.quadraticCurveTo((hx + kx) * 0.5 + i * 8, (hy + ky) * 0.5 + 10, kx + i * spread, ky + 4);
      g.stroke();
    }
    g.strokeStyle = "rgba(255,200,140,0.4)";
    g.beginPath();
    g.moveTo(hx, hy - 8);
    g.lineTo(kx, ky + 6);
    g.stroke();
  }

  function drawKite(g, kx, ky) {
    const bank = kite.vpos * 0.18 + kite.pos * 0.25;
    g.save();
    g.translate(kx, ky);
    g.rotate(bank + (bladder.blown ? Math.sin(bladder.t * 22) * 0.4 : 0));
    let s = 1 + clamp(kite.pull * 0.15, 0, 0.25);
    if (bladder.blown) {
      const sag = clamp(1 - bladder.t * 1.15, 0.32, 1);
      g.scale(s * sag, s * clamp(1 - bladder.t * 1.7, 0.16, 1));
    } else {
      g.scale(s, s);
    }

    // canopy
    g.beginPath();
    g.moveTo(-46, 6);
    g.quadraticCurveTo(-20, bladder.blown ? 8 : -22, 0, bladder.blown ? 10 : -26);
    g.quadraticCurveTo(20, bladder.blown ? 8 : -22, 46, 6);
    g.quadraticCurveTo(16, bladder.blown ? 16 : 2, 0, bladder.blown ? 18 : 4);
    g.quadraticCurveTo(-16, bladder.blown ? 16 : 2, -46, 6);
    const kg = g.createLinearGradient(-46, -26, 46, 8);
    if (bladder.blown) {
      kg.addColorStop(0, "#b86a3a");
      kg.addColorStop(0.5, "#c9a06a");
      kg.addColorStop(1, "#3a7a72");
    } else {
      kg.addColorStop(0, "#ff8a2b");
      kg.addColorStop(0.45, "#ffce6a");
      kg.addColorStop(0.55, "#fff6d8");
      kg.addColorStop(1, "#2ec4b6");
    }
    g.fillStyle = kg;
    g.fill();
    g.strokeStyle = "rgba(40,20,10,0.35)";
    g.lineWidth = 1;
    g.stroke();

    // struts
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.moveTo(-28, -4);
    g.lineTo(0, 4);
    g.lineTo(28, -4);
    g.moveTo(0, -24);
    g.lineTo(0, 4);
    g.stroke();

    if (kite.torn) {
      g.strokeStyle = "#1a120c";
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-10, -18);
      g.lineTo(-3, -5);
      g.lineTo(7, -14);
      g.lineTo(12, 1);
      g.stroke();
      g.fillStyle = "rgba(18,10,6,0.5)";
      g.beginPath();
      g.moveTo(-8, -16);
      g.lineTo(1, -3);
      g.lineTo(9, -12);
      g.closePath();
      g.fill();
      g.fillStyle = "#c45a22";
      g.beginPath();
      g.moveTo(10, -8);
      g.quadraticCurveTo(18, -2 + Math.sin(time * 16) * 3, 22, 6);
      g.quadraticCurveTo(14, 2, 8, -2);
      g.fill();
    }

    // tips
    g.fillStyle = "#1b2430";
    g.beginPath();
    g.arc(-46, 6, 2.2, 0, TWO_PI);
    g.arc(46, 6, 2.2, 0, TWO_PI);
    g.fill();

    g.restore();
  }

  function drawRider(g, rx, ry) {
    g.save();
    g.translate(rx, ry);

    if (state === STATE.WIPE) {
      g.rotate(wipe.t * rider.spinV * 0.4 + rider.spin);
      g.translate(0, Math.sin(wipe.t * 8) * 4);
    } else {
      g.rotate(rider.boardAngle * 0.35 + (rider.onWater ? 0 : rider.spin * 0.15));
    }

    const grab = (keys["g"] || keys["shift"] || buttons.grab) && !rider.onWater;

    // board
    g.save();
    g.rotate(rider.onWater ? -0.08 - rider.edge * 0.12 : rider.spin);
    g.fillStyle = "#e8fbff";
    g.beginPath();
    g.moveTo(-28, 10);
    g.quadraticCurveTo(-4, 6, 30, 9);
    g.quadraticCurveTo(4, 16, -28, 12);
    g.closePath();
    g.fill();
    g.fillStyle = "#1bb8a8";
    g.fillRect(-6, 8, 16, 3);
    g.restore();

    // body
    g.save();
    g.rotate(rider.lean * 0.4 + (grab ? -0.9 : -0.25));
    // legs
    g.strokeStyle = "#1a1f28";
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, 4);
    g.lineTo(-8, 12);
    g.moveTo(0, 4);
    g.lineTo(10, 12);
    g.stroke();
    // torso
    g.fillStyle = "#1c2430";
    g.beginPath();
    g.ellipse(0, -6, 6.5, 10, 0, 0, TWO_PI);
    g.fill();
    // harness
    g.strokeStyle = "#e27a2a";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, -3, 6, 0.2, Math.PI - 0.2);
    g.stroke();
    // arm
    g.strokeStyle = "#d7b39a";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(2, -10);
    g.lineTo(grab ? 8 : 14, grab ? -22 : -18);
    g.stroke();
    // head
    g.fillStyle = "#e8c2a4";
    g.beginPath();
    g.arc(1, -18, 5, 0, TWO_PI);
    g.fill();
    g.fillStyle = "#2b333e";
    g.beginPath();
    g.arc(1, -19, 5.2, Math.PI, TWO_PI);
    g.fill();
    g.restore();

    g.restore();
  }

  function drawSpray(g) {
    for (const p of spray) {
      const a = 1 - p.age / p.life;
      g.fillStyle = p.col
        ? p.col + (a * 0.75).toFixed(3) + ")"
        : "rgba(220,240,255," + (a * 0.7).toFixed(3) + ")";
      const x = wx(p.x);
      const y = wy(p.y);
      g.beginPath();
      g.arc(x, y, p.r * a, 0, TWO_PI);
      g.fill();
    }
  }

  function drawPopups(g) {
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of pops) {
      const a = clamp(1 - p.age / p.life, 0, 1);
      g.save();
      g.globalAlpha = a;
      g.font = (p.big ? "800 22px" : "700 15px") + " Trebuchet MS, Segoe UI, sans-serif";
      g.fillStyle = p.color;
      g.shadowColor = "rgba(0,0,0,0.45)";
      g.shadowBlur = 8;
      g.fillText(p.text, wx(p.x), wy(0) - 70 + p.y);
      g.restore();
    }
  }

  function hud(g) {
    const pad = 16;
    g.save();
    g.textBaseline = "top";
    g.font = "800 18px Trebuchet MS, Segoe UI, sans-serif";
    g.fillStyle = "#fff4d2";
    g.textAlign = "left";
    g.fillText("AIRTIME KITE", pad, pad);
    g.font = "600 12px Trebuchet MS, Segoe UI, sans-serif";
    g.fillStyle = "rgba(255,236,200,0.65)";
    g.fillText("Hood River  ·  the Gorge", pad, pad + 20);

    // score
    g.textAlign = "right";
    g.font = "800 28px Trebuchet MS, Segoe UI, sans-serif";
    g.fillStyle = "#ffffff";
    g.fillText("" + (run.score | 0), W - pad, pad);
    g.font = "600 11px Trebuchet MS, Segoe UI, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillText("SCORE", W - pad, pad + 30);
    if (best) {
      g.fillStyle = "rgba(255,210,120,0.7)";
      g.fillText("BEST " + best.score, W - pad, pad + 44);
    }

    // meters
    const mx = pad;
    const my = pad + 48;
    meter(g, mx, my, 150, "WIND  " + Math.round(wind.knots) + " kt  W", clamp((wind.knots - 6) / 26, 0, 1), wind.knots > 24 ? "#ff7a3c" : wind.knots < 12 ? "#7ecbff" : "#ffe08a");
    meter(g, mx, my + 26, 150, "POWER", clamp(kite.pull, 0, 1.2) / 1.2, kite.pull > 0.85 ? "#ff6a3a" : "#5ee0c0");
    meter(g, mx, my + 52, 150, "EDGE", rider.edge, "#9ad0ff");

    if (rider.yank > 0.2) {
      meter(g, mx, my + 78, 150, "YOINK", clamp(rider.yank, 0, 1), "#ff3355");
    } else if (rider.stall > 0.3) {
      meter(g, mx, my + 78, 150, "STALL", clamp(rider.stall / 1.6, 0, 1), "#6aa0c8");
    }

    // live stats
    g.textAlign = "left";
    g.font = "600 12px Trebuchet MS, Segoe UI, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.75)";
    const statsY = H - 22;
    if (!touchMode) {
      g.fillText(
        Math.round(run.dist) + " m    air " + run.air.toFixed(1) + "s    " + rider.vx.toFixed(0) + " m/s" +
          (run.combo > 1 ? "    combo x" + (1 + run.combo * 0.35).toFixed(1) : ""),
        pad,
        statsY
      );
    } else {
      g.fillText(Math.round(run.dist) + " m   air " + run.air.toFixed(1) + "s", pad, 12);
    }

    g.restore();
  }

  function meter(g, x, y, w, label, t, col) {
    g.font = "600 10px Trebuchet MS, Segoe UI, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.textAlign = "left";
    g.fillText(label, x, y);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(x, y + 13, w, 6);
    g.fillStyle = col;
    g.fillRect(x, y + 13, w * clamp(t, 0, 1), 6);
  }

  function drawTouch(g) {
    if (state === STATE.TITLE) return;
    if (!touchMode && state === STATE.PLAY) {
      // still draw faint on narrow screens
      if (W > 900) return;
    }
    const a = touchMode ? 1 : 0.35;
    g.save();
    g.globalAlpha = a;

    // joystick
    g.strokeStyle = "rgba(255,255,255,0.4)";
    g.fillStyle = "rgba(8,16,24,0.28)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(layout.joy.x, layout.joy.y, layout.joy.r, 0, TWO_PI);
    g.fill();
    g.stroke();
    g.font = "600 11px Trebuchet MS, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.textAlign = "center";
    g.fillText("KITE", layout.joy.x, layout.joy.y + layout.joy.r + 12);
    const jx = joy.active ? joy.px : layout.joy.x;
    const jy = joy.active ? joy.py : layout.joy.y;
    g.beginPath();
    g.fillStyle = joy.active ? "rgba(255,200,110,0.85)" : "rgba(255,255,255,0.35)";
    g.arc(jx, jy, 22, 0, TWO_PI);
    g.fill();

    btn(g, layout.pop, "POP", buttons.pop, "#ff9a3c");
    btn(g, layout.grab, "GRAB", buttons.grab, "#7dffc3");
    btn(g, layout.edge, "EDGE", buttons.edge, "#8ec6ff");
    g.restore();
  }

  function btn(g, b, label, on, col) {
    g.beginPath();
    g.fillStyle = on ? col : "rgba(8,16,24,0.32)";
    g.strokeStyle = on ? "#fff" : "rgba(255,255,255,0.4)";
    g.lineWidth = 2;
    g.arc(b.x, b.y, b.r, 0, TWO_PI);
    g.fill();
    g.stroke();
    g.fillStyle = on ? "#1a1208" : "rgba(255,255,255,0.75)";
    g.font = "800 13px Trebuchet MS, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, b.x, b.y);
  }

  function titleScreen(g) {
    // animated idle kite
    const kx = W * 0.62 + Math.sin(time * 0.8) * 40;
    const ky = H * 0.28 + Math.cos(time * 1.1) * 18;
    const hx = W * 0.46;
    const hy = waterY - 18;
    drawLines(g, kx, ky, hx, hy);
    const oldPos = kite.pos;
    kite.pos = Math.sin(time * 0.8) * 0.3;
    kite.vpos = Math.cos(time * 0.8);
    drawKite(g, kx, ky);
    kite.pos = oldPos;
    rider.lean = 0.15;
    rider.edge = 0.4;
    rider.boardAngle = -0.1;
    drawRider(g, hx, hy);

    g.save();
    g.textAlign = "center";
    g.fillStyle = "#fff6d8";
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = 16;
    g.font = "800 " + clamp(W * 0.08, 42, 84) + "px Trebuchet MS, Avenir Next, Segoe UI, sans-serif";
    g.fillText("AIRTIME KITE", W * 0.5, H * 0.16);
    g.shadowBlur = 0;
    g.font = "600 16px Trebuchet MS, sans-serif";
    g.fillStyle = "rgba(255,226,170,0.85)";
    g.fillText("Hood River. Big air. We fix the rest.", W * 0.5, H * 0.16 + clamp(W * 0.08, 42, 84) * 0.55);

    const boxW = Math.min(520, W - 48);
    const boxX = (W - boxW) / 2;
    const boxY = H * 0.68;
    g.fillStyle = "rgba(6,16,24,0.55)";
    roundRect(g, boxX, boxY, boxW, Math.min(168, H * 0.26), 12);
    g.fill();
    g.textAlign = "left";
    g.font = "600 13px Trebuchet MS, sans-serif";
    g.fillStyle = "rgba(255,245,220,0.9)";
    const lines = [
      "← →  or  A D     steer the kite",
      "↑ ↓  or  W S     kite high  /  power zone",
      "hold S or ↓      edge the board  (or EDGE)",
      "space  /  POP    jump when you're loaded",
      "in the air       hold GRAB · send the kite in a circle for a loop",
    ];
    let y = boxY + 18;
    for (const line of lines) {
      g.fillText(line, boxX + 22, y);
      y += 22;
    }

    g.textAlign = "center";
    g.font = "800 18px Trebuchet MS, sans-serif";
    const pulse = 0.65 + Math.sin(time * 4) * 0.35;
    g.fillStyle = "rgba(255,210,110," + pulse.toFixed(2) + ")";
    g.fillText("tap  ·  click  ·  space     to drop in", W * 0.5, boxY - 28);

    if (best) {
      g.font = "600 13px Trebuchet MS, sans-serif";
      g.fillStyle = "rgba(255,220,140,0.8)";
      g.fillText("best run  " + best.score + "   ·   " + Math.round(best.dist) + " m   ·   " + (best.air || 0).toFixed(1) + "s air", W * 0.5, boxY - 8);
    }
    g.restore();
  }

  function drawBrogan(g, x, y) {
    g.save();
    g.translate(x, y);
    g.fillStyle = "#3a2a1c";
    g.fillRect(-72, 52, 144, 14);
    g.fillStyle = "#c4a06a";
    g.fillRect(-76, 46, 152, 9);
    g.fillStyle = "#2a4a5c";
    g.beginPath();
    g.ellipse(0, 30, 22, 26, 0, 0, TWO_PI);
    g.fill();
    g.fillStyle = "#d27a2c";
    g.fillRect(-16, 14, 32, 28);
    g.fillStyle = "#fff6d8";
    g.fillRect(6, 20, 24, 11);
    g.fillStyle = "#1a2430";
    g.font = "700 7px Trebuchet MS, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("BROGAN", 18, 26);
    g.fillStyle = "#e0b090";
    g.beginPath();
    g.arc(0, -4, 16, 0, TWO_PI);
    g.fill();
    g.fillStyle = "#3b2a22";
    g.beginPath();
    g.arc(0, -8, 16, Math.PI, TWO_PI);
    g.fill();
    g.fillStyle = "#1a1a1a";
    g.beginPath();
    g.arc(-5, -6, 1.7, 0, TWO_PI);
    g.arc(5, -6, 1.7, 0, TWO_PI);
    g.fill();
    g.strokeStyle = "#5a3020";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, 6, 0.15, Math.PI - 0.15);
    g.stroke();
    g.save();
    g.rotate(0.16);
    g.fillStyle = "#f0e6c8";
    g.fillRect(20, 10, 18, 24);
    g.fillStyle = "#4a5560";
    g.fillRect(22, 14, 14, 2);
    g.fillRect(22, 18, 12, 2);
    g.fillRect(22, 22, 13, 2);
    g.restore();
    g.restore();
  }

  function kiteGlyph(g, x, y, s, rot, c0, c1) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(s, s);
    g.beginPath();
    g.moveTo(-46, 6);
    g.quadraticCurveTo(-20, -22, 0, -26);
    g.quadraticCurveTo(20, -22, 46, 6);
    g.quadraticCurveTo(16, 2, 0, 4);
    g.quadraticCurveTo(-16, 2, -46, 6);
    const kg = g.createLinearGradient(-46, -26, 46, 8);
    kg.addColorStop(0, c0);
    kg.addColorStop(0.5, "#fff2c4");
    kg.addColorStop(1, c1);
    g.fillStyle = kg;
    g.fill();
    g.strokeStyle = "rgba(30,18,10,0.35)";
    g.lineWidth = 1.2;
    g.stroke();
    g.restore();
  }

  function drawDancingBrogan(g, cx, cy, t, scale) {
    const bounce = Math.abs(Math.sin(t * 11)) * 16;
    const sway = Math.sin(t * 8.2) * 0.16;
    const step = Math.sin(t * 11);
    const arm = Math.sin(t * 10.5);
    const s = scale == null ? 1 : scale;

    g.save();
    g.translate(cx, cy);
    g.scale(s, s);
    g.fillStyle = "rgba(20,12,8,0.28)";
    g.beginPath();
    g.ellipse(0, 86, 42 + Math.abs(step) * 6, 10, 0, 0, TWO_PI);
    g.fill();

    g.translate(step * 10, -bounce);
    g.rotate(sway);

    // legs
    g.strokeStyle = "#2a241c";
    g.lineWidth = 9;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-4, 38);
    g.lineTo(-16 - step * 10, 78);
    g.moveTo(6, 38);
    g.lineTo(18 + step * 10, 78);
    g.stroke();
    g.fillStyle = "#c45a22";
    g.beginPath();
    g.ellipse(-16 - step * 10, 82, 11, 5, -0.2 + step * 0.15, 0, TWO_PI);
    g.ellipse(18 + step * 10, 82, 11, 5, 0.2 - step * 0.15, 0, TWO_PI);
    g.fill();

    // hoodie body
    g.fillStyle = "#1d4d62";
    g.beginPath();
    g.moveTo(-28, 8);
    g.quadraticCurveTo(-34, 36, -20, 50);
    g.lineTo(20, 50);
    g.quadraticCurveTo(34, 36, 28, 8);
    g.quadraticCurveTo(0, 16, -28, 8);
    g.fill();
    g.fillStyle = "#e27a2a";
    g.fillRect(-18, 18, 36, 10);
    g.fillStyle = "#fff6d8";
    g.font = "800 8px Trebuchet MS, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("AIRTIME", 0, 23);

    // hoodie pocket
    g.strokeStyle = "rgba(255,236,200,0.25)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-12, 36);
    g.lineTo(0, 44);
    g.lineTo(12, 36);
    g.stroke();

    // arms
    g.strokeStyle = "#1d4d62";
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(-22, 16);
    g.lineTo(-40, 8 + arm * 22);
    g.lineTo(-52, -6 + arm * 16);
    g.moveTo(22, 16);
    g.lineTo(38, 4 - arm * 22);
    g.lineTo(50, -18 - arm * 12);
    g.stroke();
    g.fillStyle = "#e8b898";
    g.beginPath();
    g.arc(-54, -8 + arm * 16, 7, 0, TWO_PI);
    g.arc(52, -20 - arm * 12, 7, 0, TWO_PI);
    g.fill();

    // head
    g.save();
    g.translate(0, -2 + Math.sin(t * 12) * 2);
    g.rotate(-sway * 0.4);
    // hood
    g.fillStyle = "#163848";
    g.beginPath();
    g.ellipse(0, -28, 26, 24, 0, Math.PI, TWO_PI);
    g.fill();
    g.beginPath();
    g.ellipse(0, -18, 22, 20, 0, 0, TWO_PI);
    g.fill();
    // face
    g.fillStyle = "#e8b898";
    g.beginPath();
    g.ellipse(0, -16, 17, 16, 0, 0, TWO_PI);
    g.fill();
    // hair
    g.fillStyle = "#3a2418";
    g.beginPath();
    g.ellipse(0, -26, 16, 9, 0, Math.PI, TWO_PI);
    g.fill();
    g.beginPath();
    g.ellipse(-12, -22, 5, 6, -0.4, 0, TWO_PI);
    g.fill();
    // eyes
    g.fillStyle = "#1a1410";
    g.beginPath();
    g.ellipse(-6, -18, 2.1, 2.4, 0, 0, TWO_PI);
    g.ellipse(6, -18, 2.1, 2.4, 0, 0, TWO_PI);
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(-5.2, -19, 0.7, 0, TWO_PI);
    g.arc(6.8, -19, 0.7, 0, TWO_PI);
    g.fill();
    // grin
    g.strokeStyle = "#8a3a28";
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, -10, 8, 0.15, Math.PI - 0.15);
    g.stroke();
    g.fillStyle = "#fff6e8";
    g.beginPath();
    g.moveTo(-5, -11);
    g.quadraticCurveTo(0, -6, 5, -11);
    g.quadraticCurveTo(0, -8.5, -5, -11);
    g.fill();
    // hoodie strings
    g.strokeStyle = "#e8d2a0";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-7, -2);
    g.lineTo(-10 + Math.sin(t * 9) * 3, 16);
    g.moveTo(7, -2);
    g.lineTo(11 + Math.cos(t * 9) * 3, 16);
    g.stroke();
    g.restore();

    g.restore();
  }

  function drawShopDance(g) {
    const t = shopDance.t;
    const fade = clamp(t * 4, 0, 1);
    g.save();
    g.globalAlpha = fade;

    g.fillStyle = "rgba(6,10,14,0.78)";
    g.fillRect(0, 0, W, H);

    const shopW = Math.min(W * 0.94, 780);
    const shopH = Math.min(H * 0.9, 580);
    const sx = (W - shopW) / 2;
    const sy = (H - shopH) / 2;

    // shop room
    const wall = g.createLinearGradient(sx, sy, sx, sy + shopH);
    wall.addColorStop(0, "#6b3d28");
    wall.addColorStop(0.55, "#8a5340");
    wall.addColorStop(1, "#5a3426");
    g.fillStyle = wall;
    roundRect(g, sx, sy, shopW, shopH, 16);
    g.fill();

    // back wall panel
    g.fillStyle = "#c9a06a";
    g.fillRect(sx + 18, sy + 18, shopW - 36, shopH * 0.58);

    // brick suggestion
    g.strokeStyle = "rgba(90,50,32,0.18)";
    g.lineWidth = 1;
    for (let y = sy + 28; y < sy + shopH * 0.55; y += 16) {
      g.beginPath();
      g.moveTo(sx + 22, y);
      g.lineTo(sx + shopW - 22, y);
      g.stroke();
    }

    // window — Cascade Ave
    const wx0 = sx + shopW - 168;
    const wy0 = sy + 36;
    g.fillStyle = "#2a5070";
    g.fillRect(wx0, wy0, 128, 86);
    const skyG = g.createLinearGradient(wx0, wy0, wx0, wy0 + 86);
    skyG.addColorStop(0, "#7eb3d8");
    skyG.addColorStop(1, "#f0c27a");
    g.fillStyle = skyG;
    g.fillRect(wx0 + 6, wy0 + 6, 116, 74);
    g.fillStyle = "#3d4a28";
    g.fillRect(wx0 + 6, wy0 + 58, 116, 22);
    g.fillStyle = "#c2a06a";
    g.fillRect(wx0 + 6, wy0 + 68, 40, 12);
    g.strokeStyle = "#3a2418";
    g.lineWidth = 4;
    g.strokeRect(wx0, wy0, 128, 86);
    g.beginPath();
    g.moveTo(wx0 + 64, wy0);
    g.lineTo(wx0 + 64, wy0 + 86);
    g.moveTo(wx0, wy0 + 43);
    g.lineTo(wx0 + 128, wy0 + 43);
    g.stroke();
    g.fillStyle = "rgba(255,236,200,0.85)";
    g.font = "700 10px Trebuchet MS, sans-serif";
    g.textAlign = "center";
    g.fillText("CASCADE AVE", wx0 + 64, wy0 + 102);

    // AIRTIME shop sign
    g.fillStyle = "#1a2430";
    roundRect(g, sx + 36, sy + 32, 210, 46, 6);
    g.fill();
    g.fillStyle = "#e27a2a";
    g.fillRect(sx + 36, sy + 32, 8, 46);
    g.fillStyle = "#fff4d2";
    g.font = "800 22px Trebuchet MS, sans-serif";
    g.textAlign = "left";
    g.fillText("AIRTIME KITE", sx + 54, sy + 52);
    g.font = "600 10px Trebuchet MS, sans-serif";
    g.fillStyle = "rgba(255,226,170,0.75)";
    g.fillText("1538 Cascade  ·  Hood River", sx + 54, sy + 70);

    // kites on the wall
    kiteGlyph(g, sx + 90, sy + 130, 0.55, -0.18, "#ff8a2b", "#2ec4b6");
    kiteGlyph(g, sx + 170, sy + 118, 0.42, 0.22, "#ff5ad5", "#7ecbff");
    kiteGlyph(g, sx + 250, sy + 136, 0.48, -0.08, "#ffe08a", "#1bb8a8");
    kiteGlyph(g, sx + shopW * 0.48, sy + 124, 0.38, 0.3, "#ff7a3c", "#4d8cbc");

    // workbench
    const bx = sx + 28;
    const by = sy + shopH * 0.62;
    g.fillStyle = "#6a4228";
    g.fillRect(bx, by, shopW - 56, 18);
    g.fillStyle = "#3a2418";
    g.fillRect(bx + 10, by + 18, 14, shopH * 0.22);
    g.fillRect(bx + shopW - 86, by + 18, 14, shopH * 0.22);
    g.fillStyle = "#c4a06a";
    g.fillRect(bx - 4, by - 6, shopW - 48, 8);

    // sewing machine
    const mx = sx + shopW - 150;
    const my = by - 4;
    g.fillStyle = "#2a3038";
    g.fillRect(mx, my - 8, 70, 10);
    g.fillRect(mx + 40, my - 36, 16, 30);
    g.fillRect(mx + 28, my - 42, 40, 10);
    g.fillStyle = "#e27a2a";
    g.fillRect(mx + 52, my - 46, 4, 8);
    g.strokeStyle = "rgba(255,210,120,0.7)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mx + 54, my - 46);
    g.lineTo(mx + 20 + Math.sin(t * 14) * 8, my - 20);
    g.stroke();
    g.fillStyle = "#fff6d8";
    g.font = "700 9px Trebuchet MS, sans-serif";
    g.textAlign = "center";
    g.fillText("SEWING", mx + 35, my + 8);

    // spare kite on bench
    kiteGlyph(g, sx + 80, by - 8, 0.28, 0.6, "#ff8a2b", "#2ec4b6");

    // dancing Brogan
    drawDancingBrogan(g, W * 0.5, sy + shopH * 0.58, t);

    g.textAlign = "center";
    g.font = "800 " + clamp(shopW * 0.045, 20, 34) + "px Trebuchet MS, sans-serif";
    g.fillStyle = "#fff6d8";
    g.fillText("Brogan's on it.", W * 0.5, sy + shopH - 52);
    g.font = "600 14px Trebuchet MS, sans-serif";
    g.fillStyle = "rgba(255,226,170,0.85)";
    if (shopDance.waitTap) {
      const pulse = 0.6 + Math.sin(time * 6) * 0.4;
      g.fillStyle = "rgba(255,210,110," + pulse.toFixed(2) + ")";
      g.fillText("tap to open airtimekite.com", W * 0.5, sy + shopH - 28);
    } else {
      g.fillText("1538 Cascade Ave  ·  then sending you over", W * 0.5, sy + shopH - 28);
    }

    g.restore();
  }

  function syncRepairLink(label) {
    if (!repairLink) return;
    const b = layout.repair;
    if (!b.visible || state !== STATE.WIPE) {
      repairLink.style.display = "none";
      return;
    }
    repairLink.textContent = label || "Take it to Airtime";
    repairLink.style.display = "block";
    repairLink.style.left = b.x + "px";
    repairLink.style.top = b.y + "px";
    repairLink.style.width = b.w + "px";
    repairLink.style.height = b.h + "px";
  }

  function drawRepairButton(g, label, y) {
    const bw = Math.min(320, W - 48);
    const bh = 46;
    const bx = (W - bw) / 2;
    const by = y;
    layout.repair.x = bx;
    layout.repair.y = by;
    layout.repair.w = bw;
    layout.repair.h = bh;
    layout.repair.visible = wipe.t > 0.2;
    const pulse = 0.75 + Math.sin(time * 4) * 0.25;
    g.fillStyle = "rgba(226,122,42," + pulse.toFixed(2) + ")";
    roundRect(g, bx, by, bw, bh, 10);
    g.fill();
    g.strokeStyle = "rgba(255,236,200,0.85)";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#1a1208";
    g.font = "800 17px Trebuchet MS, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, W * 0.5, by + bh * 0.5);
    syncRepairLink(label);
  }

  function drawShopQuoteCard(g, quote, why, t, cardY) {
    const padX = 16;
    const padY = 14;
    const gap = 8;
    const cardW = Math.min(560, W - 32);
    const cardX = (W - cardW) / 2;
    const broganColW = clamp(Math.round(cardW * 0.34), 112, 140);
    const tx = cardX + broganColW;
    const textW = Math.max(120, cardW - broganColW - padX);
    const note = quote.note || "";
    const shopAddress = "1538 Cascade Ave  ·  Hood River, OR";
    const partLine = why === "bird" ? quote.part : ("on the " + quote.part);
    const btnLabel = why === "bladder" ? "Send it to Airtime"
      : why === "bird" ? "Book a repair"
      : "Take it to Airtime";

    const stack = [
      { text: "Brogan's on it.", font: "800 13px Trebuchet MS, sans-serif", fill: "#fff6d8", lh: 16 },
      { text: "$" + quote.price, font: "800 28px Trebuchet MS, sans-serif", fill: "#fff6d8", lh: 30 },
      { text: partLine, font: "700 14px Trebuchet MS, sans-serif", fill: "#ffe08a", lh: 18 },
      { text: note, font: "600 13px Trebuchet MS, sans-serif", fill: "rgba(255,236,200,0.88)", lh: 17 },
      { text: shopAddress, font: "600 11px Trebuchet MS, sans-serif", fill: "rgba(176,188,200,0.7)", lh: 15, address: true },
    ];

    const measured = [];
    let stackH = 0;
    for (let i = 0; i < stack.length; i++) {
      const row = stack[i];
      g.font = row.font;
      const lines = row.address ? wrapAddress(g, row.text, textW) : wrapLines(g, row.text, textW);
      if (!lines.length) continue;
      if (measured.length) stackH += gap;
      measured.push({ font: row.font, fill: row.fill, lh: row.lh, lines: lines });
      stackH += lines.length * row.lh;
    }

    const cardH = padY + stackH + padY;
    const btnH = 46;
    const overflow = cardY + cardH + 14 + btnH + 40 - H;
    if (overflow > 0) cardY = Math.max(8, cardY - overflow);

    g.fillStyle = "rgba(10,18,26,0.82)";
    roundRect(g, cardX, cardY, cardW, cardH, 12);
    g.fill();
    g.strokeStyle = "rgba(255,200,140,0.45)";
    g.lineWidth = 1.5;
    g.stroke();

    const broganScale = clamp(broganColW / 168, 0.48, 0.72);
    g.save();
    g.beginPath();
    g.rect(cardX + 4, cardY + 4, broganColW - 8, cardH - 8);
    g.clip();
    drawDancingBrogan(g, cardX + broganColW * 0.48, cardY + cardH * 0.52, t, broganScale);
    g.restore();

    g.textAlign = "left";
    g.textBaseline = "top";
    let y = cardY + padY;
    for (let i = 0; i < measured.length; i++) {
      const row = measured[i];
      g.font = row.font;
      g.fillStyle = row.fill;
      for (let j = 0; j < row.lines.length; j++) {
        g.fillText(row.lines[j], tx, y);
        y += row.lh;
      }
      if (i < measured.length - 1) y += gap;
    }

    drawRepairButton(g, btnLabel, cardY + cardH + 14);
  }

  function wipeScreen(g) {
    const shopWipe = isRepairWipe(wipe.why) && !!wipe.quote;
    const bladderWipe = wipe.why === "bladder";
    g.fillStyle = "rgba(6,10,16," + clamp(wipe.t * 0.55, 0, 0.52) + ")";
    g.fillRect(0, 0, W, H);
    g.save();
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = bladderWipe ? "#ffb080" : "#ffd28a";
    g.font = "800 " + clamp(W * 0.05, 26, 48) + "px Trebuchet MS, sans-serif";
    const top = H * (shopWipe ? 0.12 : 0.22);
    g.fillText(wipe.tag, W * 0.5, top);
    if (wipe.final) {
      g.font = "700 32px Trebuchet MS, sans-serif";
      g.fillStyle = "#ffffff";
      g.fillText("" + wipe.final.score, W * 0.5, top + 42);
      g.font = "600 13px Trebuchet MS, sans-serif";
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.fillText(
        Math.round(wipe.final.dist) + " m    ·    " + wipe.final.air.toFixed(1) + "s air    ·    " +
          run.jumpCount + " jumps    ·    " + run.loops + " loops",
        W * 0.5,
        top + 68
      );
      if (wipe.final.record) {
        g.fillStyle = "#ffe08a";
        g.font = "800 15px Trebuchet MS, sans-serif";
        g.fillText("NEW BEST RUN", W * 0.5, top + 90);
      } else if (best) {
        g.fillStyle = "rgba(255,220,150,0.65)";
        g.fillText("best  " + best.score, W * 0.5, top + 90);
      }
    }

    if (shopWipe && wipe.quote) {
      drawShopQuoteCard(g, wipe.quote, wipe.why, wipe.t, top + 104);
    } else {
      drawRepairButton(g, "Book a repair", H * 0.62);
    }

    const pulse = 0.6 + Math.sin(time * 5) * 0.4;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.font = "800 15px Trebuchet MS, sans-serif";
    g.fillStyle = "rgba(255,210,110," + pulse.toFixed(2) + ")";
    const hintY = layout.repair.visible ? layout.repair.y + layout.repair.h + 28 : H * 0.78;
    g.fillText("space  /  tap    one more", W * 0.5, hintY);
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ---------- frame ----------
  let last = performance.now();
  let fpsE = 60;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    fpsE = lerp(fpsE, 1 / dt, 0.1);
    time += dt;

    const c = controls();

    if (state === STATE.TITLE) {
      stepWind(dt);
      if (startLatched) {
        startLatched = false;
        startPlay();
      }
    } else if (state === STATE.PLAY) {
      runTime += dt;
      stepWind(dt);
      stepKite(dt, c);
      stepRider(dt, c);
      maybeExplode(dt);
      maybeChaos(dt);
      stepBirds(dt);
      stepBarges(dt);
      stepWindsurfers(dt);
      stepCam(dt);
      stepParticles(dt);
      setWindHum(wind.knots, rider.vx);
    } else if (state === STATE.WIPE) {
      wipe.t += dt;
      rider.x += rider.vx * dt * 0.4;
      rider.y = Math.max(-2, rider.y + rider.vy * dt);
      rider.vy -= 16 * dt;
      kite.h = lerp(kite.h, 0.18, 0.02);
      kite.pos += dt * 0.15;
      stepBirds(dt);
      stepBarges(dt);
      stepWindsurfers(dt);
      stepCam(dt);
      stepParticles(dt);
      if (startLatched && wipe.t > 0.35) {
        startLatched = false;
        startPlay();
      }
    }
    startLatched = false;

    // draw
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ox = (Math.random() - 0.5) * shake;
    const oy = (Math.random() - 0.5) * shake;
    ctx.translate(ox, oy);

    sky(ctx);
    windStreaks(ctx);
    mountains(ctx);
    water(ctx);
    drawBarges(ctx);
    drawWindsurfers(ctx);

    if (state === STATE.TITLE) {
      layout.repair.visible = false;
      syncRepairLink();
      titleScreen(ctx);
    } else {
      const kp = kiteScreenPos();
      const rx = wx(rider.x);
      const ry = wy(rider.y);
      const kx = wx(kp.x);
      const ky = wy(kp.y);
      drawLines(ctx, kx, ky, rx, ry - 8);
      drawKite(ctx, kx, ky);
      drawBirds(ctx);
      drawSpray(ctx);
      drawRider(ctx, rx, ry);
      drawPopups(ctx);
      hud(ctx);
      drawTouch(ctx);
      if (state === STATE.WIPE) wipeScreen(ctx);
      else syncRepairLink();
    }

    if (flash > 0.02) {
      ctx.fillStyle = "rgba(255,220,180," + (flash * 0.35).toFixed(3) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
