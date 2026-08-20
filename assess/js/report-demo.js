import { DOMAIN_ORDER } from './framework.js';
import { dataUrls } from './data-urls.js';
import {
  computeProfile,
  getClusterRelevance,
  getDemonstrationPathwayMeta,
  getGradeById,
  loadRoleMapping,
  resolveClusterLevelBounds,
} from './role-profile.js';
import { loadTransversals } from './transversals.js';
import { renderTransversalRadar } from './report-radar.js';

/** Cluster order within each domain; matches all-domains.json */
const CLUSTER_ORDER = {
  Data: [
    'Foundational Data Skills',
    'Data Quality and Integrity',
    'Data-Driven Decision Making',
    'Responsible Data Sharing',
  ],
  AI: ['Foundational AI Skills', 'AI Governance and Ethics'],
  Digital: [
    'Foundational Digital Skills',
    'Digital Transformation',
    'Digital Leadership',
    'Responsible Information Practices',
  ],
  Innovation: [
    'Conditions for Innovation',
    'Understanding the Problem',
    'Doing the Work',
    'Making Change Stick',
  ],
};

const LEVEL_NAMES = ['Novice', 'Awareness', 'Working', 'Practitioner', 'Expert'];

let personasCache = null;

export async function loadDemoPersonas() {
  if (personasCache) return personasCache;
  const res = await fetch(dataUrls.demoPersonas);
  if (!res.ok) throw new Error('Could not load demo-personas.json');
  personasCache = await res.json();
  return personasCache;
}

function personaProfile(persona, roleMapping) {
  const answers = {};
  if (persona.demonstration_pathway) {
    answers.demonstration_pathway = persona.demonstration_pathway;
  }
  return computeProfile(roleMapping, persona.grade_id, answers, 'demo');
}

function isClusterInScope(roleMapping, profile, domain, cluster) {
  const rule = getClusterRelevance(roleMapping, domain, cluster);
  const minOrder = rule?.min_grade_order ?? 1;
  return profile.grade_order >= minOrder;
}

export function buildClusterRows(roleMapping, persona, profile) {
  const rows = [];

  for (const [key, rule] of Object.entries(roleMapping.clusterRelevance || {})) {
    const inScope = isClusterInScope(roleMapping, profile, rule.domain, rule.cluster);
    const level = persona.cluster_levels?.[key] ?? null;
    const bounds = inScope ? resolveClusterLevelBounds(roleMapping, profile, rule) : null;

    rows.push({
      key,
      domain: rule.domain,
      cluster: rule.cluster,
      inScope,
      level,
      bounds,
      atTarget: inScope && level != null && bounds && level >= bounds.focus_min,
      belowFocus: inScope && level != null && bounds && level < bounds.focus_min,
    });
  }

  rows.sort((a, b) => {
    const domainDiff = DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain);
    if (domainDiff !== 0) return domainDiff;
    const orderA = CLUSTER_ORDER[a.domain]?.indexOf(a.cluster) ?? 999;
    const orderB = CLUSTER_ORDER[b.domain]?.indexOf(b.cluster) ?? 999;
    return orderA - orderB;
  });

  return rows;
}

export function computeAreaDevelopmentSummary(clusterRows) {
  const inScope = clusterRows.filter((r) => r.inScope && r.level != null);
  const belowFocus = inScope.filter((r) => r.belowFocus);
  const atOrAboveFocus = inScope.filter((r) => r.atTarget);

  return {
    inScopeCount: inScope.length,
    belowFocusCount: belowFocus.length,
    atOrAboveFocusCount: atOrAboveFocus.length,
    priorities: belowFocus,
  };
}

function pathwayDisplayLabel(pathwayId, meta) {
  const labels = {
    specialist: 'Subject expert',
    leadership: 'Leads and supports others',
    mixed: 'Expert and team leader',
  };
  return labels[pathwayId] || meta?.label || pathwayId;
}

function pathwaySummaryPlain(pathwayId, meta) {
  if (meta?.summary && pathwayId !== 'leadership' && pathwayId !== 'mixed') {
    return meta.summary.replace(/\btransversal\b/gi, 'broader');
  }
  if (pathwayId === 'leadership') {
    return 'Your maturity is mainly shown through how you work with people: collaboration, judgement, supporting colleagues and listening to experts, rather than being the deepest technical authority on every topic.';
  }
  if (pathwayId === 'mixed') {
    return 'You show maturity both through deep knowledge in your area and through leading and supporting others, for example a profession lead who shapes team culture and brings in wider expertise.';
  }
  return meta?.summary || 'Your maturity is mainly shown through authoritative knowledge and expert practice in areas relevant to your role.';
}

