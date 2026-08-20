// Gorge Kite — Columbia River west-wind session
// Single-file canvas game. No frameworks. No build.

(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  const TWO_PI = Math.PI * 2;
  const BEST_KEY = "gorgeKiteBestV1";

  const STATE = { TITLE: 0, PLAY: 1, WIPE: 2 };

  const PX = 10; // pixels per meter at zoom 1

  // ---------- utilities ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
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

  function onPointerDown(e) {
    touchMode = e.pointerType === "touch" || e.pointerType === "pen";
    const p = canvasPos(e);
    pointer.down = true;
    pointer.x = p.x;
    pointer.y = p.y;
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
  };

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
  };

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
        const pop = 7.2 + rider.vx * 0.28 + pull * 4.2 + sendUp * 2.4 + loft * 2.6;
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
        kite.loopAccum = 0;
        emitSplash(rider.x, 0, 0.45 + pull * 0.4);
        whoosh();
        shake = 4;
      } else if (c.pop && !loaded && rider.vx > 3) {
        // weak hop
        rider.vy = 3.2 + pull * 2;
        rider.onWater = false;
        run.jumpCount += 1;
        run.thisJump.air = 0;
        run.thisJump.grabbed = false;
        run.thisJump.looped = false;
        run.thisJump.passed = false;
        run.thisJump.scoredJump = false;
        emitSpray(8, rider.x, 0, rider.vx, false);
      }

      // spray while planing
      if (rider.vx > 6 && Math.random() < 0.65) {
        emitSpray(rider.edge > 0.5 ? 3 : 1, rider.x - 0.4, 0, -rider.vx, rider.edge > 0.6);
      }
    } else {
      // airborne
      const kiteLift = pull * 6.5 * (0.45 + kite.h * 0.7);
      const loopLift = Math.abs(kite.loopAccum) > 1.2 ? 5.5 * pull : 0;
      rider.vy += (-18 + kiteLift + loopLift) * dt;
      rider.vy = clamp(rider.vy, -22, 28);
      rider.y += rider.vy * dt;
      run.thisJump.air += dt;
      run.air += dt;
      run.maxAir = Math.max(run.maxAir, run.thisJump.air);

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

      if (rider.y <= 0 && rider.vy <= 0) {
        // land
        const hard = -rider.vy;
        rider.y = 0;
        rider.onWater = true;
        emitSplash(rider.x, 0, clamp(hard / 16, 0.25, 1.4));
        shake = hard * 0.45;
        if (hard > 17 && Math.abs(rider.spin % TWO_PI) > 1.2 && !run.thisJump.grabbed) {
          beginWipe("crash");
          return;
        }
        if (hard > 8) {
          addScore(30, "CLEAN", "#d4fff0", false);
        }
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
    const targetY = -rider.y * PX * 0.45;
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
    g.rotate(bank);
    const s = 1 + clamp(kite.pull * 0.15, 0, 0.25);
    g.scale(s, s);

    // canopy
    g.beginPath();
    g.moveTo(-46, 6);
    g.quadraticCurveTo(-20, -22, 0, -26);
    g.quadraticCurveTo(20, -22, 46, 6);
    g.quadraticCurveTo(16, 2, 0, 4);
    g.quadraticCurveTo(-16, 2, -46, 6);
    const kg = g.createLinearGradient(-46, -26, 46, 8);
    kg.addColorStop(0, "#ff8a2b");
    kg.addColorStop(0.45, "#ffce6a");
    kg.addColorStop(0.55, "#fff6d8");
    kg.addColorStop(1, "#2ec4b6");
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
      g.fillStyle = "rgba(220,240,255," + (a * 0.7).toFixed(3) + ")";
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
    g.fillText("GORGE KITE", pad, pad);
    g.font = "600 12px Trebuchet MS, Segoe UI, sans-serif";
    g.fillStyle = "rgba(255,236,200,0.65)";
    g.fillText("west wind session", pad, pad + 20);

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
    g.fillText("GORGE KITE", W * 0.5, H * 0.16);
    g.shadowBlur = 0;
    g.font = "600 16px Trebuchet MS, sans-serif";
    g.fillStyle = "rgba(255,226,170,0.85)";
    g.fillText("West wind. High water. Send it.", W * 0.5, H * 0.16 + clamp(W * 0.08, 42, 84) * 0.55);

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

  function wipeScreen(g) {
    g.fillStyle = "rgba(6,10,16," + clamp(wipe.t * 0.55, 0, 0.48) + ")";
    g.fillRect(0, 0, W, H);
    g.save();
    g.textAlign = "center";
    g.fillStyle = "#ffd28a";
    g.font = "800 " + clamp(W * 0.055, 28, 52) + "px Trebuchet MS, sans-serif";
    g.fillText(wipe.tag, W * 0.5, H * 0.28);
    if (wipe.final) {
      g.font = "700 36px Trebuchet MS, sans-serif";
      g.fillStyle = "#ffffff";
      g.fillText("" + wipe.final.score, W * 0.5, H * 0.28 + 56);
      g.font = "600 14px Trebuchet MS, sans-serif";
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.fillText(Math.round(wipe.final.dist) + " m    ·    " + wipe.final.air.toFixed(1) + "s air    ·    " + run.jumpCount + " jumps    ·    " + run.loops + " loops", W * 0.5, H * 0.28 + 88);
      if (wipe.final.record) {
        g.fillStyle = "#ffe08a";
        g.font = "800 16px Trebuchet MS, sans-serif";
        g.fillText("NEW BEST RUN", W * 0.5, H * 0.28 + 114);
      } else if (best) {
        g.fillStyle = "rgba(255,220,150,0.65)";
        g.fillText("best  " + best.score, W * 0.5, H * 0.28 + 114);
      }
    }
    const pulse = 0.6 + Math.sin(time * 5) * 0.4;
    g.font = "800 16px Trebuchet MS, sans-serif";
    g.fillStyle = "rgba(255,210,110," + pulse.toFixed(2) + ")";
    g.fillText("space  /  tap    one more", W * 0.5, H * 0.72);
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

    if (state === STATE.TITLE) {
      titleScreen(ctx);
    } else {
      const kp = kiteScreenPos();
      const rx = wx(rider.x);
      const ry = wy(rider.y);
      const kx = wx(kp.x);
      const ky = wy(kp.y);
      drawLines(ctx, kx, ky, rx, ry - 8);
      drawKite(ctx, kx, ky);
      drawSpray(ctx);
      drawRider(ctx, rx, ry);
      drawPopups(ctx);
      hud(ctx);
      drawTouch(ctx);
      if (state === STATE.WIPE) wipeScreen(ctx);
    }

    if (flash > 0.02) {
      ctx.fillStyle = "rgba(255,220,180," + (flash * 0.35).toFixed(3) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
