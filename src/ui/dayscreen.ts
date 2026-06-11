import type { RunState } from '../core/run';
import { isUnlocked, nextCost, TREE, type TreeBranch, type TreeNode } from '../core/tree';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Pixel layout: nodes sit at (col*GAP_X, row*GAP_Y) around the core at (0,0). */
const GAP_X = 132;
const GAP_Y = 96;
const NODE_W = 116;
const NODE_H = 50;

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

const BRANCH_COLOR: Record<TreeBranch, string> = {
  core: '#cfd6e8',
  cannon: '#4aa0ff',
  economy: '#ffdc50',
  city: '#49d17a',
};

/**
 * Between-night Day screen. Renders the skill tree as one connected graph
 * (every branch grows from the central COMMAND core) inside a pan/zoomable
 * SVG viewport: drag to pan, wheel/pinch/buttons to zoom, tap a node to buy.
 */
export class DayScreen {
  private readonly root = document.getElementById('dayscreen')!;
  private readonly titleEl = document.getElementById('day-title')!;
  private readonly subtitleEl = document.getElementById('day-subtitle')!;
  private readonly bankEl = document.getElementById('day-bank')!;
  private readonly shopEl = document.getElementById('day-shop')!;
  private run: RunState | null = null;

  private viewport!: SVGGElement;
  private readonly nodeEls = new Map<string, { box: SVGRectElement; cost: SVGTextElement }>();
  private readonly lineEls: { line: SVGLineElement; to: TreeNode }[] = [];
  private built = false;

  // pan/zoom transform state
  private tx = 0;
  private ty = 0;
  private scale = 0.9;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private dragMoved = false;

