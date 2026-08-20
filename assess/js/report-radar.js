const LEVEL_MAX = 5;

/**
 * Renders a 5-axis radar chart for transversal maturity levels.
 * @param {object} opts
 * @param {Array<{ id: string, name: string }>} opts.axes - ordered transversal definitions
 * @param {Record<string, number>} opts.levels - level 1–5 per transversal id
 * @param {number} [opts.size=220]
 * @param {boolean} [opts.decorative=false] - if true, mark SVG as decorative (aria-hidden)
 */
export function renderTransversalRadar({ axes, levels, size = 220, decorative = false } = {}) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'transversal-radar');

  if (decorative) {
    svg.setAttribute('aria-hidden', 'true');
  } else {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Transversal maturity radar chart');
  }

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.34;
  const n = axes.length;
  if (!n) return svg;

  const angleStep = (Math.PI * 2) / n;
  const startAngle = -Math.PI / 2;

  function pointAt(axisIndex, value) {
    const angle = startAngle + axisIndex * angleStep;
    const r = (value / LEVEL_MAX) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  function axisEnd(axisIndex) {
    return pointAt(axisIndex, LEVEL_MAX);
  }

  const gridGroup = document.createElementNS(svgNs, 'g');
  gridGroup.setAttribute('class', 'radar-grid');

  for (let ring = 1; ring <= LEVEL_MAX; ring++) {
    const ringPts = axes.map((_, i) => {
      const p = pointAt(i, ring);
      return `${p.x},${p.y}`;
    });
    const polygon = document.createElementNS(svgNs, 'polygon');
    polygon.setAttribute('points', ringPts.join(' '));
    polygon.setAttribute('class', 'radar-ring');
    gridGroup.appendChild(polygon);
  }

  for (let i = 0; i < n; i++) {
    const end = axisEnd(i);
    const line = document.createElementNS(svgNs, 'line');
    line.setAttribute('x1', String(cx));
    line.setAttribute('y1', String(cy));
    line.setAttribute('x2', String(end.x));
    line.setAttribute('y2', String(end.y));
    line.setAttribute('class', 'radar-axis-line');
    gridGroup.appendChild(line);
  }

  svg.appendChild(gridGroup);

  const dataPts = axes.map((axis, i) => {
    const level = levels[axis.id] ?? 1;
    return pointAt(i, level);
  });

  const dataPoly = document.createElementNS(svgNs, 'polygon');
  dataPoly.setAttribute(
    'points',
    dataPts.map((p) => `${p.x},${p.y}`).join(' ')
  );
  dataPoly.setAttribute('class', 'radar-data');
  svg.appendChild(dataPoly);

  for (let i = 0; i < n; i++) {
    const p = dataPts[i];
    const dot = document.createElementNS(svgNs, 'circle');
    dot.setAttribute('cx', String(p.x));
    dot.setAttribute('cy', String(p.y));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', 'radar-dot');
    svg.appendChild(dot);
  }

  const labelGroup = document.createElementNS(svgNs, 'g');
  labelGroup.setAttribute('class', 'radar-labels');

  for (let i = 0; i < n; i++) {
    const labelRadius = radius + size * 0.1;
    const angle = startAngle + i * angleStep;
    const x = cx + labelRadius * Math.cos(angle);
    const y = cy + labelRadius * Math.sin(angle);

    const text = document.createElementNS(svgNs, 'text');
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(y));
    text.setAttribute('class', 'radar-label');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');

    const shortName = axes[i].name.replace(/^(\S+)\s.*/, '$1');
    text.textContent = shortName;
    const title = document.createElementNS(svgNs, 'title');
    title.textContent = `${axes[i].name}: level ${levels[axes[i].id] ?? '—'}`;
    text.appendChild(title);

    labelGroup.appendChild(text);
  }

  svg.appendChild(labelGroup);

  return svg;
}