function transversalHeading(isPrimary) {
  return isPrimary ? 'Broader skills: your main focus' : 'Broader skills';
}

function areasHeading(isPrimary) {
  return isPrimary ? 'Progression by area: your main focus' : 'Progression by area';
}

function getDevelopmentFocus(pathwayMeta, demonstrationPathway, areaSummary) {
  const pathway = demonstrationPathway || 'default';
  const priorityNames = areaSummary.priorities.map((r) => r.cluster);

  if (pathway === 'leadership') {
    return {
      focus: 'transversal',
      radarSize: 280,
      focusHeading: transversalHeading(true),
      focusLead:
        pathwaySummaryPlain('leadership', pathwayMeta) ||
        'These broader skills are the main way you demonstrate maturity in this role.',
      areasHeading: areasHeading(false),
      areasLead: buildAreasLead(
        areaSummary,
        priorityNames,
        'Domain areas below support your leadership remit. Practitioner-level breadth matters more than expert depth on every strand.'
      ),
    };
  }

  if (pathway === 'specialist') {
    return {
      focus: 'areas',
      radarSize: 200,
      focusHeading: transversalHeading(false),
      focusLead:
        'These broader skills provide context, but your maturity is mainly shown through topic areas in the progression section below.',
      areasHeading: areasHeading(true),
      areasLead: buildAreasLead(
        areaSummary,
        priorityNames,
        'Deep knowledge in relevant topic areas is your primary development signal.'
      ),
    };
  }

  if (pathway === 'mixed') {
    return {
      focus: 'balanced',
      radarSize: 240,
      focusHeading: transversalHeading(false),
      focusLead:
        pathwaySummaryPlain('mixed', pathwayMeta) ||
        'Balance leading and supporting others with deep knowledge in your area.',
      areasHeading: areasHeading(false),
      areasLead: buildAreasLead(
        areaSummary,
        priorityNames,
        'Develop both the broader skills above and topic-area maturity below.'
      ),
    };
  }

  return {
    focus: 'areas',
    radarSize: 220,
    focusHeading: transversalHeading(false),
    focusLead:
      'Broader skills are still emerging. Foundational topic areas that match your everyday work are the immediate development focus.',
    areasHeading: areasHeading(true),
    areasLead: buildAreasLead(
      areaSummary,
      priorityNames,
      'Build maturity in foundational clusters that match your everyday work.'
    ),
  };
}

function buildAreasLead(areaSummary, priorityNames, fallback) {
  if (areaSummary.inScopeCount === 0) {
    return 'No domain areas are in scope at this grade yet.';
  }

  if (areaSummary.belowFocusCount === 0) {
    return `${areaSummary.atOrAboveFocusCount} of ${areaSummary.inScopeCount} in-scope areas at or above your grade focus band. ${fallback}`;
  }

  const names = priorityNames.slice(0, 3).join(', ');
  const more =
    areaSummary.belowFocusCount > 3
      ? ` and ${areaSummary.belowFocusCount - 3} more`
      : '';

  return `${areaSummary.belowFocusCount} of ${areaSummary.inScopeCount} in-scope areas below your grade focus band. Prioritise ${names}${more}. ${fallback}`;
}

/** Red / amber / green relative to grade focus band for this cluster. */
export function clusterRagStatus(row) {
  if (!row.inScope || row.level == null || !row.bounds) return 'neutral';
  if (row.level < row.bounds.focus_min) return 'low';
  if (row.level >= row.bounds.focus_max) return 'high';
  return 'mid';
}

