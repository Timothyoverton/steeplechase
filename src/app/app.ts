import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

// ── Physics ──────────────────────────────────────────────────
const GRAVITY        = 0.42;
const JUMP_POWER     = 6.0;     // halved from original; Thoroughbred apex ≈ 30 px, Steeplechaser ≈ 85 px
const HURDLE_HEIGHT  = 26;      // horse must clear this height; Thoroughbred just makes it
const HURDLE_HALF    = 22;      // collision zone half-width (world px)
const WATER_WIDTH    = 80;      // water ditch world-px width
const WATER_HEIGHT   = 12;      // horse needs jumpH > this to skim over water
const HORSE_SCREEN_X = 200;
const FRICTION       = 0.992;
const WHIP_POWER     = 5.0;
const WHIP_COOLDOWN  = 240;

// ── Horse definitions ─────────────────────────────────────────
interface HorseDef {
  name: string; color: string; darkColor: string; jockeyColor: string;
  desc: string; stars: { spd: number; jmp: number; stm: number; };
  topSpeed: number; accel: number; spring: number; stamina: number;
}
const HORSES: HorseDef[] = [
  { name: 'Thoroughbred', color: '#b83222', darkColor: '#7a1a0e', jockeyColor: '#e74c3c',
    desc: 'Blazing speed, average jump',
    stars: { spd: 5, jmp: 2, stm: 3 },
    topSpeed: 13, accel: 2.2, spring: 0.88, stamina: 0.9925 },
  { name: 'Steeplechaser', color: '#1e8a46', darkColor: '#0e5228', jockeyColor: '#2ecc71',
    desc: 'Born to jump — leaps sky-high',
    stars: { spd: 3, jmp: 5, stm: 3 },
    topSpeed: 10, accel: 1.7, spring: 1.45, stamina: 0.9935 },
  { name: 'Palomino', color: '#c8860a', darkColor: '#7a5000', jockeyColor: '#f39c12',
    desc: 'Balanced all-rounder',
    stars: { spd: 4, jmp: 3, stm: 4 },
    topSpeed: 11, accel: 1.9, spring: 1.12, stamina: 0.9940 },
  { name: 'Clydesdale', color: '#6a6e72', darkColor: '#3a3e42', jockeyColor: '#95a5a6',
    desc: 'Slow but iron stamina',
    stars: { spd: 2, jmp: 3, stm: 5 },
    topSpeed: 8, accel: 1.4, spring: 1.06, stamina: 0.9960 },
  { name: 'Arabian', color: '#7b2fa8', darkColor: '#4a1a66', jockeyColor: '#9b59b6',
    desc: 'Nimble with a quick whip',
    stars: { spd: 4, jmp: 4, stm: 2 },
    topSpeed: 12, accel: 2.0, spring: 1.22, stamina: 0.9910 },
];

