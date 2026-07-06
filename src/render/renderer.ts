/**
 * Three.js view of the core sim. Reads GameState every frame and mirrors it
 * into scene objects. SNKRX-style: clean, flat pixel-art shapes on a
 * checkerboard — no post-processing. Rendered at a low internal resolution and
 * upscaled with nearest-neighbour (see RESOLUTION + CSS image-rendering:
 * pixelated) so every shape snaps to a chunky pixel grid instead of looking
 * like smooth vectors.
 */
import * as THREE from 'three';
import { CANNON, CITY, WORLD } from '../core/balance';
import { explosionRadius } from '../core/explosion';
import type { BuildingKind, EnemyKind, GameEvent, GameState, TurretKind, Vec2 } from '../core/types';
import { Particles } from './particles';

/** Internal render is 360px tall; on a 16:9 screen that's exactly 640x360.
 *  Width follows the aspect ratio. Lower = chunkier pixels. */
const RESOLUTION = 360;

/** Checkerboard cell size in world units. */
const CHECKER_CELL = 8;

/** SNKRX drop shadows: every sprite casts a hard shadow this far down-right
 *  (world units; ~4 render pixels at the 360p internal resolution). */
const SHADOW_OFFSET = 1.1;

/** Hp readout: the body's rim stays solid at this world thickness (~6 screen
 *  px on a 1080p display) while the interior works as a vertical progress
 *  bar — colour fill over a dark inset, draining as hp drops. The interior is
 *  a plain FLAT QUAD (not a scaled rounded rect, which deformed into a blob
 *  when squashed on big low-hp bodies); INNER_MAX caps its span so its square
 *  corners always stay inside the body's rounded corners. */
const HP_RIM = 0.55;
const INNER_MAX = 0.8;

/** The SNKRX palette — the six saturated class colours plus a warm-white fg,
 *  on flat neutral dark greys. Everything on screen is built from these. */
const SNKRX = {
  fg: 0xdadada,
  yellow: 0xfacf00,
  orange: 0xf07021,
  red: 0xe91d39,
  green: 0x8bbf40,
  blue: 0x019bd6,
  purple: 0x8e559e,
} as const;

const COLORS = {
  // Two near-equal neutral dark greys for the SNKRX-style checkerboard floor.
  checkerA: 0x262626,
  checkerB: 0x1f1f1f,
  // Arena walls / ground line: the lighter grey SNKRX frames its board with.
  wall: 0x404040,
  city: SNKRX.green,
  cityDead: 0x454545, // dead cities collapse to neutral grey rubble
  cannon: SNKRX.blue,
  interceptorTrail: 0x9c9c9c,
  interceptorHead: SNKRX.fg,
  targetMarker: SNKRX.fg,
  explosion: SNKRX.yellow,
  explosionRing: SNKRX.orange,
} as const;

/** Per-kind turret body colors (also used for their projectiles/beams).
 *  One SNKRX class colour per turret, like the snake's unit classes. */
const TURRET_COLORS: Record<TurretKind, number> = {
  gatling: SNKRX.green,
  flak: SNKRX.orange,
  laser: SNKRX.red,
  missile: SNKRX.yellow,
  railgun: SNKRX.fg,
  tesla: SNKRX.blue,
};

const BEAM_COLORS = { laser: SNKRX.red, railgun: SNKRX.fg, tesla: SNKRX.blue } as const;

/** Support buildings read as rounded blocks (structures), distinct from the
 *  circular turret units. */
const BUILDING_COLORS: Record<BuildingKind, number> = {
  harvester: SNKRX.yellow, // gold — economy
  shield: SNKRX.blue, // blue — protection
  repair: SNKRX.green, // green — sustain
  radar: SNKRX.fg, // white — tech
  jammer: SNKRX.purple, // purple — area denial
  decoy: SNKRX.red, // enemy-red — it wants to be shot at
};

/** Per-kind enemy colours. Same palette as the player side — in SNKRX the
 *  shape carries the team (circles = friendly, squares = hostile). */
const ENEMY_COLORS: Record<EnemyKind, number> = {
  ballistic: SNKRX.red,
  swarmer: SNKRX.orange,
  splitter: SNKRX.purple,
  regenerator: SNKRX.green,
  phase: SNKRX.blue,
  carrier: 0xb31730, // deep red — a heavier shade of the enemy red
  boss: SNKRX.red,
};

/** 7x7 pixel rune stamped on each turret/building body, SNKRX-style, so
 *  same-shape units read at a glance. '1' = ink pixel (dark, engraved). */
