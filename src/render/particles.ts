import * as THREE from 'three';

/**
 * Pure-visual particle field for missile trails and death pops. Lives entirely
 * in the render layer (may use Math.random — it never feeds back into the
 * sim). A fixed pool of points is recycled; each emitted particle drifts
 * slightly and fades out over its lifetime. Particles carry a per-point colour
 * so trails and bursts match their entity's SNKRX palette colour.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly colors: Float32Array;
  private readonly tmpColor = new THREE.Color();
  private cursor = 0;

  constructor(
    private readonly capacity = 3000,
    private readonly life = 0.45,
    /** Point size in low-res buffer pixels (chunky to match the art). */
    size = 2.5,
  ) {
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 2);
    this.ages = new Float32Array(capacity).fill(Infinity);
    this.lifes = new Float32Array(capacity).fill(life);
    this.alphas = new Float32Array(capacity);
    this.colors = new Float32Array(capacity * 3).fill(1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: size } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uSize;
        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(vColor, vAlpha);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Spawn one particle at (x, y) with a small random drift. */
  emit(x: number, y: number, color = 0xdadada, speed = 6): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    // Behind the missile heads (z=2) so trails read as a tail, not a cover.
    this.positions[i * 3 + 2] = 1.5;
    this.velocities[i * 2] = (Math.random() - 0.5) * speed;
    this.velocities[i * 2 + 1] = (Math.random() - 0.5) * speed;
    this.ages[i] = 0;
    this.lifes[i] = this.life * (0.7 + Math.random() * 0.6);
    this.tmpColor.setHex(color);
    this.colors[i * 3] = this.tmpColor.r;
    this.colors[i * 3 + 1] = this.tmpColor.g;
    this.colors[i * 3 + 2] = this.tmpColor.b;
  }

  /** SNKRX-style death pop: a small shower of squares in the entity's colour. */
  burst(x: number, y: number, color: number, count = 12): void {
    for (let n = 0; n < count; n++) this.emit(x, y, color, 55);
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const age = this.ages[i]!;
      if (age === Infinity) continue;
      const next = age + dt;
      if (next >= this.lifes[i]!) {
        this.ages[i] = Infinity;
        this.alphas[i] = 0;
        continue;
      }
      this.ages[i] = next;
      this.positions[i * 3] = this.positions[i * 3]! + this.velocities[i * 2]! * dt;
      this.positions[i * 3 + 1] = this.positions[i * 3 + 1]! + this.velocities[i * 2 + 1]! * dt;
      this.alphas[i] = 1 - next / this.lifes[i]!;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }
}