/** 5-segment focus-band bar used in the progression report and live assess progress. */
export function createClusterBar(row, levelNames) {
  const wrap = document.createElement('div');
  wrap.className = 'cluster-bar-wrap';

  if (!row.inScope) {
    wrap.classList.add('cluster-bar-wrap--out-of-scope');
    const label = document.createElement('span');
    label.className = 'cluster-bar-status';
    label.textContent = 'Not in scope';
    wrap.appendChild(label);
    return wrap;
  }

  if (row.level == null) {
    const label = document.createElement('span');
    label.className = 'cluster-bar-status';
    label.textContent = 'No score';
    wrap.appendChild(label);
    return wrap;
  }

  const track = document.createElement('div');
  const rag = clusterRagStatus(row);
  track.className = `cluster-bar-track cluster-bar-track--${rag}`;
  track.setAttribute('role', 'img');
  track.setAttribute(
    'aria-label',
    `Level ${row.level} (${levelNames[row.level - 1] || row.level})`
  );

  for (let i = 1; i <= 5; i++) {
    const seg = document.createElement('div');
    seg.className = 'cluster-bar-segment';
    seg.dataset.level = String(i);

    if (row.bounds && i >= row.bounds.focus_min && i <= row.bounds.focus_max) {
      seg.classList.add('cluster-bar-segment--focus');
    }
    if (row.bounds && i > row.bounds.max_level) {
      seg.classList.add('cluster-bar-segment--stretch');
    }
    if (i <= row.level) {
      seg.classList.add('cluster-bar-segment--filled');
    }
    if (i === row.level) {
      seg.classList.add('cluster-bar-segment--marker');
    }

    const segLabel = document.createElement('span');
    segLabel.className = 'cluster-bar-segment-label';
    segLabel.textContent = String(i);
    seg.appendChild(segLabel);

    track.appendChild(seg);
  }

  wrap.appendChild(track);

  const levelLabel = document.createElement('span');
  levelLabel.className = `cluster-bar-level cluster-bar-level--${rag}`;
  levelLabel.textContent = `${row.level} · ${levelNames[row.level - 1] || ''}`;
  wrap.appendChild(levelLabel);

  return wrap;
}

function renderClusterSection(container, domain, rows, levelNames) {
  const section = document.createElement('section');
  section.className = 'report-domain-section';

  const heading = document.createElement('h3');
  heading.className = 'report-domain-heading';
  heading.textContent = domain;
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'report-cluster-list';

  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'report-cluster-row';
    if (!row.inScope) item.classList.add('report-cluster-row--out-of-scope');
    if (row.belowFocus) item.classList.add('report-cluster-row--priority');

    const meta = document.createElement('div');
    meta.className = 'report-cluster-meta';

    const name = document.createElement('span');
    name.className = 'report-cluster-name';
    name.textContent = row.cluster;
    meta.appendChild(name);

    item.appendChild(meta);
    item.appendChild(createClusterBar(row, levelNames));
    list.appendChild(item);
  }

  section.appendChild(list);
  container.appendChild(section);
}