const GLYPHS: Record<TurretKind | BuildingKind, string[]> = {
  // Turrets — what the gun does.
  gatling: [
    '.1.1.1.',
    '.1.1.1.',
    '.1.1.1.',
    '.......',
    '.1.1.1.',
    '.1.1.1.',
    '.1.1.1.',
  ], // triple barrels
  flak: [
    '1.....1',
    '.1...1.',
    '..1.1..',
    '...1...',
    '..1.1..',
    '.1...1.',
    '1.....1',
  ], // air burst
  laser: [
    '...1...',
    '...1...',
    '...1...',
    '...1...',
    '...1...',
    '..111..',
    '.11111.',
  ], // focused beam
  missile: [
    '...1...',
    '..111..',
    '.11111.',
    '...1...',
    '...1...',
    '...1...',
    '...1...',
  ], // homing rocket
  railgun: [
    '.......',
    '1...1..',
    '.1...1.',
    '..1...1',
    '.1...1.',
    '1...1..',
    '.......',
  ], // piercing chevrons
  tesla: [
    '.......',
    '.11111.',
    '....1..',
    '...1...',
    '..1....',
    '.11111.',
    '.......',
  ], // zap
  // Support buildings — what the structure provides.
  harvester: [
    '...1...',
    '..111..',
    '.11111.',
    '1111111',
    '.11111.',
    '..111..',
    '...1...',
  ], // scrap gem
  shield: [
    '1111111',
    '1.....1',
    '1.....1',
    '1.....1',
    '.1...1.',
    '..1.1..',
    '...1...',
  ], // shield crest
  repair: [
    '...1...',
    '...1...',
    '...1...',
    '1111111',
    '...1...',
    '...1...',
    '...1...',
  ], // medic cross
  radar: [
    '..111..',
    '.1...1.',
    '1.....1',
    '1..1..1',
    '1.....1',
    '.1...1.',
    '..111..',
  ], // scope ring
  jammer: [
    '.......',
    '.11.11.',
    '1..1..1',
    '.......',
    '.11.11.',
    '1..1..1',
    '.......',
  ], // static waves
  decoy: [
    '...1...',
    '...1...',
    '...1...',
    '...1...',
    '...1...',
    '.......',
    '...1...',
  ], // shoot me!
};

/** Darkened copy of a palette colour, for trails behind their entity. */
function darken(hex: number, f: number): number {
  return new THREE.Color(hex).multiplyScalar(f).getHex();
}

const ENEMY_TRAIL_COLORS: Record<EnemyKind, number> = Object.fromEntries(
  Object.entries(ENEMY_COLORS).map(([k, c]) => [k, darken(c, 0.55)]),
) as Record<EnemyKind, number>;

/** Base render size per enemy kind, with a capped hp-based bonus so late-game
 *  high-hp enemies read as bigger without ballooning off-screen. */
function enemySize(kind: EnemyKind, maxHp: number): number {
  if (kind === 'boss') return 22;
  const base =
    kind === 'swarmer' ? 2.2 : kind === 'carrier' ? 9 : kind === 'regenerator' ? 4.4 : 3.8;
  return base * (1 + Math.min(1.2, (maxHp - 1) * 0.03));
}

interface BeamFx {
  line: THREE.Line;
  ttl: number;
  maxTtl: number;
}

interface EnemyView {
  head: THREE.Mesh;
  shadow: THREE.Mesh;
  /** Dark interior inset revealed as hp drains. */
  innerBg: THREE.Mesh;
  /** Body-coloured hp fill over the inset, bottom-anchored. */
  fill: THREE.Mesh;
  /** Interior span in the head's local units (1 - 2 * rim fraction). */
  inner: number;
  /** Base render size, re-applied around the spawn pop-in. */
  size: number;
  /** Seconds since the view was created (drives the spawn pop-in). */
  spawnT: number;
  /** Hp last frame — a drop triggers the SNKRX white hit-flash. */
  lastHp: number;
  /** Remaining hit-flash seconds. */
  flash: number;
  /** Tumble rate (rad/s) so falling meteors spin as they drop. */
  spin: number;
  kind: EnemyKind;
}

interface InterceptorView {
  head: THREE.Mesh;
  marker: THREE.LineSegments;
}

/** A structure with the interior-gauge treatment (cities: hp, shield:
 *  remaining charges). innerW/innerH are the interior span in local units. */
interface GaugeView {
  mesh: THREE.Mesh;
  innerBg: THREE.Mesh;
  fill: THREE.Mesh;
  innerW: number;
  innerH: number;
}

interface ExplosionView {
  group: THREE.Group;
  /** The four border arcs, spun together at a steady rate. */
  rim: THREE.Group;
}

