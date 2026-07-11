import { worldOf } from '../core/balance';
import type { RunState } from '../core/run';
import {
  BUILDING_NODES,
  getNode,
  isRevealed,
  isUnlocked,
  missingRequirement,
  nodeTier,
  nextPrice,
  reqId,
  reqLevel,
  TREE,
  TURRET_NODES,
  TURRET_TWIN_NODES,
  type Currency,
  type TreeBranch,
  type TreeNode,
} from '../core/tree';
import { formatAmount, nodeDescription, nodeName, t } from './i18n';

const CURRENCY_ICON: Record<Currency, string> = { scrap: '⬡', cores: '◆' };

function bankOf(run: RunState, cur: Currency): number {
  return cur === 'cores' ? run.cores : run.scrap;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Pixel layout: nodes sit at (col*GAP_X, row*GAP_Y) around the core at (0,0).
 *  Gaps are generous relative to the node box so the graph reads as islands
 *  connected by lines, not a packed grid. */
const GAP_X = 176;
const GAP_Y = 130;
const NODE_W = 116;
const NODE_H = 50;

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

const BRANCH_COLOR: Record<TreeBranch, string> = {
  // SNKRX palette, matching the renderer's entity colours.
  core: '#dadada',
  cannon: '#019bd6',
  economy: '#facf00',
  city: '#8bbf40',
  automation: '#8e559e',
  tech: '#f07021',
};

/** Key nodes are the run-defining picks — they deploy something new (a
 *  turret, its twin, a support building) or unlock a mechanic (a manual
 *  ability, the auto-fire). They keep the full branch colour and a heavier
 *  outline; plain stat nodes get a muted stroke so the tree reads as
 *  landmarks among filler. */
function isKeyNode(node: TreeNode): boolean {
  return (
    node.id in TURRET_NODES ||
    node.id in TURRET_TWIN_NODES ||
    node.id in BUILDING_NODES ||
    node.id.startsWith('ability_') ||
    node.id === 'auto_fire' ||
    node.id === 'orbital_lance' ||
    node.id === 'aegis_dome'
  );
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A branch colour pulled most of the way toward the UI grey, for the muted
 *  stat-node strokes. */
function dimmed(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * 0.4 + 0x58 * 0.6);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

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
  private tooltipEl!: HTMLDivElement;
  /** Node currently showing its tooltip; a second tap on it buys. */
  private selectedId: string | null = null;
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
    onReset: () => void,
  ) {
    document.getElementById('day-next')!.addEventListener('click', () => {
      if (!this.run) return;
      this.hide();
      this.onNext(this.run);
    });
    this.wireResetButton(onReset);
  }

  /** Two-tap reset: the first tap arms the button (auto-disarms after 3s),
   *  the second wipes the run — no accidental resets from a stray tap. */
  private wireResetButton(onReset: () => void): void {
    const btn = document.getElementById('day-reset')! as HTMLButtonElement;
    let disarmTimer = 0;
    btn.addEventListener('click', () => {
      if (btn.classList.contains('armed')) {
        clearTimeout(disarmTimer);
        onReset();
        return;
      }
      btn.classList.add('armed');
      btn.textContent = t().eraseConfirm;
      disarmTimer = window.setTimeout(() => {
        btn.classList.remove('armed');
        btn.textContent = t().resetRun;
      }, 3000);
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(run: RunState, outcome: 'victory' | 'defeat', clearedNight: number): void {
    this.run = run;
    this.titleEl.textContent =
      outcome === 'victory' ? t().nightSurvived(clearedNight) : t().citiesLost;
    this.titleEl.className = outcome;
    let subtitle = outcome === 'victory' ? t().daySubtitleVictory : t().daySubtitleDefeat;
    // Crossing into a new world unlocks its tier — say so, loudly: the new
    // nodes sit at the tree's edges where a silent unlock goes unnoticed.
    if (outcome === 'victory' && worldOf(run.night) > worldOf(clearedNight)) {
      subtitle = t().tierUnlocked(worldOf(run.night));
    }
    this.subtitleEl.textContent = subtitle;
    // Unhide first so the container has a measurable size for centring.
    this.root.classList.remove('hidden');
    if (!this.built) this.buildTree();
    this.selectedId = null;
    this.hideTooltip();
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
      for (const req of node.requires) {
        const from = TREE.find((n) => n.id === reqId(req));
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
      box.setAttribute('stroke-width', isKeyNode(node) ? '3' : '2');
      g.appendChild(box);

      const name = document.createElementNS(SVG_NS, 'text');
      name.setAttribute('x', String(NODE_W / 2));
      name.setAttribute('y', '20');
      name.setAttribute('text-anchor', 'middle');
      name.classList.add('tree-name');
      // Key node names carry the branch colour too, so they pop even before
      // affordability lights the box up.
      if (isKeyNode(node)) name.style.fill = BRANCH_COLOR[node.branch];
      name.textContent = nodeName(node);
      g.appendChild(name);

      const cost = document.createElementNS(SVG_NS, 'text');
      cost.setAttribute('x', String(NODE_W / 2));
      cost.setAttribute('y', '38');
      cost.setAttribute('text-anchor', 'middle');
      cost.classList.add('tree-cost');
      g.appendChild(cost);

      const tip = document.createElementNS(SVG_NS, 'title');
      tip.textContent = nodeDescription(node);
      g.appendChild(tip);

      // Tap handling lives on the shop container's pointerup (see handleTap):
      // setPointerCapture there retargets `click` to the container, so a
      // per-node click listener never fires on desktop. We tag the node id
      // here and hit-test by coordinates instead.
      g.dataset.nodeId = node.id;

      viewport.appendChild(g);
      this.nodeEls.set(node.id, { box, cost });
    }

    this.shopEl.replaceChildren(svg);

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'node-tooltip hidden';
    this.shopEl.appendChild(this.tooltipEl);

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
    this.positionTooltip();
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
      // A clean single-pointer release with no movement is a tap on a node.
      const wasTap = e.type === 'pointerup' && this.pointers.size === 1 && !this.dragMoved;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (this.pointers.size === 2) this.startPinch();
      if (wasTap) this.handleTap(e.clientX, e.clientY);
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

  /**
   * Resolve which node sits under the released pointer and act on it. Done by
   * hit-testing coordinates (not the event target) because the container holds
   * pointer capture, which retargets `click`/`pointerup` away from the node.
   */
  private handleTap(clientX: number, clientY: number): void {
    const hit = document.elementFromPoint(clientX, clientY);
    const g = hit?.closest('[data-node-id]') as SVGGElement | null;
    if (!g) {
      // Tapping the tree background (not a node) dismisses an open tooltip.
      if (this.selectedId) {
        this.selectedId = null;
        this.hideTooltip();
      }
      return;
    }
    const node = TREE.find((n) => n.id === g.dataset.nodeId);
    if (!node) return;
    if (this.selectedId !== node.id) {
      this.select(node); // first tap: show the tooltip
    } else {
      this.tryBuy(node); // second tap on the same node: buy
    }
  }

  // --- tooltip (tap to show, tap again to buy) ---

  private select(node: TreeNode): void {
    this.selectedId = node.id;
    this.updateTooltipContent();
    this.tooltipEl.classList.remove('hidden');
    this.positionTooltip();
  }

  private hideTooltip(): void {
    if (this.tooltipEl) this.tooltipEl.classList.add('hidden');
  }

  private updateTooltipContent(): void {
    const run = this.run!;
    const node = TREE.find((n) => n.id === this.selectedId);
    if (!node) return;
    const level = run.upgrades[node.id] ?? 0;
    const price = nextPrice(node, level);
    const cur = price?.currency ?? 'scrap';
    const cost = price?.amount ?? null;
    const icon = CURRENCY_ICON[cur];
    const bank = bankOf(run, cur);

    let status: string;
    if (node.branch === 'core') {
      status = `<span class="tt-core">${t().ttCore}</span>`;
    } else if (cost === null) {
      status = `<span class="tt-max">${t().ttMaxed(level, node.maxLevel)}</span>`;
    } else if (!isUnlocked(node, run.upgrades)) {
      // Name the graduation gate so the player knows exactly what to level.
      const missing = missingRequirement(node, run.upgrades);
      const gate = missing ? getNode(reqId(missing)) : undefined;
      status = `<span class="tt-locked">${
        missing && gate
          ? t().ttGateLocked(nodeName(gate), reqLevel(missing))
          : t().ttLocked
      }</span>`;
    } else if (nodeTier(node) > worldOf(run.night)) {
      status = `<span class="tt-locked">${t().ttTierLocked(nodeTier(node))}</span>`;
    } else if (bank >= cost) {
      status =
        `<span class="tt-buy">${t().ttPrice(icon, formatAmount(cost), level, node.maxLevel)}</span>` +
        `<span class="tt-hint">${t().ttBuyHint}</span>`;
    } else {
      status = `<span class="tt-poor">${t().ttNeedMore(icon, formatAmount(cost), cur, level, node.maxLevel)}</span>`;
    }

    this.tooltipEl.innerHTML =
      `<div class="tt-name">${nodeName(node)}</div>` +
      `<div class="tt-desc">${nodeDescription(node)}</div>` +
      `<div class="tt-status">${status}</div>`;
  }

  /** Keep the tooltip pinned above the selected node as the view pans/zooms. */
  private positionTooltip(): void {
    if (!this.selectedId || this.tooltipEl.classList.contains('hidden')) return;
    const node = TREE.find((n) => n.id === this.selectedId);
    if (!node) return;
    const p = this.nodePx(node);
    const cx = this.tx + p.x * this.scale;
    const nodeTop = this.ty + (p.y - NODE_H / 2) * this.scale;

    const w = this.tooltipEl.offsetWidth;
    const h = this.tooltipEl.offsetHeight;
    const cw = this.shopEl.clientWidth;
    let left = cx - w / 2;
    left = Math.max(6, Math.min(cw - w - 6, left));
    let top = nodeTop - h - 10;
    if (top < 6) top = this.ty + (p.y + NODE_H / 2) * this.scale + 10; // flip below
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  // --- state refresh ---

  private refresh(): void {
    const run = this.run!;
    this.bankEl.textContent = `⬡ ${formatAmount(run.scrap)}    ◆ ${run.cores}`;

    for (const node of TREE) {
      const els = this.nodeEls.get(node.id)!;
      const level = run.upgrades[node.id] ?? 0;
      // Three gates, shown differently: nodes with an UNSTARTED prereq stay
      // entirely hidden (fog — the tree unfolds one step ahead of ownership);
      // a revealed node behind a graduation gate ("prereq at level n") is a
      // locked silhouette naming its gate; and a prereq-met node in a
      // not-yet-reached TIER is teased the same way — playtest finding:
      // fully hiding tiers made the world-2 unlock invisible.
      const revealed = node.branch === 'core' || isRevealed(node, run.upgrades);
      const prereqMet = isUnlocked(node, run.upgrades);
      const tierOpen = nodeTier(node) <= worldOf(run.night);
      const price = nextPrice(node, level);
      const color = BRANCH_COLOR[node.branch];
      const cost = price?.amount ?? null;
      const icon = CURRENCY_ICON[price?.currency ?? 'scrap'];
      const bank = price ? bankOf(run, price.currency) : 0;
      const g = els.box.parentElement!;

      if (!revealed) {
        g.setAttribute('display', 'none');
        if (this.selectedId === node.id) {
          this.selectedId = null;
          this.hideTooltip();
        }
        continue;
      }
      g.setAttribute('display', 'inline');

      const key = isKeyNode(node);
      let fill = 'rgba(24,24,24,0.92)';
      let stroke = '#404040';
      let opacity = '1';
      let costText: string;
      let costColor = ''; // '' = the default .tree-cost grey

      if (node.branch === 'core') {
        stroke = color;
        costText = t().costCore;
      } else if (!prereqMet) {
        // Graduation gate: revealed but locked until the prereq levels up.
        const missing = missingRequirement(node, run.upgrades);
        stroke = '#333333';
        opacity = '0.45';
        costText = t().costGateLocked(reqLevel(missing ?? node.requires[0]!));
      } else if (!tierOpen) {
        // Teased: visible so the player knows what the next world opens,
        // but unmistakably locked until its world is reached.
        stroke = '#333333';
        opacity = '0.45';
        costText = t().costTierLocked(nodeTier(node));
      } else if (cost === null) {
        // Maxed: the box fills with its branch colour so finished nodes read
        // at a glance.
        stroke = color;
        fill = withAlpha(color, 0.3);
        costText = t().costMax(level);
      } else if (bank >= cost) {
        // Importance carries the colour: key nodes glow full-strength, stat
        // nodes get a muted version of their branch.
        stroke = key ? color : dimmed(color);
        costText = `${icon}${formatAmount(cost)} · ${level}/${node.maxLevel}`;
      } else {
        // Unaffordable: red price so it can't be mistaken for a buyable node.
        // Key nodes keep their colour identity, just dimmed as a whole.
        stroke = key ? color : '#404040';
        opacity = key ? '0.55' : '0.8';
        costText = `${icon}${formatAmount(cost)} · ${level}/${node.maxLevel}`;
        costColor = '#e91d39';
      }

      els.box.setAttribute('fill', fill);
      els.box.setAttribute('stroke', stroke);
      g.setAttribute('opacity', opacity);
      els.cost.textContent = costText;
      els.cost.style.fill = costColor; // inline style outranks the class rule
    }

    for (const { line, to } of this.lineEls) {
      // A line only exists once its destination node is revealed.
      if (!isRevealed(to, run.upgrades)) {
        line.setAttribute('display', 'none');
        continue;
      }
      line.setAttribute('display', 'inline');
      const bought = (run.upgrades[to.id] ?? 0) > 0;
      line.setAttribute('stroke', bought ? BRANCH_COLOR[to.branch] : '#383838');
      line.setAttribute('opacity', bought ? '0.9' : '0.5');
    }
  }

  private tryBuy(node: TreeNode): void {
    const run = this.run!;
    if (node.branch === 'core') return;
    const level = run.upgrades[node.id] ?? 0;
    if (!isUnlocked(node, run.upgrades, worldOf(run.night))) return;
    const price = nextPrice(node, level);
    if (price === null) return;
    if (bankOf(run, price.currency) < price.amount) return;
    if (price.currency === 'cores') run.cores -= price.amount;
    else run.scrap -= price.amount;
    run.upgrades[node.id] = level + 1;
    this.onPurchase(run);
    this.refresh();
    this.updateTooltipContent(); // reflect new level / next cost / maxed
    this.positionTooltip();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
