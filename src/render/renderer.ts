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
import type { GameEvent, GameState, Vec2 } from '../core/types';

/** Internal render height in pixels; width follows the aspect ratio. Lower =
 *  chunkier pixels. Tune this one number to taste. */
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
  interceptorTrail: 0x2f6fb0,
  interceptorHead: 0xbfe0ff,
  targetMarker: 0x9fbfff,
  enemyTrail: 0x7a2030,
  enemyHead: 0xff5042,
  explosion: 0xffd24a,
  explosionRing: 0xff8c2a,
} as const;

interface EnemyView {
  trail: THREE.Line;
  head: THREE.Mesh;
}

interface InterceptorView {
  trail: THREE.Line;
  head: THREE.Mesh;
  marker: THREE.LineSegments;
}

interface ExplosionView {
  disc: THREE.Mesh;
  ring: THREE.Mesh;
}

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly composer: EffectComposer;

  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly interceptorViews = new Map<number, InterceptorView>();
  private readonly explosionViews = new Map<number, ExplosionView>();
  private readonly cityMeshes: THREE.Mesh[] = [];

  private shake = 0;

  // Shared geometries/materials (entities are added/removed constantly).
  private readonly headGeo = new THREE.CircleGeometry(1, 12);
  private readonly discGeo = new THREE.CircleGeometry(1, 32);
  private readonly ringGeo = new THREE.RingGeometry(0.92, 1, 32);
  private readonly enemyHeadMat = new THREE.MeshBasicMaterial({ color: COLORS.enemyHead });
  private readonly interceptorHeadMat = new THREE.MeshBasicMaterial({
    color: COLORS.interceptorHead,
  });
  private readonly enemyTrailMat = new THREE.LineBasicMaterial({
    color: COLORS.enemyTrail,
    transparent: true,
    opacity: 0.55,
  });
  private readonly interceptorTrailMat = new THREE.LineBasicMaterial({
    color: COLORS.interceptorTrail,
    transparent: true,
    opacity: 0.45,
  });
  private readonly markerMat = new THREE.LineBasicMaterial({
    color: COLORS.targetMarker,
    transparent: true,
    opacity: 0.8,
  });

  constructor(container: HTMLElement) {
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
    this.resize();
    window.addEventListener('resize', () => this.resize());
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
    }
  }

  render(state: GameState): void {
    this.syncCities(state);
    this.syncEnemies(state);
    this.syncInterceptors(state);
    this.syncExplosions(state);
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

    // Cannon: a chunky pixel turret — base block + short barrel.
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 3),
      new THREE.MeshBasicMaterial({ color: COLORS.cannon }),
    );
    base.position.set(CANNON.x, 1.5, 1);
    const barrel = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 3),
      new THREE.MeshBasicMaterial({ color: COLORS.cannon }),
    );
    barrel.position.set(CANNON.x, 4, 1);
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

  private cityGeometry(): THREE.ShapeGeometry {
    // Simple skyline: a trapezoid block cluster.
    const s = new THREE.Shape();
    s.moveTo(-5, 0);
    s.lineTo(-5, 2.4);
    s.lineTo(-2.4, 2.4);
    s.lineTo(-2.4, 4.2);
    s.lineTo(0.6, 4.2);
    s.lineTo(0.6, 3);
    s.lineTo(5, 3);
    s.lineTo(5, 0);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }

  private syncCities(state: GameState): void {
    if (this.cityMeshes.length === 0) {
      for (const city of state.cities) {
        const mesh = new THREE.Mesh(
          this.cityGeometry(),
          new THREE.MeshBasicMaterial({ color: COLORS.city }),
        );
        mesh.position.set(city.x, 0, 1);
        this.scene.add(mesh);
        this.cityMeshes.push(mesh);
      }
    }
    state.cities.forEach((city, i) => {
      const mesh = this.cityMeshes[i];
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(city.hp > 0 ? COLORS.city : COLORS.cityDead);
      mesh.scale.y = city.hp > 0 ? 1 : 0.45;
    });
  }

  private makeTrail(material: THREE.LineBasicMaterial): THREE.Line {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return new THREE.Line(geo, material);
  }

  private updateTrail(line: THREE.Line, from: Vec2, to: Vec2): void {
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, from.x, from.y, 0);
    attr.setXYZ(1, to.x, to.y, 0);
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  private syncEnemies(state: GameState): void {
    const seen = new Set<number>();
    for (const e of state.enemies) {
      seen.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (!view) {
        view = {
          trail: this.makeTrail(this.enemyTrailMat),
          head: new THREE.Mesh(this.headGeo, this.enemyHeadMat),
        };
        view.head.scale.setScalar(0.9);
        this.scene.add(view.trail, view.head);
        this.enemyViews.set(e.id, view);
      }
      this.updateTrail(view.trail, e.origin, e.pos);
      view.head.position.set(e.pos.x, e.pos.y, 2);
    }
    for (const [id, view] of this.enemyViews) {
      if (!seen.has(id)) {
        this.scene.remove(view.trail, view.head);
        view.trail.geometry.dispose();
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
          trail: this.makeTrail(this.interceptorTrailMat),
          head: new THREE.Mesh(this.headGeo, this.interceptorHeadMat),
          marker: new THREE.LineSegments(markerGeo, this.markerMat),
        };
        view.head.scale.setScalar(0.7);
        this.scene.add(view.trail, view.head, view.marker);
        this.interceptorViews.set(it.id, view);
      }
      this.updateTrail(view.trail, it.origin, it.pos);
      view.head.position.set(it.pos.x, it.pos.y, 2);
    }
    for (const [id, view] of this.interceptorViews) {
      if (!seen.has(id)) {
        this.scene.remove(view.trail, view.head, view.marker);
        view.trail.geometry.dispose();
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
    const w = window.innerWidth;
    const h = window.innerHeight;
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
