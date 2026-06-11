import * as THREE from 'three';

/**
 * Pure-visual white particle field for missile trails. Lives entirely in the
 * render layer (may use Math.random — it never feeds back into the sim). A
 * fixed pool of points is recycled; each emitted particle drifts slightly and
 * fades out over its lifetime.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifes: Float32Array;
  private readonly alphas: Float32Array;
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

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: size } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uSize;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Spawn one particle at (x, y) with a small random drift. */
  emit(x: number, y: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = 4;
    this.velocities[i * 2] = (Math.random() - 0.5) * 6;
    this.velocities[i * 2 + 1] = (Math.random() - 0.5) * 6;
    this.ages[i] = 0;
    this.lifes[i] = this.life * (0.7 + Math.random() * 0.6);
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
  }
}