  constructor(
    private readonly onPurchase: (run: RunState) => void,
    private readonly onNext: (run: RunState) => void,
  ) {
    document.getElementById('day-next')!.addEventListener('click', () => {
      if (!this.run) return;
      this.hide();
      this.onNext(this.run);
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(run: RunState, outcome: 'victory' | 'defeat', clearedNight: number): void {
    this.run = run;
    this.titleEl.textContent =
      outcome === 'victory' ? `NIGHT ${clearedNight} SURVIVED` : 'CITIES LOST';
    this.titleEl.className = outcome;
    this.subtitleEl.textContent =
      outcome === 'victory'
        ? 'Spend scrap on your skill tree, then push on.'
        : 'You held what you could. Spend, then try again.';
    // Unhide first so the container has a measurable size for centring.
    this.root.classList.remove('hidden');
    if (!this.built) this.buildTree();
    this.refresh();
  }

  private hide(): void {
    this.root.classList.add('hidden');
  }

  private nodePx(node: TreeNode): { x: number; y: number } {
    return { x: node.col * GAP_X, y: node.row * GAP_Y };
  }

  private buildTree(): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('tree-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    const viewport = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(viewport);
    this.viewport = viewport;

    // Connection lines first (under the nodes).
    for (const node of TREE) {
      for (const reqId of node.requires) {
        const from = TREE.find((n) => n.id === reqId);
        if (!from) continue;
        const a = this.nodePx(from);
        const b = this.nodePx(node);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(a.x));
        line.setAttribute('y1', String(a.y));
        line.setAttribute('x2', String(b.x));
        line.setAttribute('y2', String(b.y));
        line.setAttribute('stroke-width', '3');
        viewport.appendChild(line);
        this.lineEls.push({ line, to: node });
      }
    }

    // Nodes.
    for (const node of TREE) {
      const p = this.nodePx(node);
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('transform', `translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`);
      g.style.cursor = 'pointer';

      const box = document.createElementNS(SVG_NS, 'rect');
      box.setAttribute('width', String(NODE_W));
      box.setAttribute('height', String(NODE_H));
      box.setAttribute('rx', '8');
      box.setAttribute('stroke-width', '2');
      g.appendChild(box);

      const name = document.createElementNS(SVG_NS, 'text');
      name.setAttribute('x', String(NODE_W / 2));
      name.setAttribute('y', '20');
      name.setAttribute('text-anchor', 'middle');
      name.classList.add('tree-name');
      name.textContent = node.name;
      g.appendChild(name);

      const cost = document.createElementNS(SVG_NS, 'text');
      cost.setAttribute('x', String(NODE_W / 2));
      cost.setAttribute('y', '38');
      cost.setAttribute('text-anchor', 'middle');
      cost.classList.add('tree-cost');
      g.appendChild(cost);

      const tip = document.createElementNS(SVG_NS, 'title');
      tip.textContent = node.description;
      g.appendChild(tip);

      g.addEventListener('click', () => {
        if (this.dragMoved) return; // this was a pan/pinch, not a tap
        this.tryBuy(node);
      });

      viewport.appendChild(g);
      this.nodeEls.set(node.id, { box, cost });
    }

    this.shopEl.replaceChildren(svg);
    this.addZoomButtons();
    this.enablePanZoom();

    // Centre the core in the viewport.
    this.tx = this.shopEl.clientWidth / 2;
    this.ty = this.shopEl.clientHeight / 2;
    this.applyTransform();

    this.built = true;
  }

  // --- pan / zoom ---

  private applyTransform(): void {
    this.viewport.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
  }

  private zoomAround(px: number, py: number, factor: number): void {
    const ns = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    // Keep the point under (px,py) fixed while scaling.
    this.tx = px - ((px - this.tx) * ns) / this.scale;
    this.ty = py - ((py - this.ty) * ns) / this.scale;
    this.scale = ns;
    this.applyTransform();
  }

  private localPoint(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.shopEl.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  private enablePanZoom(): void {
    const el = this.shopEl;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragMoved = false;
      if (this.pointers.size === 2) this.startPinch();
    });

    el.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        if (Math.hypot(dx, dy) > 1) this.dragMoved = true;
        this.tx += dx;
        this.ty += dy;
        this.applyTransform();
      } else if (this.pointers.size === 2) {
        this.dragMoved = true;
        this.updatePinch();
      }
    });

    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (this.pointers.size === 2) this.startPinch();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { x, y } = this.localPoint(e.clientX, e.clientY);
        this.zoomAround(x, y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      },
      { passive: false },
    );
  }

  private twoPointers(): [{ x: number; y: number }, { x: number; y: number }] {
    const it = this.pointers.values();
    return [it.next().value!, it.next().value!];
  }

  private startPinch(): void {
    const [a, b] = this.twoPointers();
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchMid = this.localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  private updatePinch(): void {
    const [a, b] = this.twoPointers();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = this.localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (this.pinchDist > 0) {
      this.zoomAround(mid.x, mid.y, dist / this.pinchDist);
      // Also pan by the midpoint movement so two-finger drag works.
      this.tx += mid.x - this.pinchMid.x;
      this.ty += mid.y - this.pinchMid.y;
      this.applyTransform();
    }
    this.pinchDist = dist;
    this.pinchMid = mid;
  }

  private addZoomButtons(): void {
    const make = (label: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.className = 'zoom-btn';
      b.textContent = label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      // Don't let button taps start a pan.
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      return b;
    };
    const center = () => {
      const r = this.shopEl;
      return { x: r.clientWidth / 2, y: r.clientHeight / 2 };
    };
    const wrap = document.createElement('div');
    wrap.className = 'zoom-controls';
    wrap.append(
      make('+', () => {
        const c = center();
        this.zoomAround(c.x, c.y, 1.2);
      }),
      make('−', () => {
        const c = center();
        this.zoomAround(c.x, c.y, 1 / 1.2);
      }),
    );
    this.shopEl.appendChild(wrap);
  }

  // --- state refresh ---

  private refresh(): void {
    const run = this.run!;
    this.bankEl.textContent = `⬡ ${run.scrap}`;

    for (const node of TREE) {
      const els = this.nodeEls.get(node.id)!;
      const level = run.upgrades[node.id] ?? 0;
      const unlocked = isUnlocked(node, run.upgrades);
      const cost = nextCost(node, level);
      const color = BRANCH_COLOR[node.branch];

      let fill = 'rgba(20,22,34,0.92)';
      let stroke = '#3a3f5a';
      let opacity = '1';
      let costText: string;

      if (node.branch === 'core') {
        stroke = color;
        costText = 'CORE';
      } else if (cost === null) {
        stroke = color;
        costText = `✓ MAX · ${level}`;
      } else if (!unlocked) {
        opacity = '0.4';
        costText = '🔒';
      } else if (run.scrap >= cost) {
        stroke = color;
        costText = `⬡${cost} · ${level}/${node.maxLevel}`;
      } else {
        stroke = '#5a4f3a';
        opacity = '0.75';
        costText = `⬡${cost} · ${level}/${node.maxLevel}`;
      }

      els.box.setAttribute('fill', fill);
      els.box.setAttribute('stroke', stroke);
      els.box.parentElement!.setAttribute('opacity', opacity);
      els.cost.textContent = costText;
    }

    for (const { line, to } of this.lineEls) {
      const bought = (run.upgrades[to.id] ?? 0) > 0;
      line.setAttribute('stroke', bought ? BRANCH_COLOR[to.branch] : '#2c3046');
      line.setAttribute('opacity', bought ? '0.9' : '0.5');
    }
  }

  private tryBuy(node: TreeNode): void {
    const run = this.run!;
    if (node.branch === 'core') return;
    const level = run.upgrades[node.id] ?? 0;
    if (!isUnlocked(node, run.upgrades)) return;
    const cost = nextCost(node, level);
    if (cost === null || run.scrap < cost) return;
    run.scrap -= cost;
    run.upgrades[node.id] = level + 1;
    this.onPurchase(run);
    this.refresh();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
