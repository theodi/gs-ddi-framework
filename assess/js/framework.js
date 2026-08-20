import {
  DESCRIPTOR_VOICE_CANONICAL,
  DESCRIPTOR_VOICE_SELF,
  getDescriptorDisplayText,
} from './descriptor-voice.js';

export const SOURCE_CLASS = { source: 'source', derived: 'derived', inferred: 'inferred' };
export { DESCRIPTOR_VOICE_CANONICAL, DESCRIPTOR_VOICE_SELF, getDescriptorDisplayText } from './descriptor-voice.js';

/** Canonical domain order across views and reports. */
export const DOMAIN_ORDER = ['Digital', 'Data', 'AI', 'Innovation'];

export function domainSortIndex(name) {
  const idx = DOMAIN_ORDER.indexOf(name);
  return idx === -1 ? 999 : idx;
}

export function rowTags(row) {
  return Array.isArray(row.transversal_tags) ? row.transversal_tags : [];
}

export function buildTransversalTagsEl(tags) {
  const wrap = document.createElement('div');
  wrap.className = 'transversal-tags';
  for (const tag of tags) {
    const span = document.createElement('span');
    span.className = 'transversal-tag';
    span.textContent = tag;
    wrap.appendChild(span);
  }
  return wrap;
}

export function buildSectionTypeTag(sectionType) {
  const span = document.createElement('span');
  span.className = 'section-type-tag';
  span.textContent = (sectionType || '').toLowerCase();
  return span;
}

export function buildQuestionMetaTags(sectionType, row, { onTransversalClick } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'question-meta-tags';
  wrap.appendChild(buildSectionTypeTag(sectionType));
  for (const tag of rowTags(row)) {
    const span = document.createElement('span');
    span.className = 'transversal-tag';
    span.textContent = tag;
    if (onTransversalClick) {
      span.classList.add('transversal-tag--clickable');
      span.setAttribute('role', 'button');
      span.tabIndex = 0;
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        onTransversalClick(tag);
      });
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onTransversalClick(tag);
        }
      });
    }
    wrap.appendChild(span);
  }
  return wrap;
}

export function countStrandQuestions(strand) {
  return (strand.sections || []).reduce((n, section) => n + (section.rows?.length || 0), 0);
}

export function createStrandCollapsible(strand, meta) {
  const details = document.createElement('details');
  details.className = 'strand-collapse';

  const summary = document.createElement('summary');
  summary.className = 'strand-collapse-summary';

  const title = document.createElement('span');
  title.className = 'strand-collapse-title';
  title.textContent = strand.strand_name || 'Strand';

  const main = document.createElement('span');
  main.className = 'strand-collapse-main';
  main.appendChild(title);

  const count = document.createElement('span');
  count.className = 'strand-collapse-count';
  count.textContent = `${countStrandQuestions(strand)} questions`;
  main.appendChild(count);

  summary.appendChild(main);

  if (meta.cluster) {
    const cluster = document.createElement('button');
    cluster.type = 'button';
    cluster.className = 'strand-cluster-tag';
    cluster.textContent = meta.cluster;
    cluster.title = 'View learning outcomes for this area';
    cluster.setAttribute('aria-label', `Learning outcomes: ${meta.cluster}`);
    if (meta.domain) cluster.dataset.domain = meta.domain;
    cluster.dataset.cluster = meta.cluster;
    summary.appendChild(cluster);
  }

  const body = document.createElement('div');
  body.className = 'strand-collapse-body';
  details.appendChild(summary);
  details.appendChild(body);

  if (strand.strand_definition) {
    const def = document.createElement('p');
    def.className = 'strand-definition';
    def.textContent = strand.strand_definition;
    body.appendChild(def);
  }

  return { details, body };
}

export function collectStrands(data) {
  const strands = [];

  if (Array.isArray(data.domains)) {
    for (const domain of data.domains) {
      for (const cluster of domain.clusters || []) {
        for (const skill of cluster.skills || []) {
          strands.push({
            strand: skill,
            meta: {
              domain: domain.domain_name,
              cluster: cluster.cluster_name,
            },
          });
        }
      }
    }
    return strands;
  }

  if (data.sections) {
    strands.push({
      strand: {
        strand_name: data.framework || data.strand_name,
        strand_definition: data.strand_definition || data.description,
        sections: data.sections,
      },
      meta: {},
    });
  }

  return strands;
}