// ── Track definitions ─────────────────────────────────────────
interface WaterJump { x: number; }
interface TrackDef {
  name: string; desc: string; length: number;
  hurdles: number[];
  water: WaterJump[];
  skyTop: string; skyBot: string; groundColor: string;
}
const TRACKS: TrackDef[] = [
  {
    name: 'Meadow Sprint',
    desc: '3 hurdles · 1 water · Short · Good for beginners',
    length: 2400,
    hurdles: [500, 1200, 1950],
    water:   [{ x: 820 }],
    skyTop: '#1a2a4a', skyBot: '#0a0a1e', groundColor: '#1a4a1a',
  },
  {
    name: 'County Chase',
    desc: '5 hurdles · 2 water · Medium · Time those jumps',
    length: 3600,
    hurdles: [400, 950, 1550, 2350, 3050],
    water:   [{ x: 680 }, { x: 1900 }],
    skyTop: '#2a1a4a', skyBot: '#0d0a1e', groundColor: '#1a3a1a',
  },
  {
    name: 'Grand National',
    desc: '8 hurdles · 4 water · Long · Champions only',
    length: 5500,
    hurdles: [350, 900, 1400, 2000, 2600, 3200, 3900, 4700],
    water:   [{ x: 620 }, { x: 1700 }, { x: 2900 }, { x: 4300 }],
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
  waterState:  ('none' | 'cleared' | 'wet')[];
  hurdlesHit: number;
  waterHit: number;
  finished: boolean;
  finishTime: number;
}

function makeRacer(name: string, horse: HorseDef, track: TrackDef): Racer {
  return {
    name, horse,
    cameraX: 0, speed: 0,
    jumpH: 0, jumpVY: 0, inAir: false,
    whipCooldown: 0,
    hurdleState: Array(track.hurdles.length).fill('none'),
    waterState:  Array(track.water.length).fill('none'),
    hurdlesHit: 0, waterHit: 0,
    finished: false, finishTime: 0,
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

  screen: Screen = 'title';
  playerCount = 1;
  nameTarget: 1 | 2 = 1;
  p1Name = 'PLAYER 1';
  p2Name = 'PLAYER 2';
  typedName = '';

  horses = HORSES;
  tracks  = TRACKS;
  p1HorseIdx = 0;
  p2HorseIdx = 2;
  selectedTrackIdx = 0;
  horseSelectTarget: 1 | 2 = 1;

  p1!: Racer;
  p2!: Racer;
  track!: TrackDef;
  raceStart = 0;
  raceElapsed = 0;
  countdownVal = 3;
  countdownDone = false;

  keys: { [k: string]: boolean } = {};

  private raf = 0;
  private lastTime = 0;

  lb: Leaderboard = {};

  readonly waterWidth = WATER_WIDTH;

  ngOnInit() { this.lb = loadLB(); }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

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

      if ((e.key === 'l' || e.key === 'L') && !this.p1.finished && this.p1.whipCooldown <= 0) {
        this.p1.speed += WHIP_POWER;
        this.p1.whipCooldown = WHIP_COOLDOWN;
      }
      if (this.playerCount === 2 && e.key === ' ' && !this.p2.finished && this.p2.whipCooldown <= 0) {
        this.p2.speed += WHIP_POWER;
        this.p2.whipCooldown = WHIP_COOLDOWN;
        e.preventDefault();
      }

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
      if (this.playerCount === 2) { this.nameTarget = 2; this.typedName = ''; }
      else { this.horseSelectTarget = 1; this.screen = 'horse'; }
    } else {
      this.p2Name = name;
      this.horseSelectTarget = 1;
      this.screen = 'horse';
    }
  }

  selectHorse(idx: number) {
    if (this.horseSelectTarget === 1) {
      this.p1HorseIdx = idx;
      if (this.playerCount === 2) { this.horseSelectTarget = 2; this.p2HorseIdx = idx === 0 ? 1 : 0; }
      else this.screen = 'track';
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
    this.p1 = makeRacer(this.p1Name, HORSES[this.p1HorseIdx], this.track);
    this.p2 = makeRacer(this.p2Name, HORSES[this.p2HorseIdx], this.track);
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
      } else setTimeout(tick, 900);
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

  loop(now: number) {
    const dt = Math.min(now - this.lastTime, 100);
    this.lastTime    = now;
    this.raceElapsed = now - this.raceStart;
    const f = dt / (1000 / 60);

    this.updateRacer(this.p1, true, f);
    if (this.playerCount === 2) this.updateRacer(this.p2, false, f);

    const bothDone = this.p1.finished && (this.playerCount === 1 || this.p2.finished);
    if (bothDone) { setTimeout(() => this.showResults(), 800); return; }

    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  updateRacer(r: Racer, isP1: boolean, f: number) {
    if (r.finished) return;

    const accelKey = isP1
      ? (this.keys['ArrowRight'] || (this.playerCount === 1 && (this.keys['d'] || this.keys['D'])))
      : (this.keys['d'] || this.keys['D']);
    if (accelKey) r.speed = Math.min(r.speed + r.horse.accel * f, r.horse.topSpeed);

    r.speed *= Math.pow(FRICTION * r.horse.stamina, f);
    if (r.whipCooldown > 0) r.whipCooldown -= f;

    if (r.inAir) {
      r.jumpH  += r.jumpVY * f;
      r.jumpVY -= GRAVITY * f;
      if (r.jumpH <= 0) { r.jumpH = 0; r.inAir = false; }
    }

    r.cameraX += r.speed * f;

    // Hurdle collision — must jump over
    this.track.hurdles.forEach((hx, i) => {
      if (r.hurdleState[i] !== 'none') return;
      const dist = hx - r.cameraX;
      if (Math.abs(dist) < HURDLE_HALF) {
        if (r.jumpH < HURDLE_HEIGHT) {
          r.speed *= 0.44;   // solid hit — big penalty
          r.hurdleState[i] = 'hit';
          r.hurdlesHit++;
        }
      } else if (dist < -HURDLE_HALF) {
        r.hurdleState[i] = 'cleared';
      }
    });

    // Water collision — must be airborne to cross
    this.track.water.forEach((w, i) => {
      if (r.waterState[i] === 'cleared') return;
      const inZone = r.cameraX >= w.x && r.cameraX <= w.x + WATER_WIDTH;
      if (inZone && r.waterState[i] === 'none' && r.jumpH < WATER_HEIGHT) {
        r.speed *= 0.36;   // splash — heavy penalty
        r.waterState[i] = 'wet';
        r.waterHit++;
      }
      if (r.cameraX > w.x + WATER_WIDTH) r.waterState[i] = 'cleared';
    });

    if (r.cameraX >= this.track.length) {
      r.cameraX    = this.track.length;
      r.finished   = true;
      r.finishTime = this.raceElapsed;
    }
  }

  showResults() {
    cancelAnimationFrame(this.raf);
    const t = this.track.name;
    if (this.p1.finished)
      this.lb = addLBEntry(this.lb, t, { name: this.p1.name, time: this.p1.finishTime, horse: this.p1.horse.name });
    if (this.playerCount === 2 && this.p2.finished)
      this.lb = addLBEntry(this.lb, t, { name: this.p2.name, time: this.p2.finishTime, horse: this.p2.horse.name });
    saveLB(this.lb);
    this.screen = 'results';
  }

  goTitle()  { cancelAnimationFrame(this.raf); this.screen = 'title'; }
  raceAgain() { cancelAnimationFrame(this.raf); this.beginCountdown(); }

  // ── Template helpers ──────────────────────────────────────
  hurdleScreenX(r: Racer, hx: number): number  { return hx - r.cameraX + HORSE_SCREEN_X; }
  waterScreenX(r: Racer, w: WaterJump): number  { return w.x - r.cameraX + HORSE_SCREEN_X; }
  finishScreenX(r: Racer): number               { return this.track.length - r.cameraX + HORSE_SCREEN_X; }

  progressPct(r: Racer): number { return Math.min(100, (r.cameraX / this.track.length) * 100); }

  whipPct(r: Racer): number {
    if (r.whipCooldown <= 0) return 100;
    return Math.max(0, 100 - (r.whipCooldown / WHIP_COOLDOWN) * 100);
  }
  whipReady(r: Racer): boolean { return r.whipCooldown <= 0; }

  horseY(r: Racer, groundY: number): number { return groundY - r.jumpH; }

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

  horseSelectLabel(): string {
    if (this.playerCount === 1) return `${this.p1Name} — PICK YOUR HORSE`;
    return this.horseSelectTarget === 1 ? `${this.p1Name} — PICK YOUR HORSE` : `${this.p2Name} — PICK YOUR HORSE`;
  }

  selectedHorseIdx(): number {
    return this.horseSelectTarget === 1 ? this.p1HorseIdx : this.p2HorseIdx;
  }
}
