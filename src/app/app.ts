import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

// ── Physics ──────────────────────────────────────────────────
const GRAVITY        = 0.38;
const JUMP_POWER     = 10.5;    // base upward velocity
const HURDLE_HEIGHT  = 54;      // px; horse needs jumpH > this to clear
const HURDLE_HALF    = 22;      // collision zone half-width (world px)
const HORSE_SCREEN_X = 200;     // horse fixed at this screen x
const FRICTION       = 0.992;   // per-frame speed decay base
const WHIP_POWER     = 5.0;     // burst speed from whip
const WHIP_COOLDOWN  = 240;     // frames (~4 s)

// ── Horse definitions ─────────────────────────────────────────
interface HorseDef {
  name: string; color: string; jockeyColor: string;
  desc: string; stars: { spd: number; jmp: number; stm: number; };
  topSpeed: number; accel: number; spring: number; stamina: number;
}
const HORSES: HorseDef[] = [
  { name: 'Thoroughbred', color: '#c0392b', jockeyColor: '#e74c3c',
    desc: 'Blazing speed, average jump',
    stars: { spd: 5, jmp: 2, stm: 3 },
    topSpeed: 13, accel: 2.2, spring: 0.82, stamina: 0.9925 },
  { name: 'Steeplechaser', color: '#27ae60', jockeyColor: '#2ecc71',
    desc: 'Born to jump — leaps sky-high',
    stars: { spd: 3, jmp: 5, stm: 3 },
    topSpeed: 10, accel: 1.7, spring: 1.40, stamina: 0.9935 },
  { name: 'Palomino', color: '#d4a017', jockeyColor: '#f39c12',
    desc: 'Balanced all-rounder',
    stars: { spd: 4, jmp: 3, stm: 4 },
    topSpeed: 11, accel: 1.9, spring: 1.10, stamina: 0.9940 },
  { name: 'Clydesdale', color: '#7f8c8d', jockeyColor: '#95a5a6',
    desc: 'Slow but iron stamina',
    stars: { spd: 2, jmp: 3, stm: 5 },
    topSpeed: 8, accel: 1.4, spring: 1.05, stamina: 0.9960 },
  { name: 'Arabian', color: '#8e44ad', jockeyColor: '#9b59b6',
    desc: 'Nimble with a quick whip',
    stars: { spd: 4, jmp: 4, stm: 2 },
    topSpeed: 12, accel: 2.0, spring: 1.20, stamina: 0.9910 },
];

// ── Track definitions ─────────────────────────────────────────
interface TrackDef {
  name: string; desc: string; length: number;
  hurdles: number[]; skyTop: string; skyBot: string; groundColor: string;
}
const TRACKS: TrackDef[] = [
  {
    name: 'Meadow Sprint',
    desc: '4 hurdles · Short · Perfect for beginners',
    length: 2400,
    hurdles: [500, 900, 1400, 1900],
    skyTop: '#1a2a4a', skyBot: '#0a0a1e', groundColor: '#1a4a1a',
  },
  {
    name: 'County Chase',
    desc: '7 hurdles · Medium · Tighten your timing',
    length: 3600,
    hurdles: [400, 750, 1100, 1500, 2000, 2600, 3100],
    skyTop: '#2a1a4a', skyBot: '#0d0a1e', groundColor: '#1a3a1a',
  },
  {
    name: 'Grand National',
    desc: '12 hurdles · Long · True champions only',
    length: 5500,
    hurdles: [350, 650, 950, 1300, 1650, 2050, 2500, 2950, 3400, 3900, 4450, 5000],
    skyTop: '#1a0a2a', skyBot: '#050510', groundColor: '#122a12',
  },
];

// ── Leaderboard ───────────────────────────────────────────────
interface LBEntry { name: string; time: number; horse: string; }
type Leaderboard = { [trackName: string]: LBEntry[] };

function loadLB(): Leaderboard {
  try { return JSON.parse(localStorage.getItem('steeplechase-lb') || '{}'); }
  catch { return {}; }
}
function saveLB(lb: Leaderboard) {
  localStorage.setItem('steeplechase-lb', JSON.stringify(lb));
}
function addLBEntry(lb: Leaderboard, track: string, entry: LBEntry): Leaderboard {
  const list = (lb[track] || []).concat(entry);
  list.sort((a, b) => a.time - b.time);
  lb[track] = list.slice(0, 5);
  return { ...lb };
}
function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const dec = Math.floor((ms % 1000) / 10);
  return `${s}.${dec.toString().padStart(2, '0')}s`;
}