export function renderPersonaReport(container, {
  persona,
  roleMapping,
  transversalsData,
  levelNames = LEVEL_NAMES,
}) {
  container.innerHTML = '';

  const profile = personaProfile(persona, roleMapping);
  const grade = getGradeById(roleMapping, persona.grade_id);
  const pathwayMeta = persona.demonstration_pathway
    ? getDemonstrationPathwayMeta(roleMapping, persona.demonstration_pathway)
    : null;

  const clusterRows = buildClusterRows(roleMapping, persona, profile);
  const areaSummary = computeAreaDevelopmentSummary(clusterRows);
  const developmentFocus = getDevelopmentFocus(
    pathwayMeta,
    persona.demonstration_pathway,
    areaSummary
  );

  const header = document.createElement('header');
  header.className = 'report-persona-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'report-persona-title-row';

  const h1 = document.createElement('h1');
  h1.className = 'report-persona-name';
  h1.textContent = persona.name;
  titleRow.appendChild(h1);

  const badges = document.createElement('div');
  badges.className = 'report-persona-badges';
  badges.innerHTML = `<span class="report-badge">${grade?.grade_name || persona.grade_id}</span>`;
  if (pathwayMeta?.label) {
    badges.innerHTML += `<span class="report-badge report-badge-pathway">${pathwayDisplayLabel(persona.demonstration_pathway, pathwayMeta)}</span>`;
  }
  titleRow.appendChild(badges);
  header.appendChild(titleRow);

  const roleLine = document.createElement('p');
  roleLine.className = 'report-persona-role';
  roleLine.textContent = `${persona.role_title} · ${persona.organisation}`;
  header.appendChild(roleLine);

  const narrative = document.createElement('p');
  narrative.className = 'report-persona-narrative';
  narrative.textContent = persona.narrative;
  header.appendChild(narrative);

  container.appendChild(header);

  const focusPanel = document.createElement('section');
  focusPanel.className = `report-focus-panel report-focus-panel--${developmentFocus.focus}`;
  focusPanel.setAttribute('aria-labelledby', 'report-focus-heading');

  const focusHeading = document.createElement('h2');
  focusHeading.id = 'report-focus-heading';
  focusHeading.className = 'report-focus-heading';
  focusHeading.textContent = developmentFocus.focusHeading;
  focusPanel.appendChild(focusHeading);

  const focusLead = document.createElement('p');
  focusLead.className = 'report-focus-lead';
  focusLead.textContent = developmentFocus.focusLead;
  focusPanel.appendChild(focusLead);

  if (persona.interpretation) {
    const interp = document.createElement('p');
    interp.className = 'report-interpretation';
    interp.textContent = persona.interpretation;
    focusPanel.appendChild(interp);
  }

  const radarBlock = document.createElement('div');
  radarBlock.className = 'report-radar-block';

  const radarWrap = document.createElement('div');
  radarWrap.className = 'report-radar-wrap';
  radarWrap.appendChild(
    renderTransversalRadar({
      axes: transversalsData.transversals,
      levels: persona.transversal_levels,
      size: developmentFocus.radarSize,
      decorative: true,
    })
  );
  radarBlock.appendChild(radarWrap);

  const transCaption = document.createElement('h3');
  transCaption.className = 'report-transversal-heading';
  transCaption.id = 'report-transversal-scores-heading';
  transCaption.textContent = 'Broader skill levels';
  radarBlock.appendChild(transCaption);

  const transList = document.createElement('ul');
  transList.className = 'report-transversal-list';
  transList.id = 'report-transversal-scores';
  transList.setAttribute('aria-labelledby', 'report-transversal-scores-heading');
  for (const t of transversalsData.transversals) {
    const level = persona.transversal_levels[t.id];
    const li = document.createElement('li');
    if (level == null) {
      li.innerHTML = `<span class="report-trans-name">${t.name}</span> <span class="report-trans-level report-trans-level--neutral">No score</span>`;
    } else {
      const rag = level >= 4 ? 'high' : level >= 3 ? 'mid' : 'low';
      li.innerHTML = `<span class="report-trans-name">${t.name}</span> <span class="report-trans-level report-trans-level--${rag}">${level} · ${levelNames[level - 1] || ''}</span>`;
    }
    transList.appendChild(li);
  }
  radarBlock.appendChild(transList);
  focusPanel.appendChild(radarBlock);

  container.appendChild(focusPanel);

  const areasSection = document.createElement('section');
  areasSection.className = `report-areas-section report-areas-section--${developmentFocus.focus === 'areas' ? 'primary' : 'secondary'}`;
  areasSection.setAttribute('aria-labelledby', 'report-areas-heading');

  const clustersHeading = document.createElement('h2');
  clustersHeading.id = 'report-areas-heading';
  clustersHeading.className = 'report-section-heading';
  clustersHeading.textContent = developmentFocus.areasHeading;
  areasSection.appendChild(clustersHeading);

  const areasIntro = document.createElement('p');
  areasIntro.className = 'report-areas-intro';
  areasIntro.textContent = developmentFocus.areasLead;
  areasSection.appendChild(areasIntro);

  const legend = document.createElement('div');
  legend.className = 'report-legend';
  legend.innerHTML = `
    <span class="report-legend-item"><span class="report-legend-swatch report-legend-focus"></span> Focus band for grade</span>
    <span class="report-legend-item"><span class="report-legend-swatch report-legend-rag-low"></span> Below focus band</span>
    <span class="report-legend-item"><span class="report-legend-swatch report-legend-rag-mid"></span> Within focus band</span>
    <span class="report-legend-item"><span class="report-legend-swatch report-legend-rag-high"></span> At or above focus band</span>
    <span class="report-legend-item"><span class="report-legend-swatch report-legend-stretch"></span> Stretch zone</span>
  `;
  areasSection.appendChild(legend);

  const clustersWrap = document.createElement('div');
  clustersWrap.className = 'report-clusters';

  const byDomain = new Map();
  for (const row of clusterRows) {
    if (!byDomain.has(row.domain)) byDomain.set(row.domain, []);
    byDomain.get(row.domain).push(row);
  }

  for (const domain of DOMAIN_ORDER) {
    const rows = byDomain.get(domain);
    if (rows?.length) renderClusterSection(clustersWrap, domain, rows, levelNames);
  }

  areasSection.appendChild(clustersWrap);
  container.appendChild(areasSection);
}

export async function loadReportDependencies() {
  const [personasData, roleMapping, transversalsData] = await Promise.all([
    loadDemoPersonas(),
    loadRoleMapping(),
    loadTransversals(),
  ]);
  return { personasData, roleMapping, transversalsData };
}