export function domainSlug(name) {
  return (name || 'framework')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function groupStrandsByDomain(data) {
  const groups = [];
  const indexByName = new Map();
  const descriptions = new Map();

  if (Array.isArray(data.domains)) {
    for (const domain of data.domains) {
      if (domain.domain_description) {
        descriptions.set(domain.domain_name, domain.domain_description);
      }
    }
  }

  for (const item of collectStrands(data)) {
    const name = item.meta.domain || 'Framework';
    if (!indexByName.has(name)) {
      indexByName.set(name, groups.length);
      groups.push({
        name,
        id: domainSlug(name),
        description: descriptions.get(name) || '',
        strands: [],
      });
    }
    groups[indexByName.get(name)].strands.push(item);
  }

  groups.sort((a, b) => domainSortIndex(a.name) - domainSortIndex(b.name));

  return groups;
}

export function renderDomainNav(domains) {
  const navEl = document.getElementById('domain-nav');
  if (!navEl) return;

  navEl.innerHTML = '';
  if (domains.length <= 1) {
    navEl.hidden = true;
    return;
  }

  for (const domain of domains) {
    const link = document.createElement('a');
    link.href = `#domain-${domain.id}`;
    link.textContent = domain.name;
    navEl.appendChild(link);
  }

  navEl.hidden = false;
}

export function createDomainSection(domain) {
  const section = document.createElement('section');
  section.className = 'domain-block';
  section.id = `domain-${domain.id}`;

  const heading = document.createElement('h2');
  heading.className = 'domain-name';
  heading.textContent = domain.name;
  section.appendChild(heading);

  if (domain.description) {
    const desc = document.createElement('p');
    desc.className = 'domain-description';
    desc.textContent = domain.description;
    section.appendChild(desc);
  }

  const strandsContainer = document.createElement('div');
  strandsContainer.className = 'domain-strands';
  section.appendChild(strandsContainer);

  return { section, strandsContainer };
}

export function validateFramework(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('File is not a valid JSON object.');
  }
  if (!Array.isArray(data.levels) || data.levels.length === 0) {
    throw new Error('JSON must include a non-empty "levels" array.');
  }
  const strands = collectStrands(data);
  if (strands.length === 0) {
    throw new Error('JSON must include "domains" with skills, or a top-level "sections" array.');
  }
  for (const { strand } of strands) {
    if (!Array.isArray(strand.sections) || strand.sections.length === 0) {
      throw new Error(`Strand "${strand.strand_name || 'unknown'}" has no sections.`);
    }
  }
}

export function getFrameworkMeta(data) {
  return {
    title: data.framework_name || data.framework || 'Framework',
    intro:
      data.framework_description ||
      data.strand_definition ||
      data.description ||
      '',
  };
}

export function strandKey(cluster, strandName) {
  return `${cluster}|${strandName}`;
}

export function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function questionId({ domain, cluster, strand, sectionType, index }) {
  return [
    slugify(domain),
    slugify(cluster),
    slugify(strand),
    slugify(sectionType),
    String(index),
  ].join('|');
}

export function collectQuestions(data) {
  const questions = [];
  for (const { strand, meta } of collectStrands(data)) {
    for (const section of strand.sections || []) {
      (section.rows || []).forEach((row, index) => {
        questions.push({
          row,
          meta,
          strand,
          sectionType: section.type,
          questionId: questionId({
            domain: meta.domain,
            cluster: meta.cluster,
            strand: strand.strand_name,
            sectionType: section.type,
            index,
          }),
        });
      });
    }
  }
  return questions;
}

export function buildSourceKeyLegendEl(sourceKey, options = {}) {
  if (!sourceKey || Object.keys(sourceKey).length === 0) return null;

  const {
    heading = 'Source key',
    intro = '',
    showKeys = true,
  } = options;

  const block = document.createElement('div');
  block.className = 'legend-block';

  const title = document.createElement('h4');
  title.textContent = heading;
  block.appendChild(title);

  if (intro) {
    const introEl = document.createElement('p');
    introEl.className = 'legend-intro';
    introEl.textContent = intro;
    block.appendChild(introEl);
  }

  const items = document.createElement('div');
  items.className = 'legend-items';
  for (const [key, label] of Object.entries(sourceKey)) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = `swatch ${SOURCE_CLASS[key] || key}`;
    const text = document.createElement('span');
    if (showKeys) {
      const strong = document.createElement('strong');
      strong.textContent = key;
      text.append(strong, document.createTextNode(`: ${label}`));
    } else {
      text.textContent = label;
    }
    item.append(swatch, text);
    items.appendChild(item);
  }
  block.appendChild(items);
  return block;
}

export function buildLegend(sourceKey) {
  const legend = document.getElementById('legend');
  if (!legend) return;

  legend.innerHTML = '';

  const sourceBlock = buildSourceKeyLegendEl(sourceKey);

  if (!sourceBlock) {
    legend.hidden = true;
    return;
  }

  legend.appendChild(sourceBlock);
  legend.hidden = false;
}

export function renderStrandHeader(strand, meta, container) {
  const block = document.createElement('article');
  block.className = 'strand-block';

  const name = document.createElement('h2');
  name.className = 'strand-name';
  name.textContent = strand.strand_name || 'Strand';
  block.appendChild(name);

  if (meta.cluster) {
    const metaEl = document.createElement('p');
    metaEl.className = 'strand-meta';
    metaEl.textContent = meta.cluster;
    block.appendChild(metaEl);
  } else if (meta.domain) {
    const metaEl = document.createElement('p');
    metaEl.className = 'strand-meta';
    metaEl.textContent = meta.domain;
    block.appendChild(metaEl);
  }

  const def = document.createElement('p');
  def.className = 'strand-definition';
  def.textContent = strand.strand_definition || '';
  block.appendChild(def);

  container.appendChild(block);
  return block;
}

