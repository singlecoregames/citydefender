import { DT } from './core/balance';
import { Sim } from './core/sim';
import type { Command } from './core/types';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';

const container = document.getElementById('app')!;
const renderer = new Renderer(container);

let sim = new Sim(Date.now() >>> 0);
const hud = new Hud(() => {
  sim = new Sim(Date.now() >>> 0);
});

/** Commands queued between fixed-timestep ticks. */
let pending: Command[] = [];

container.addEventListener('pointerdown', (e) => {
  const world = renderer.screenToWorld(e.clientX, e.clientY);
  pending.push({ type: 'fire', x: world.x, y: world.y });
});

// Fixed timestep with accumulator; render every animation frame.
let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.25;

function frame(now: number): void {
  acc += Math.min((now - last) / 1000, MAX_FRAME);
  last = now;

  while (acc >= DT) {
    const events = sim.step(pending);
    pending = [];
    renderer.onEvents(events);
    hud.onEvents(events);
    acc -= DT;
  }

  renderer.render(sim.state);
  hud.render(sim.state);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