export class Renderer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;

  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly interceptorViews = new Map<number, InterceptorView>();
  private readonly explosionViews = new Map<number, ExplosionView>();
  private readonly turretMeshes = new Map<number, THREE.Mesh>();
  private readonly buildingMeshes = new Map<number, THREE.Mesh>();
  /** Shield Generators get a charge gauge; max = charges seen at creation. */
  private readonly shieldGauges = new Map<number, GaugeView & { maxCharges: number }>();
  private readonly projectileViews = new Map<number, THREE.Mesh>();
  private readonly cityViews: GaugeView[] = [];
  private readonly beams: BeamFx[] = [];
  private readonly empRings: { mesh: THREE.Mesh; ttl: number; maxTtl: number }[] = [];

  private readonly particles = new Particles();
  private shake = 0;
  private lastRenderTime = 0;

  // Shared geometries/materials (entities are added/removed constantly).
  // SNKRX shape language: player-side units and shots are CIRCLES (the snake),
  // enemies are ROUNDED SQUARES, and structures are rounded blocks. The two
  // shared geometries below (unit-size, scaled per entity) carry all of it.
  private readonly roundedGeo = roundedRectGeometry(1, 1, 0.3);
  /** Ground-segment slab: much gentler corners than the entity chips, so a
   *  near-field-width slab doesn't read as a pill. */
  private readonly segmentGeo = roundedRectGeometry(1, 1, 0.07);
  private readonly discGeo = new THREE.CircleGeometry(1, 32);
  private readonly ringGeo = new THREE.RingGeometry(0.92, 1, 32);
  private readonly interceptorHeadMat = new THREE.MeshBasicMaterial({
    color: COLORS.interceptorHead,
  });
  private readonly markerMat = new THREE.LineBasicMaterial({
    color: COLORS.targetMarker,
    transparent: true,
    opacity: 0.8,
  });
  // SNKRX-style AoE: a soft additive white fill disc plus four chunky white
  // border arcs (60° each, evenly spaced) orbiting the rim together at a
  // steady rate. All geometries and materials are shared across explosions
  // (unit radius, scaled per blast; never disposed per-view).
  private readonly explosionFillMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12, // kept gentle — the bloom pass adds the rest of the pop
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly explosionArcGeo = new THREE.RingGeometry(
    0.85,
    1,
    24,
    1,
    0,
    (60 * Math.PI) / 180,
  );
  private readonly explosionArcMat = new THREE.MeshBasicMaterial({
    color: SNKRX.fg,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  // Dark interior materials for the hp/charge gauges, one per colour, shared.
  private readonly gaugeBgMats = new Map<number, THREE.MeshBasicMaterial>();

  private gaugeBgMat(color: number): THREE.MeshBasicMaterial {
    let mat = this.gaugeBgMats.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color });
      this.gaugeBgMats.set(color, mat);
    }
    return mat;
  }

  /** Attach the interior gauge (dark inset + colour fill) to a structure
   *  body. Interior spans counter the body's (possibly non-uniform) scale so
   *  the rim keeps a constant world thickness on every side. */
  private addGauge(mesh: THREE.Mesh, bgColor: number, fillMat: THREE.Material): GaugeView {
    const innerW = Math.min(INNER_MAX, 1 - (2 * HP_RIM) / Math.max(mesh.scale.x, 0.001));
    const innerH = Math.min(INNER_MAX, 1 - (2 * HP_RIM) / Math.max(mesh.scale.y, 0.001));
    const innerBg = new THREE.Mesh(this.quadGeo, this.gaugeBgMat(bgColor));
    innerBg.scale.set(innerW, innerH, 1);
    innerBg.position.z = 0.05;
    mesh.add(innerBg);
    const fill = new THREE.Mesh(this.quadGeo, fillMat);
    fill.position.z = 0.1;
    mesh.add(fill);
    return { mesh, innerBg, fill, innerW, innerH };
  }

  /** Point a gauge's bottom-anchored fill at a 0..1 fraction. */
  private setGauge(g: GaugeView, frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    g.fill.scale.set(g.innerW, g.innerH * f, 1);
    g.fill.position.y = (-g.innerH * (1 - f)) / 2;
  }

  // Kind runes: one canvas texture + material per kind, cached and shared by
  // every unit of that kind.
  /** Unit flat quad shared by glyph icons and hp-bar interiors. */
  private readonly quadGeo = new THREE.PlaneGeometry(1, 1);
  private readonly glyphMats = new Map<string, THREE.MeshBasicMaterial>();

  private glyphMaterial(kind: TurretKind | BuildingKind): THREE.MeshBasicMaterial {
    let mat = this.glyphMats.get(kind);
    if (mat) return mat;
    const rows = GLYPHS[kind];
    const c = document.createElement('canvas');
    c.width = 7;
    c.height = 7;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1f1f1f'; // dark ink on the coloured body = engraved rune
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '1') ctx.fillRect(x, y, 1, 1);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.glyphMats.set(kind, mat);
    return mat;
  }

  /** Stamp a kind rune onto a body mesh, `size` world units square. The child
   *  counter-scales the parent's (possibly non-uniform) scale so the rune's
   *  pixels stay square. */
  private addGlyph(mesh: THREE.Mesh, kind: TurretKind | BuildingKind, size: number): void {
    const icon = new THREE.Mesh(this.quadGeo, this.glyphMaterial(kind));
    icon.scale.set(size / Math.max(mesh.scale.x, 0.001), size / Math.max(mesh.scale.y, 0.001), 1);
    icon.position.z = 0.2;
    mesh.add(icon);
  }

  /** One shared translucent-black material for every drop shadow, so shadows
   *  darken whatever they fall on (floor, cities, other sprites). */
  private readonly shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });

  /** Attach an SNKRX-style drop shadow to a mesh: a dark copy of its shape,
   *  offset down-right by a constant world distance. Added as a child so it
   *  follows position/scale/rotation for free; the local offset is corrected
   *  for both (see placeShadow). Re-call placeShadow when scale or rotation
   *  changes after creation. */
  private addShadow(mesh: THREE.Mesh): THREE.Mesh {
    const shadow = new THREE.Mesh(mesh.geometry, this.shadowMat);
    shadow.position.z = -0.25; // just behind its caster, in front of the floor
    mesh.add(shadow);
    this.placeShadow(mesh, shadow);
    return shadow;
  }

  /** Keep the shadow's world offset at (+d, -d) regardless of the caster's
   *  scale and z-rotation: express the offset in the caster's local frame. */
  private placeShadow(mesh: THREE.Mesh, shadow: THREE.Object3D): void {
    const c = Math.cos(mesh.rotation.z);
    const s = Math.sin(mesh.rotation.z);
    const d = SHADOW_OFFSET;
    shadow.position.x = (d * (c - s)) / Math.max(mesh.scale.x, 0.001);
    shadow.position.y = (-d * (c + s)) / Math.max(mesh.scale.y, 0.001);
  }

  constructor(container: HTMLElement) {
    this.container = container;
    // antialias off + low internal resolution + CSS nearest upscaling = crisp pixels.
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(1);
    container.prepend(this.renderer.domElement);

    this.scene.background = new THREE.Color(COLORS.checkerB);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.z = 10;

    this.buildStaticScene();
    this.scene.add(this.particles.points);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // Rotating a phone fires 'orientationchange' before layout settles, so
    // re-measure on the next frame as well to catch the final dimensions.
    window.addEventListener('orientationchange', () => {
      this.resize();
      requestAnimationFrame(() => this.resize());
    });
  }

  /** Convert a pointer event position to world coordinates. */
  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return {
      x: THREE.MathUtils.lerp(this.camera.left, this.camera.right, (ndcX + 1) / 2),
      y: THREE.MathUtils.lerp(this.camera.bottom, this.camera.top, (ndcY + 1) / 2),
    };
  }

  onEvents(events: readonly GameEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'cityHit') this.shake = Math.max(this.shake, 1.6);
      if (ev.type === 'groundImpact') this.shake = Math.max(this.shake, 0.5);
      if (ev.type === 'beam') this.spawnBeam(ev.kind, ev.points);
      if (ev.type === 'abilityUsed') {
        if (ev.ability === 'emp') this.spawnEmpRing();
        if (ev.ability === 'megabomb') this.shake = Math.max(this.shake, 2.4);
      }
    }
  }

  /** Big cyan ring sweeping across the field when EMP fires. */
  private spawnEmpRing(): void {
    const mesh = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x5fc9ef, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(0, WORLD.height / 2, 4);
    this.scene.add(mesh);
    this.empRings.push({ mesh, ttl: 0.5, maxTtl: 0.5 });
    this.shake = Math.max(this.shake, 1.2);
  }

  private updateEmpRings(dt: number): void {
    for (let i = this.empRings.length - 1; i >= 0; i--) {
      const r = this.empRings[i]!;
      r.ttl -= dt;
      if (r.ttl <= 0) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.empRings.splice(i, 1);
      } else {
        const t = 1 - r.ttl / r.maxTtl;
        r.mesh.scale.setScalar(8 + t * 150);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      }
    }
  }

  /** Short-lived glowing polyline for laser/railgun/tesla shots. */
  private spawnBeam(kind: 'laser' | 'railgun' | 'tesla', points: Vec2[]): void {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = 2.7; // beams cut across everything but explosions
    });
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.LineBasicMaterial({
      color: BEAM_COLORS[kind],
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    const ttl = kind === 'railgun' ? 0.22 : 0.13;
    this.beams.push({ line, ttl, maxTtl: ttl });
  }

  private updateBeams(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.ttl -= dt;
      if (b.ttl <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
      } else {
        (b.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (b.ttl / b.maxTtl);
      }
    }
  }

  render(state: GameState): void {
    const now = performance.now();
    const dt = this.lastRenderTime ? Math.min((now - this.lastRenderTime) / 1000, 0.1) : 0;
    this.lastRenderTime = now;

    this.syncCities(state);
    this.syncTurrets(state);
    this.syncBuildings(state);
    this.syncProjectiles(state);
    this.syncEnemies(state, dt);
    this.syncInterceptors(state);
    this.syncExplosions(state, dt);
    this.particles.update(dt);
    this.updateBeams(dt);
    this.updateEmpRings(dt);
    this.applyShake();
    this.renderer.render(this.scene, this.camera);
  }

  private buildStaticScene(): void {
    this.addCheckerboard();

    // SNKRX-style arena frame: a flat light-grey ground line plus thin side
    // walls marking the playfield edges on the letterboxed checkerboard.
    const wallMat = new THREE.MeshBasicMaterial({ color: COLORS.wall });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.halfWidth * 2 + 2.4, 1.2), wallMat);
    ground.position.set(0, -0.3, 0);
    this.scene.add(ground);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1.2, WORLD.height + 1.2), wallMat);
      wall.position.set(side * (WORLD.halfWidth + 0.6), WORLD.height / 2 - 0.3, 0);
      this.scene.add(wall);
    }

    // Cannon: rounded-rect base block + short rounded barrel.
    const cannonMat = new THREE.MeshBasicMaterial({ color: COLORS.cannon });
    const base = new THREE.Mesh(this.roundedGeo, cannonMat);
    base.scale.set(7, 3.5, 1);
    base.position.set(CANNON.x, CITY.groundTop + 1.75, 1);
    const barrel = new THREE.Mesh(this.roundedGeo, cannonMat);
    barrel.scale.set(2.2, 3, 1);
    barrel.position.set(CANNON.x, CITY.groundTop + 4.5, 1);
    this.addShadow(base);
    this.addShadow(barrel);
    this.scene.add(base, barrel);
  }

  /** SNKRX-style dark checkerboard floor, drawn from a 2x2 nearest-filtered
   *  texture so the cells stay crisp at any zoom. */
  private addCheckerboard(): void {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const ctx = c.getContext('2d')!;
    const a = '#' + COLORS.checkerA.toString(16).padStart(6, '0');
    const b = '#' + COLORS.checkerB.toString(16).padStart(6, '0');
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(1, 1, 1, 1);

    const tex = new THREE.CanvasTexture(c);
    // The canvas holds sRGB pixel values; without this tag the renderer treats
    // them as linear and re-encodes, washing the floor out to a light grey.
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    const w = WORLD.halfWidth * 2 + 80;
    const h = WORLD.height + 40;
    tex.repeat.set(w / (CHECKER_CELL * 2), h / (CHECKER_CELL * 2));

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    floor.position.set(0, h / 2 - 4, -1);
    this.scene.add(floor);
  }

  private syncCities(state: GameState): void {
    // The defended ground: one raised slab per segment, spanning the full
    // field width, each with an hp gauge interior. Rebuilt when the segment
    // count changes (Districts upgrade between nights).
    if (this.cityViews.length !== state.cities.length) {
      for (const v of this.cityViews) {
        this.scene.remove(v.mesh);
        (v.mesh.material as THREE.Material).dispose();
      }
      this.cityViews.length = 0;
      const segW = (WORLD.halfWidth * 2) / state.cities.length;
      for (const city of state.cities) {
        const mesh = new THREE.Mesh(
          this.segmentGeo,
          new THREE.MeshBasicMaterial({ color: COLORS.city }),
        );
        mesh.scale.set(segW - 1.4, CITY.groundTop, 1);
        mesh.position.set(city.x, CITY.groundTop / 2, 1);
        this.addShadow(mesh);
        this.scene.add(mesh);
        this.cityViews.push(this.addGauge(mesh, darken(COLORS.city, 0.3), mesh.material));
      }
    }
    state.cities.forEach((city, i) => {
      const v = this.cityViews[i];
      if (!v) return;
      const alive = city.hp > 0;
      (v.mesh.material as THREE.MeshBasicMaterial).color.setHex(
        alive ? COLORS.city : COLORS.cityDead,
      );
      // Dead ground is a grey slab — no gauge.
      v.innerBg.visible = alive;
      v.fill.visible = alive;
      if (alive) this.setGauge(v, city.hp / city.maxHp);
    });
  }

  private syncTurrets(state: GameState): void {
    // Turrets are created once per night and don't move; just create on demand.
    // Every deployed structure shares one SNKRX-chip shape — a rounded block
    // in the kind's colour with its rune doing the telling-apart.
    for (const t of state.turrets) {
      if (this.turretMeshes.has(t.id)) continue;
      const mesh = new THREE.Mesh(
        this.roundedGeo,
        new THREE.MeshBasicMaterial({ color: TURRET_COLORS[t.kind] }),
      );
      // Slightly smaller than the support buildings so the skyline varies.
      mesh.scale.set(5, 6.3, 1);
      // Chip bottom flush with the top of the ground band (t.y is the sim's
      // muzzle height, not a terrain offset).
      mesh.position.set(t.x, CITY.groundTop + 3.15, 1.5);
      this.addShadow(mesh);
      this.addGlyph(mesh, t.kind, 3.8);
      this.scene.add(mesh);
      this.turretMeshes.set(t.id, mesh);
    }
    // Remove any left over from a previous night with more turrets.
    if (this.turretMeshes.size > state.turrets.length) {
      const ids = new Set(state.turrets.map((t) => t.id));
      for (const [id, mesh] of this.turretMeshes) {
        if (!ids.has(id)) {
          this.scene.remove(mesh);
          (mesh.material as THREE.Material).dispose();
          this.turretMeshes.delete(id);
        }
      }
    }
  }

  private syncBuildings(state: GameState): void {
    // Buildings are static for the night; the same chip shape as turrets, in
    // the kind's support colour with its rune.
    for (const b of state.buildings) {
      if (this.buildingMeshes.has(b.id)) continue;
      const body = new THREE.Mesh(
        this.roundedGeo,
        new THREE.MeshBasicMaterial({ color: BUILDING_COLORS[b.kind] }),
      );
      body.scale.set(6, 7.5, 1);
      body.position.set(b.x, CITY.groundTop + 3.75, 1.5);
      this.addShadow(body);
      // Shield Generators show remaining charges as an interior gauge (under
      // the rune, which sits at a higher local z).
      if (b.kind === 'shield') {
        const gauge = this.addGauge(body, darken(BUILDING_COLORS.shield, 0.3), body.material);
        this.shieldGauges.set(b.id, { ...gauge, maxCharges: Math.max(1, b.charges) });
      }
      this.addGlyph(body, b.kind, 4.5);
      this.scene.add(body);
      this.buildingMeshes.set(b.id, body);
    }
    // Keep shield charge gauges current.
    for (const b of state.buildings) {
      if (b.kind !== 'shield') continue;
      const g = this.shieldGauges.get(b.id);
      if (g) this.setGauge(g, b.charges / g.maxCharges);
    }
    if (this.buildingMeshes.size > state.buildings.length) {
      const ids = new Set(state.buildings.map((b) => b.id));
      for (const [id, mesh] of this.buildingMeshes) {
        if (!ids.has(id)) {
          this.scene.remove(mesh);
          (mesh.material as THREE.Material).dispose();
          this.buildingMeshes.delete(id);
          this.shieldGauges.delete(id);
        }
      }
    }
  }

  private syncProjectiles(state: GameState): void {
    const seen = new Set<number>();
    for (const p of state.projectiles) {
      seen.add(p.id);
      let mesh = this.projectileViews.get(p.id);
      if (!mesh) {
        // Player shots are little discs in the turret's class colour.
        mesh = new THREE.Mesh(
          this.discGeo,
          new THREE.MeshBasicMaterial({ color: TURRET_COLORS[p.kind] }),
        );
        const size = p.kind === 'missile' ? 1.3 : p.kind === 'flak' ? 1 : 0.8;
        mesh.scale.set(size, size, 1);
        this.addShadow(mesh);
        this.scene.add(mesh);
        this.projectileViews.set(p.id, mesh);
      }
      mesh.position.set(p.pos.x, p.pos.y, 2.5); // above the enemy slots
      // Missiles leave a particle trail like the enemy/interceptor shots.
      if (p.kind === 'missile')
        this.particles.emit(p.pos.x, p.pos.y, darken(TURRET_COLORS.missile, 0.6));
    }
    for (const [id, mesh] of this.projectileViews) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.projectileViews.delete(id);
      }
    }
  }

  private syncEnemies(state: GameState, dt: number): void {
    const seen = new Set<number>();
    for (const e of state.enemies) {
      seen.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (!view) {
        // Per-kind colour; per-enemy material so phased enemies can fade and
        // hit enemies can flash white.
        const mat = new THREE.MeshBasicMaterial({
          color: ENEMY_COLORS[e.kind],
          transparent: true,
          opacity: 1,
        });
        const head = new THREE.Mesh(this.roundedGeo, mat);
        // Splitters read as diamonds — the same rounded square turned 45°.
        if (e.kind === 'splitter') head.rotation.z = Math.PI / 4;
        // Hp readout: a constant-thickness rim of body colour around a dark
        // interior; the fill (sharing the body material, so it flashes and
        // fades with it) drains bottom-up as hp drops. Flat quads — see HP_RIM.
        const size = enemySize(e.kind, e.maxHp);
        const inner = Math.min(INNER_MAX, 1 - 2 * Math.min(0.22, HP_RIM / size));
        const innerBg = new THREE.Mesh(this.quadGeo, this.gaugeBgMat(darken(ENEMY_COLORS[e.kind], 0.3)));
        innerBg.scale.set(inner, inner, 1);
        innerBg.position.z = 0.001;
        head.add(innerBg);
        const fill = new THREE.Mesh(this.quadGeo, mat);
        fill.position.z = 0.002;
        head.add(fill);
        view = {
          head,
          shadow: this.addShadow(head),
          innerBg,
          fill,
          inner,
          size,
          spawnT: 0,
          lastHp: e.hp,
          flash: 0,
          // Meteors tumble as they fall; bosses get a steady menacing turn.
          spin:
            e.kind === 'boss' ? 0.5 : (1 + Math.random() * 1.8) * (Math.random() < 0.5 ? -1 : 1),
          kind: e.kind,
        };
        this.scene.add(view.head);
        this.enemyViews.set(e.id, view);
      }
      // Deterministic per-enemy z slot (2.0–2.4) so overlapping enemies stack
      // in a clear order instead of interleaving coplanar layers. The hp-bar
      // children sit within a slot's 0.004 step; shots render above at 2.5+.
      view.head.position.set(e.pos.x, e.pos.y, 2 + (e.id % 100) * 0.004);
      view.head.rotation.z += view.spin * dt;
      // Spawn pop-in: scale up fast with a slight overshoot.
      view.spawnT = Math.min(view.spawnT + dt, 0.25);
      const t = view.spawnT / 0.25;
      const pop = t * (1.3 - 0.3 * t);
      view.head.scale.set(view.size * pop, view.size * pop, 1);
      // Scale/rotation change every frame, so keep the shadow's world offset
      // pinned down-right; phased enemies are ghosts and cast none.
      this.placeShadow(view.head, view.shadow);
      view.shadow.visible = !e.phased;
      // SNKRX hit-flash: blink white for a beat whenever hp drops.
      if (e.hp < view.lastHp) view.flash = 0.09;
      view.lastHp = e.hp;
      view.flash = Math.max(0, view.flash - dt);
      const mat = view.head.material as THREE.MeshBasicMaterial;
      mat.color.setHex(view.flash > 0 ? 0xffffff : ENEMY_COLORS[e.kind]);
      // Phase Walkers fade out (and stop trailing) while untargetable.
      mat.opacity = e.phased ? 0.28 : 1;
      // Interior hp bar: bottom-anchored fill draining with the hp fraction.
      const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      view.fill.scale.set(view.inner, view.inner * frac, 1);
      view.fill.position.y = (-view.inner * (1 - frac)) / 2;
      // Ghosting phase walkers show as a plain translucent square, no bar.
      view.innerBg.visible = !e.phased;
      view.fill.visible = !e.phased;
      if (!e.phased) this.particles.emit(e.pos.x, e.pos.y, ENEMY_TRAIL_COLORS[e.kind]);
    }
    for (const [id, view] of this.enemyViews) {
      if (!seen.has(id)) {
        // Death pop: shower of particles in the enemy's own colour.
        this.particles.burst(view.head.position.x, view.head.position.y, ENEMY_COLORS[view.kind]);
        this.scene.remove(view.head);
        (view.head.material as THREE.Material).dispose();
        this.enemyViews.delete(id);
      }
    }
  }

  private syncInterceptors(state: GameState): void {
    const seen = new Set<number>();
    for (const it of state.interceptors) {
      seen.add(it.id);
      let view = this.interceptorViews.get(it.id);
      if (!view) {
        const markerGeo = new THREE.BufferGeometry();
        const m = 1.4;
        markerGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(
            // prettier-ignore
            new Float32Array([
              it.target.x - m, it.target.y - m, 0, it.target.x + m, it.target.y + m, 0,
              it.target.x - m, it.target.y + m, 0, it.target.x + m, it.target.y - m, 0,
            ]),
            3,
          ),
        );
        view = {
          // Player shots are white discs, like the snake's own bullets.
          head: new THREE.Mesh(this.discGeo, this.interceptorHeadMat),
          marker: new THREE.LineSegments(markerGeo, this.markerMat),
        };
        view.head.scale.set(1.4, 1.4, 1);
        this.addShadow(view.head);
        this.scene.add(view.head, view.marker);
        this.interceptorViews.set(it.id, view);
      }
      view.head.position.set(it.pos.x, it.pos.y, 2.5); // above the enemy slots
      this.particles.emit(it.pos.x, it.pos.y, COLORS.interceptorTrail);
    }
    for (const [id, view] of this.interceptorViews) {
      if (!seen.has(id)) {
        this.scene.remove(view.head, view.marker);
        view.marker.geometry.dispose();
        this.interceptorViews.delete(id);
      }
    }
  }

  private syncExplosions(state: GameState, dt: number): void {
    const seen = new Set<number>();
    for (const ex of state.explosions) {
      seen.add(ex.id);
      let view = this.explosionViews.get(ex.id);
      if (!view) {
        // SNKRX AoE: full blast size the instant it lands — an additive white
        // fill with four chunky arcs spinning fast around the rim — then the
        // whole thing shrinks away (mirroring the damage radius).
        const group = new THREE.Group();
        group.position.set(ex.pos.x, ex.pos.y, 3);
        const fill = new THREE.Mesh(this.discGeo, this.explosionFillMat);
        group.add(fill);
        // Four evenly spaced white arcs on a rim group that spins as one.
        const rim = new THREE.Group();
        rim.position.z = 0.1;
        rim.rotation.z = Math.random() * Math.PI * 2; // random phase per blast
        for (let i = 0; i < 4; i++) {
          const mesh = new THREE.Mesh(this.explosionArcGeo, this.explosionArcMat);
          mesh.rotation.z = (i / 4) * Math.PI * 2;
          rim.add(mesh);
        }
        group.add(rim);
        view = { group, rim };
        this.scene.add(group);
        this.explosionViews.set(ex.id, view);
      }
      view.group.scale.setScalar(Math.max(explosionRadius(ex), 0.01));
      view.rim.rotation.z += 5.5 * dt;
    }
    for (const [id, view] of this.explosionViews) {
      if (!seen.has(id)) {
        this.scene.remove(view.group);
        this.explosionViews.delete(id);
      }
    }
  }

  private applyShake(): void {
    if (this.shake > 0.01) {
      this.camera.position.x = (Math.random() - 0.5) * this.shake;
      this.camera.position.y = (Math.random() - 0.5) * this.shake;
      this.shake *= 0.88;
    } else {
      this.camera.position.x = 0;
      this.camera.position.y = 0;
    }
  }

  private resize(): void {
    // Measure the canvas's actual displayed box (the container fills the screen
    // edge-to-edge via CSS), so the camera aspect matches exactly what's on
    // screen — no stretch — even with safe-area insets in standalone PWA mode.
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const aspect = w / h;

    // Render into a low-res buffer; CSS (image-rendering: pixelated) upscales it
    // to fill the screen with nearest-neighbour → chunky pixel-art look.
    const lowH = RESOLUTION;
    const lowW = Math.max(1, Math.round(RESOLUTION * aspect));
    this.renderer.setSize(lowW, lowH, false); // false: don't touch canvas CSS size

    // Always show the full world rect; letterbox with extra sky/sides.
    const worldAspect = (WORLD.halfWidth * 2) / WORLD.height;
    let halfW: number;
    let height: number;
    if (aspect >= worldAspect) {
      height = WORLD.height;
      halfW = (WORLD.height * aspect) / 2;
    } else {
      halfW = WORLD.halfWidth;
      height = (WORLD.halfWidth * 2) / aspect;
    }
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.bottom = -2;
    this.camera.top = height - 2;
    this.camera.updateProjectionMatrix();
  }
}

/** A filled rounded-rectangle, centred at the origin, width x height with the
 *  given corner radius. Used as the shared shape for every game object. */
function roundedRectGeometry(width: number, height: number, radius: number): THREE.ShapeGeometry {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  s.closePath();
  return new THREE.ShapeGeometry(s, 4);
}
