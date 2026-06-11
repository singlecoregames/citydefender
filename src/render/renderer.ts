/**
 * Three.js view of the core sim. Reads GameState every frame and mirrors it
 * into scene objects. SNKRX-style: clean pixel-art shapes on a checkerboard,
 * with a gentle bloom. Rendered at a low internal resolution and upscaled with
 * nearest-neighbour (see RESOLUTION + CSS image-rendering: pixelated) so every
 * shape snaps to a chunky pixel grid instead of looking like smooth vectors.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CANNON, WORLD } from '../core/balance';
import { explosionRadius } from '../core/explosion';
import type { EnemyKind, GameEvent, GameState, TurretKind, Vec2 } from '../core/types';
import { Particles } from './particles';

/** Internal render is 360px tall; on a 16:9 screen that's exactly 640x360.
 *  Width follows the aspect ratio. Lower = chunkier pixels. */
const RESOLUTION = 360;

/** Checkerboard cell size in world units. */
const CHECKER_CELL = 8;

const COLORS = {
  // Two near-equal dark greys for the SNKRX-style checkerboard floor.
  checkerA: 0x21212a,
  checkerB: 0x191920,
  ground: 0x3a3a48,
  city: 0x49d17a,
  cityDead: 0x3a2630,
  cannon: 0x4aa0ff,
  projectile: 0xaef0ff,
  interceptorTrail: 0x2f6fb0,
  interceptorHead: 0xbfe0ff,
  targetMarker: 0x9fbfff,
  enemyTrail: 0x7a2030,
  enemyHead: 0xff5042,
  explosion: 0xffd24a,
  explosionRing: 0xff8c2a,
} as const;

/** Per-kind turret body colors (also used for their projectiles/beams). */
const TURRET_COLORS: Record<TurretKind, number> = {
  gatling: 0x36e0b0,
  flak: 0xffa030,
  laser: 0xff6a4a,
  missile: 0xffdc50,
  railgun: 0xe8f4ff,
  tesla: 0x7ae0ff,
};

const BEAM_COLORS = { laser: 0xff6a4a, railgun: 0xe8f4ff, tesla: 0x7ae0ff } as const;

/** Per-kind enemy colours. */
const ENEMY_COLORS: Record<EnemyKind, number> = {
  ballistic: 0xff5042,
  swarmer: 0xff9a5a,
  splitter: 0xc060ff,
  regenerator: 0x5ad07a,
  phase: 0x60c8ff,
  carrier: 0xd0304a,
  boss: 0xff1840,
};

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
}

interface InterceptorView {
  head: THREE.Mesh;
  marker: THREE.LineSegments;
}

interface ExplosionView {
  disc: THREE.Mesh;
  ring: THREE.Mesh;
}