// ── Racer ─────────────────────────────────────────────────────
interface Racer {
  name: string;
  horse: HorseDef;
  cameraX: number;
  speed: number;
  jumpH: number;
  jumpVY: number;
  inAir: boolean;
  whipCooldown: number;
  hurdleState: ('none' | 'cleared' | 'hit')[];
  finished: boolean;
  finishTime: number;
  hurdlesHit: number;
}

function makeRacer(name: string, horse: HorseDef, numHurdles: number): Racer {
  return {
    name, horse,
    cameraX: 0, speed: 0,
    jumpH: 0, jumpVY: 0, inAir: false,
    whipCooldown: 0,
    hurdleState: Array(numHurdles).fill('none'),
    finished: false, finishTime: 0, hurdlesHit: 0,
  };
}

type Screen = 'title' | 'name' | 'horse' | 'track' | 'countdown' | 'race' | 'results';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit, OnDestroy {

  // ── Screens ───────────────────────────────────────────────
  screen: Screen = 'title';
  playerCount = 1;
  nameTarget: 1 | 2 = 1;
  p1Name = 'PLAYER 1';
  p2Name = 'PLAYER 2';
  typedName = '';

  // ── Selection ────────────────────────────────────────────
  horses = HORSES;
  tracks  = TRACKS;
  p1HorseIdx = 0;
  p2HorseIdx = 2;
  selectedTrackIdx = 0;
  horseSelectTarget: 1 | 2 = 1;

  // ── Game state ────────────────────────────────────────────
  p1!: Racer;
  p2!: Racer;
  track!: TrackDef;
  raceStart = 0;
  raceElapsed = 0;
  countdownVal = 3;
  countdownDone = false;

  // ── Keyboard ─────────────────────────────────────────────
  keys: { [k: string]: boolean } = {};

  // ── Loop ─────────────────────────────────────────────────
  private raf = 0;
  private lastTime = 0;

  // ── Leaderboard ──────────────────────────────────────────
  lb: Leaderboard = {};

  ngOnInit() { this.lb = loadLB(); }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  // ── Key events ───────────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    this.keys[e.key] = true;

    if (this.screen === 'name') {
      if (e.key === 'Backspace') { this.typedName = this.typedName.slice(0, -1); return; }
      if (e.key === 'Enter') { this.confirmName(); return; }
      if (e.key.length === 1 && this.typedName.length < 10) this.typedName += e.key.toUpperCase();
      return;
    }

    if (this.screen === 'race') {
      // Jump — fire on keydown (not held)
      const p1Jump = e.key === 'ArrowUp' || (this.playerCount === 1 && (e.key === 'w' || e.key === 'W'));
      const p2Jump = e.key === 'w' || e.key === 'W';
      if (p1Jump && !this.p1.inAir && !this.p1.finished) {
        this.p1.jumpVY = JUMP_POWER * this.p1.horse.spring;
        this.p1.inAir  = true;
      }
      if (this.playerCount === 2 && p2Jump && !this.p2.inAir && !this.p2.finished) {
        this.p2.jumpVY = JUMP_POWER * this.p2.horse.spring;
        this.p2.inAir  = true;
      }

      // Whip — P1=L, P2=Space
      if ((e.key === 'l' || e.key === 'L') && !this.p1.finished && this.p1.whipCooldown <= 0) {
        this.p1.speed += WHIP_POWER;
        this.p1.whipCooldown = WHIP_COOLDOWN;
      }
      if (this.playerCount === 2 && e.key === ' ' && !this.p2.finished && this.p2.whipCooldown <= 0) {
        this.p2.speed += WHIP_POWER;
        this.p2.whipCooldown = WHIP_COOLDOWN;
        e.preventDefault();
      }

      // Mash accelerate on keydown
      if (e.key === 'ArrowRight' && !this.p1.finished) {
        this.p1.speed = Math.min(this.p1.speed + this.p1.horse.accel * 0.6, this.p1.horse.topSpeed);
      }
      if (this.playerCount === 1 && (e.key === 'd' || e.key === 'D') && !this.p1.finished) {
        this.p1.speed = Math.min(this.p1.speed + this.p1.horse.accel * 0.6, this.p1.horse.topSpeed);
      }
      if (this.playerCount === 2 && (e.key === 'd' || e.key === 'D') && !this.p2.finished) {
        this.p2.speed = Math.min(this.p2.speed + this.p2.horse.accel * 0.6, this.p2.horse.topSpeed);
      }
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) { delete this.keys[e.key]; }

  // ── Navigation ────────────────────────────────────────────
  startGame(players: 1 | 2) {
    this.playerCount = players;
    this.nameTarget  = 1;
    this.typedName   = '';
    this.screen      = 'name';
  }

  confirmName() {
    const name = this.typedName.trim() || (this.nameTarget === 1 ? 'PLAYER 1' : 'PLAYER 2');
    if (this.nameTarget === 1) {
      this.p1Name = name;
      if (this.playerCount === 2) {
        this.nameTarget = 2;
        this.typedName  = '';
      } else {
        this.horseSelectTarget = 1;
        this.screen = 'horse';
      }
    } else {
      this.p2Name = name;
      this.horseSelectTarget = 1;
      this.screen = 'horse';
    }
  }

  selectHorse(idx: number) {
    if (this.horseSelectTarget === 1) {
      this.p1HorseIdx = idx;
      if (this.playerCount === 2) {
        this.horseSelectTarget = 2;
        this.p2HorseIdx = idx === 0 ? 1 : 0;
      } else {
        this.screen = 'track';
      }
    } else {
      this.p2HorseIdx = idx;
      this.screen = 'track';
    }
  }

  selectTrack(idx: number) {
    this.selectedTrackIdx = idx;
    this.track = TRACKS[idx];
    this.beginCountdown();
  }

  beginCountdown() {
    this.p1 = makeRacer(this.p1Name, HORSES[this.p1HorseIdx], this.track.hurdles.length);
    this.p2 = makeRacer(this.p2Name, HORSES[this.p2HorseIdx], this.track.hurdles.length);
    this.countdownVal  = 3;
    this.countdownDone = false;
    this.screen        = 'countdown';
    this.runCountdown();
  }

  runCountdown() {
    const tick = () => {
      this.countdownVal--;
      if (this.countdownVal <= 0) {
        this.countdownDone = true;
        setTimeout(() => this.beginRace(), 700);
      } else {
        setTimeout(tick, 900);
      }
    };
    setTimeout(tick, 900);
  }

  beginRace() {
    this.raceStart   = performance.now();
    this.raceElapsed = 0;
    this.lastTime    = performance.now();
    this.screen      = 'race';
    this.raf         = requestAnimationFrame(t => this.loop(t));
  }

  // ── Game loop ─────────────────────────────────────────────
  loop(now: number) {
    const dt = Math.min(now - this.lastTime, 100);
    this.lastTime    = now;
    this.raceElapsed = now - this.raceStart;
    const f = dt / (1000 / 60);

    this.updateRacer(this.p1, true, f);
    if (this.playerCount === 2) this.updateRacer(this.p2, false, f);

    const bothDone = this.p1.finished && (this.playerCount === 1 || this.p2.finished);
    if (bothDone) {
      setTimeout(() => this.showResults(), 800);
      return;
    }

    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  updateRacer(r: Racer, isP1: boolean, f: number) {
    if (r.finished) return;

    // Accelerate (hold key)
    const accelKey = isP1
      ? (this.keys['ArrowRight'] || (this.playerCount === 1 && (this.keys['d'] || this.keys['D'])))
      : (this.keys['d'] || this.keys['D']);
    if (accelKey) {
      r.speed = Math.min(r.speed + r.horse.accel * f, r.horse.topSpeed);
    }

    // Friction
    r.speed *= Math.pow(FRICTION * r.horse.stamina, f);

    // Whip cooldown
    if (r.whipCooldown > 0) r.whipCooldown -= f;

    // Jump physics
    if (r.inAir) {
      r.jumpH  += r.jumpVY * f;
      r.jumpVY -= GRAVITY * f;
      if (r.jumpH <= 0) { r.jumpH = 0; r.inAir = false; }
    }

    // Move forward
    r.cameraX += r.speed * f;

    // Hurdle collision
    this.track.hurdles.forEach((hx, i) => {
      if (r.hurdleState[i] !== 'none') return;
      const dist = hx - r.cameraX;
      if (Math.abs(dist) < HURDLE_HALF) {
        if (r.jumpH < HURDLE_HEIGHT) {
          r.speed *= 0.52;
          r.hurdleState[i] = 'hit';
          r.hurdlesHit++;
        }
      } else if (dist < -HURDLE_HALF) {
        r.hurdleState[i] = 'cleared';
      }
    });

    // Finish
    if (r.cameraX >= this.track.length) {
      r.cameraX    = this.track.length;
      r.finished   = true;
      r.finishTime = this.raceElapsed;
    }
  }

  showResults() {
    cancelAnimationFrame(this.raf);
    const t = this.track.name;
    if (this.p1.finished) {
      this.lb = addLBEntry(this.lb, t, { name: this.p1.name, time: this.p1.finishTime, horse: this.p1.horse.name });
    }
    if (this.playerCount === 2 && this.p2.finished) {
      this.lb = addLBEntry(this.lb, t, { name: this.p2.name, time: this.p2.finishTime, horse: this.p2.horse.name });
    }
    saveLB(this.lb);
    this.screen = 'results';
  }

  goTitle() { cancelAnimationFrame(this.raf); this.screen = 'title'; }

  raceAgain() {
    cancelAnimationFrame(this.raf);
    this.beginCountdown();
  }

  // ── Template helpers ──────────────────────────────────────
  hurdleScreenX(r: Racer, hx: number): number {
    return hx - r.cameraX + HORSE_SCREEN_X;
  }

  finishScreenX(r: Racer): number {
    return this.track.length - r.cameraX + HORSE_SCREEN_X;
  }

  progressPct(r: Racer): number {
    return Math.min(100, (r.cameraX / this.track.length) * 100);
  }

  whipPct(r: Racer): number {
    if (r.whipCooldown <= 0) return 100;
    return Math.max(0, 100 - (r.whipCooldown / WHIP_COOLDOWN) * 100);
  }
  whipReady(r: Racer): boolean { return r.whipCooldown <= 0; }

  starArray(n: number): number[] { return Array(n).fill(0); }
  emptyStars(n: number): number[] { return Array(5 - n).fill(0); }

  winner(): string {
    if (this.playerCount === 1) return this.p1.name;
    if (!this.p2.finished) return this.p1.name;
    if (!this.p1.finished) return this.p2.name;
    return this.p1.finishTime <= this.p2.finishTime ? this.p1.name : this.p2.name;
  }

  lbForTrack(): LBEntry[] { return (this.lb[this.track?.name] || []); }

  trackLbPreview(t: TrackDef): string {
    const entries = this.lb[t.name] || [];
    if (!entries.length) return 'No times yet';
    return `Best: ${fmtTime(entries[0].time)} — ${entries[0].name}`;
  }

  fmt(ms: number): string { return fmtTime(ms); }

  horseY(r: Racer, groundY: number): number { return groundY - r.jumpH; }

  legPhase(r: Racer): number { return r.cameraX / 22; }

  legPos(r: Racer): { x1: number; y1: number; x2: number; y2: number }[] {
    const ph = this.legPhase(r);
    const s  = Math.sin(ph);
    const c  = Math.cos(ph);
    return [
      { x1:  16, y1: 14, x2:  20 + s * 10, y2: 36 + Math.abs(c) * 3 },
      { x1:   8, y1: 14, x2:  12 - s * 10, y2: 36 - Math.abs(c) * 3 },
      { x1: -14, y1: 14, x2: -18 + c * 10, y2: 36 + Math.abs(s) * 3 },
      { x1:  -6, y1: 14, x2: -10 - c * 10, y2: 36 - Math.abs(s) * 3 },
    ];
  }

  horseSelectLabel(): string {
    if (this.playerCount === 1) return `${this.p1Name} — PICK YOUR HORSE`;
    return this.horseSelectTarget === 1 ? `${this.p1Name} — PICK YOUR HORSE` : `${this.p2Name} — PICK YOUR HORSE`;
  }

  selectedHorseIdx(): number {
    return this.horseSelectTarget === 1 ? this.p1HorseIdx : this.p2HorseIdx;
  }
}
