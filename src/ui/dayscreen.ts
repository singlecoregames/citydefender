import type { RunState } from '../core/run';
import { isUnlocked, nextCost, TREE, type TreeBranch, type TreeNode } from '../core/tree';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Pixel layout constants for the tree. */
const GAP_X = 132;
const GAP_Y = 92;
const NODE_W = 116;
const NODE_H = 50;
const PAD = 70;

const BRANCH_COLOR: Record<TreeBranch, string> = {
  cannon: '#4aa0ff',
  economy: '#ffdc50',
  city: '#49d17a',
};

/**
 * Between-night Day screen. Shows the night result and the branching skill
 * tree (rendered as a pannable SVG). Spends Scrap into the run's node levels;
 * calls back on purchase (to save) and on "Next Night".
 */
export class DayScreen {
  private readonly root = document.getElementById('dayscreen')!;
  private readonly titleEl = document.getElementById('day-title')!;
  private readonly subtitleEl = document.getElementById('day-subtitle')!;
  private readonly bankEl = document.getElementById('day-bank')!;
  private readonly shopEl = document.getElementById('day-shop')!;
  private run: RunState | null = null;

  /** Per-node DOM handles, rebuilt once; only attributes change on refresh. */
  private readonly nodeEls = new Map<string, { box: SVGRectElement; cost: SVGTextElement }>();
  private readonly lineEls: { line: SVGLineElement; to: TreeNode }[] = [];
  private built = false;
  /** Set true while a pan drag is in progress, to swallow the trailing click. */
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
    if (!this.built) this.buildTree();
    this.refresh();
    this.root.classList.remove('hidden');
  }

  private hide(): void {
    this.root.classList.add('hidden');
  }

  // --- layout ---

  private px(node: TreeNode): { x: number; y: number } {
    const cols = TREE.map((n) => n.col);
    const rows = TREE.map((n) => n.row);
    const minCol = Math.min(...cols);
    const minRow = Math.min(...rows);
    return {
      x: PAD + (node.col - minCol) * GAP_X + NODE_W / 2,
      y: PAD + (node.row - minRow) * GAP_Y + NODE_H / 2,
    };
  }

  private buildTree(): void {
    const cols = TREE.map((n) => n.col);
    const rows = TREE.map((n) => n.row);
    const width = PAD * 2 + (Math.max(...cols) - Math.min(...cols)) * GAP_X + NODE_W;
    const height = PAD * 2 + (Math.max(...rows) - Math.min(...rows)) * GAP_Y + NODE_H;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.classList.add('tree-svg');

    // Connection lines first (under the nodes).
    for (const node of TREE) {
      for (const reqId of node.requires) {
        const from = TREE.find((n) => n.id === reqId);
        if (!from) continue;
        const a = this.px(from);
        const b = this.px(node);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(a.x));
        line.setAttribute('y1', String(a.y));
        line.setAttribute('x2', String(b.x));
        line.setAttribute('y2', String(b.y));
        line.setAttribute('stroke-width', '3');
        svg.appendChild(line);
        this.lineEls.push({ line, to: node });
      }
    }

    // Nodes.
    for (const node of TREE) {
      const p = this.px(node);
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

      g.addEventListener('click', () => {
        if (this.dragMoved) return; // this was a pan, not a tap
        this.tryBuy(node);
      });
      // A title gives the full effect on hover/long-press.
      const tip = document.createElementNS(SVG_NS, 'title');
      tip.textContent = node.description;
      g.appendChild(tip);

      svg.appendChild(g);
      this.nodeEls.set(node.id, { box, cost });
    }

    this.shopEl.replaceChildren(svg);
    this.enablePan();
    this.built = true;
  }

  /** Drag to pan the (overflow-scrolled) tree container. */
  private enablePan(): void {
    const el = this.shopEl;
    let down = false;
    let sx = 0;
    let sy = 0;
    let sl = 0;
    let st = 0;
    el.addEventListener('pointerdown', (e) => {
      down = true;
      this.dragMoved = false;
      sx = e.clientX;
      sy = e.clientY;
      sl = el.scrollLeft;
      st = el.scrollTop;
    });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) this.dragMoved = true;
      el.scrollLeft = sl - (e.clientX - sx);
      el.scrollTop = st - (e.clientY - sy);
    });
    const up = () => {
      down = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
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

      if (cost === null) {
        fill = 'rgba(20,22,34,0.92)';
        stroke = color;
        costText = `✓ MAX · ${level}`;
      } else if (!unlocked) {
        opacity = '0.4';
        stroke = '#3a3f5a';
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
      const bought = (this.run!.upgrades[to.id] ?? 0) > 0;
      line.setAttribute('stroke', bought ? BRANCH_COLOR[to.branch] : '#2c3046');
      line.setAttribute('opacity', bought ? '0.9' : '0.5');
    }
  }

  private tryBuy(node: TreeNode): void {
    const run = this.run!;
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