export class Renderer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly composer: EffectComposer;

  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly interceptorViews = new Map<number, InterceptorView>();
  private readonly explosionViews = new Map<number, ExplosionView>();
  private readonly turretMeshes = new Map<number, THREE.Mesh>();
  private readonly projectileViews = new Map<number, THREE.Mesh>();
  private readonly cityMeshes: THREE.Mesh[] = [];
  private readonly beams: BeamFx[] = [];
  private readonly empRings: { mesh: THREE.Mesh; ttl: number; maxTtl: number }[] = [];

  private readonly particles = new Particles();
  private shake = 0;
  private lastRenderTime = 0;

  // Shared geometries/materials (entities are added/removed constantly).
  // Every object is a rounded-corner square (unit 1x1, corner radius ~0.3),
  // scaled per entity — the shared SNKRX-style shape language.
  private readonly roundedGeo = roundedRectGeometry(1, 1, 0.3);
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

  constructor(container: HTMLElement) {
    this.container = container;
    // antialias off + low internal resolution + CSS nearest upscaling = crisp pixels.
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(1);
    container.prepend(this.renderer.domElement);

    this.scene.background = new THREE.Color(COLORS.checkerB);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.z = 10;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Gentle glow only: low strength, high threshold so just the bright cores bloom.
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.55);
    this.composer.addPass(bloom);

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
      new THREE.MeshBasicMaterial({ color: 0x80e0ff, transparent: true, opacity: 0.9 }),
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
      arr[i * 3 + 2] = 2.5;
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
    this.syncProjectiles(state);
    this.syncEnemies(state);
    this.syncInterceptors(state);
    this.syncExplosions(state);
    this.particles.update(dt);
    this.updateBeams(dt);
    this.updateEmpRings(dt);
    this.applyShake();
    this.composer.render();
  }

  private buildStaticScene(): void {
    this.addCheckerboard();

    // Ground line.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.halfWidth * 2 + 40, 0.6),
      new THREE.MeshBasicMaterial({ color: COLORS.ground }),
    );
    ground.position.set(0, 0, 0);
    this.scene.add(ground);

    // Cannon: rounded-rect base block + short rounded barrel.
    const cannonMat = new THREE.MeshBasicMaterial({ color: COLORS.cannon });
    const base = new THREE.Mesh(this.roundedGeo, cannonMat);
    base.scale.set(7, 3.5, 1);
    base.position.set(CANNON.x, 1.75, 1);
    const barrel = new THREE.Mesh(this.roundedGeo, cannonMat);
    barrel.scale.set(2.2, 3, 1);
    barrel.position.set(CANNON.x, 4.5, 1);
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
    if (this.cityMeshes.length === 0) {
      for (const city of state.cities) {
        // City as a single rounded-rect block.
        const mesh = new THREE.Mesh(
          this.roundedGeo,
          new THREE.MeshBasicMaterial({ color: COLORS.city }),
        );
        mesh.scale.set(11, 6, 1);
        mesh.position.set(city.x, 3, 1);
        this.scene.add(mesh);
        this.cityMeshes.push(mesh);
      }
    }
    state.cities.forEach((city, i) => {
      const mesh = this.cityMeshes[i];
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const alive = city.hp > 0;
      mat.color.setHex(alive ? COLORS.city : COLORS.cityDead);
      mesh.scale.y = alive ? 6 : 2.6;
      mesh.position.y = alive ? 3 : 1.3;
    });
  }

  private syncTurrets(state: GameState): void {
    // Turrets are created once per night and don't move; just create on demand.
    for (const t of state.turrets) {
      if (this.turretMeshes.has(t.id)) continue;
      const mesh = new THREE.Mesh(
        this.roundedGeo,
        new THREE.MeshBasicMaterial({ color: TURRET_COLORS[t.kind] }),
      );
      mesh.scale.set(6, 6, 1);
      mesh.position.set(t.x, t.y + 1, 1.5);
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

  private syncProjectiles(state: GameState): void {
    const seen = new Set<number>();
    for (const p of state.projectiles) {
      seen.add(p.id);
      let mesh = this.projectileViews.get(p.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.roundedGeo,
          new THREE.MeshBasicMaterial({ color: TURRET_COLORS[p.kind] }),
        );
        const size = p.kind === 'missile' ? 2.6 : p.kind === 'flak' ? 2 : 1.6;
        mesh.scale.set(size, size, 1);
        this.scene.add(mesh);
        this.projectileViews.set(p.id, mesh);
      }
      mesh.position.set(p.pos.x, p.pos.y, 2);
      // Missiles leave a particle trail like the enemy/interceptor shots.
      if (p.kind === 'missile') this.particles.emit(p.pos.x, p.pos.y);
    }
    for (const [id, mesh] of this.projectileViews) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.projectileViews.delete(id);
      }
    }
  }

  private syncEnemies(state: GameState): void {
    const seen = new Set<number>();
    for (const e of state.enemies) {
      seen.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (!view) {
        // Per-kind colour; per-enemy material so phased enemies can fade.
        const mat = new THREE.MeshBasicMaterial({
          color: ENEMY_COLORS[e.kind],
          transparent: true,
          opacity: 1,
        });
        view = { head: new THREE.Mesh(this.roundedGeo, mat) };
        const sz = enemySize(e.kind, e.maxHp);
        view.head.scale.set(sz, sz, 1);
        this.scene.add(view.head);
        this.enemyViews.set(e.id, view);
      }
      view.head.position.set(e.pos.x, e.pos.y, 2);
      // Phase Walkers fade out (and stop trailing) while untargetable.
      (view.head.material as THREE.MeshBasicMaterial).opacity = e.phased ? 0.28 : 1;
      if (!e.phased) this.particles.emit(e.pos.x, e.pos.y);
    }
    for (const [id, view] of this.enemyViews) {
      if (!seen.has(id)) {
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
          head: new THREE.Mesh(this.roundedGeo, this.interceptorHeadMat),
          marker: new THREE.LineSegments(markerGeo, this.markerMat),
        };
        view.head.scale.set(2.8, 2.8, 1);
        this.scene.add(view.head, view.marker);
        this.interceptorViews.set(it.id, view);
      }
      view.head.position.set(it.pos.x, it.pos.y, 2);
      this.particles.emit(it.pos.x, it.pos.y);
    }
    for (const [id, view] of this.interceptorViews) {
      if (!seen.has(id)) {
        this.scene.remove(view.head, view.marker);
        view.marker.geometry.dispose();
        this.interceptorViews.delete(id);
      }
    }
  }

  private syncExplosions(state: GameState): void {
    const seen = new Set<number>();
    for (const ex of state.explosions) {
      seen.add(ex.id);
      let view = this.explosionViews.get(ex.id);
      if (!view) {
        view = {
          disc: new THREE.Mesh(
            this.discGeo,
            new THREE.MeshBasicMaterial({
              color: COLORS.explosion,
              transparent: true,
              opacity: 0.85,
            }),
          ),
          ring: new THREE.Mesh(
            this.ringGeo,
            new THREE.MeshBasicMaterial({ color: COLORS.explosionRing }),
          ),
        };
        view.disc.position.set(ex.pos.x, ex.pos.y, 3);
        view.ring.position.set(ex.pos.x, ex.pos.y, 3.1);
        this.scene.add(view.disc, view.ring);
        this.explosionViews.set(ex.id, view);
      }
      const r = Math.max(explosionRadius(ex), 0.01);
      view.disc.scale.setScalar(r);
      view.ring.scale.setScalar(r * 1.12);
    }
    for (const [id, view] of this.explosionViews) {
      if (!seen.has(id)) {
        this.scene.remove(view.disc, view.ring);
        (view.disc.material as THREE.Material).dispose();
        (view.ring.material as THREE.Material).dispose();
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
    this.composer.setSize(lowW, lowH);

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