export function buildLevelCell(descriptor, { voice = DESCRIPTOR_VOICE_CANONICAL } = {}) {
  const td = document.createElement('td');
  const src = descriptor?.source || 'inferred';
  td.className = `level-cell ${SOURCE_CLASS[src] || src}`;
  td.textContent = getDescriptorDisplayText(descriptor, voice);
  return td;
}

/**
 * Descriptor table for review: Level and Description with third/first person toggle.
 * @param {object} row
 * @param {{ levelNames?: string[], sourceKey?: object, levels?: number[], toggleId?: string }} [options]
 * @returns {HTMLElement}
 */
export function buildDescriptorReviewTable(row, { levelNames = [], sourceKey = {}, levels = [1, 2, 3, 4, 5], toggleId = 'default' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'review-descriptor-table-wrap';

  const byLevel = descriptorsByLevel(row);
  let activeVoice = DESCRIPTOR_VOICE_CANONICAL;

  const table = document.createElement('table');
  table.className = 'review-descriptor-table';

  const voiceToggle = document.createElement('div');
  voiceToggle.className = 'review-descriptor-voice-toggle';
  voiceToggle.setAttribute('role', 'group');
  voiceToggle.setAttribute('aria-label', 'Descriptor voice');

  const toggleName = `descriptor-voice-${toggleId}`;
  for (const [voice, label] of [
    [DESCRIPTOR_VOICE_CANONICAL, 'Third person'],
    [DESCRIPTOR_VOICE_SELF, 'First person'],
  ]) {
    const labelEl = document.createElement('label');
    labelEl.className = 'review-descriptor-voice-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = toggleName;
    input.value = voice;
    input.checked = voice === DESCRIPTOR_VOICE_CANONICAL;
    input.addEventListener('change', () => {
      if (input.checked) setVoice(voice);
    });
    labelEl.append(input, document.createTextNode(` ${label}`));
    voiceToggle.appendChild(labelEl);
  }

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  const levelTh = document.createElement('th');
  levelTh.textContent = 'Level';
  headRow.appendChild(levelTh);

  const descTh = document.createElement('th');
  descTh.className = 'review-descriptor-col-description';
  const descLabel = document.createElement('span');
  descLabel.className = 'review-descriptor-col-description-label';
  descLabel.textContent = 'Description';
  descTh.append(descLabel, voiceToggle);
  headRow.appendChild(descTh);

  thead.appendChild(headRow);
  table.appendChild(thead);

  const descCells = [];
  const tbody = document.createElement('tbody');
  for (const level of levels) {
    const tr = document.createElement('tr');
    const levelCell = document.createElement('th');
    levelCell.scope = 'row';
    const levelName = levelNames[level - 1] || `Level ${level}`;
    levelCell.textContent = `${level}: ${levelName}`;
    tr.appendChild(levelCell);

    const descriptor = byLevel[level];
    const descTd = buildLevelCell(descriptor, { voice: activeVoice });
    descCells.push({ td: descTd, descriptor });
    tr.appendChild(descTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  function setVoice(voice) {
    activeVoice = voice;
    for (const { td, descriptor } of descCells) {
      const src = descriptor?.source || 'inferred';
      td.className = `level-cell ${SOURCE_CLASS[src] || src}`;
      td.textContent = getDescriptorDisplayText(descriptor, voice);
    }
  }

  wrap.append(table);
  return wrap;
}

export function descriptorsByLevel(row) {
  return Object.fromEntries((row.descriptors || []).map((d) => [d.level, d]));
}

export const FRAMEWORK_SESSION_KEY = 'gs-framework-json';

export function saveFrameworkToSession(jsonText) {
  sessionStorage.setItem(FRAMEWORK_SESSION_KEY, jsonText);
}

export function readFrameworkFromSession() {
  const jsonText = sessionStorage.getItem(FRAMEWORK_SESSION_KEY);
  if (!jsonText) return null;
  return JSON.parse(jsonText);
}

export function setupViewerLoader({ onLoad, homePath = 'index.html' }) {
  const contentEl = document.getElementById('content');
  const errorEl = document.getElementById('error');

  function showError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
  }

  try {
    const data = readFrameworkFromSession();
    if (!data) {
      window.location.replace(homePath);
      return;
    }
    validateFramework(data);
    Promise.resolve(onLoad(data))
      .then(() => {
        if (contentEl) contentEl.hidden = false;
      })
      .catch((err) => {
        showError(err.message || 'Could not render framework.');
      });
  } catch (err) {
    showError(err.message || 'Could not load framework.');
  }
}
