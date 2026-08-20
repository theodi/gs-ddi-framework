/**
 * Pure progression-report rollup: reviewed answers → persona-shaped payload
 * for renderPersonaReport. Importable from browser and Node.
 */

const LEVEL_MIN = 1;
const LEVEL_MAX = 5;

/** Display name (framework transversal_tags) → transversal id */
export const TRANSVERSAL_NAME_TO_ID = {
  'Systems Thinking': 'systems_thinking',
  'Digital Wellbeing': 'digital_wellbeing',
  'Ethical Practice': 'ethical_practice',
  'Collaborative Working': 'collaborative_working',
  'Continuous Learning': 'continuous_learning',
};

export function clampLevel(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, v));
}

function meanRound(levels) {
  if (!levels.length) return null;
  const avg = levels.reduce((s, n) => s + n, 0) / levels.length;
  return clampLevel(avg);
}

function tagToId(tag) {
  if (!tag) return null;
  if (TRANSVERSAL_NAME_TO_ID[tag]) return TRANSVERSAL_NAME_TO_ID[tag];
  const slug = String(tag).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug || null;
}

/**
 * Build a question lookup from an array of question metadata objects.
 * @param {Array<{ question_id: string, domain: string, cluster: string, transversal_tags?: string[] }>} questions
 */
export function indexQuestions(questions) {
  const map = new Map();
  for (const q of questions || []) {
    if (q?.question_id) map.set(q.question_id, q);
  }
  return map;
}

/**
 * Roll reviewed answers into cluster_levels and transversal_levels.
 *
 * @param {object} opts
 * @param {Array<{ question_id: string, domain?: string, level?: number|null, status?: string }>} opts.answers
 * @param {Map<string, object>|Record<string, object>|Array} opts.questionMeta - id → { domain, cluster, transversal_tags }
 * @returns {{ cluster_levels: Record<string, number>, transversal_levels: Record<string, number>, reviewed_count: number }}
 */
export function rollupAnswerLevels({ answers = [], questionMeta } = {}) {
  const meta = questionMeta instanceof Map
    ? questionMeta
    : Array.isArray(questionMeta)
      ? indexQuestions(questionMeta)
      : new Map(Object.entries(questionMeta || {}));

  const byCluster = new Map();
  const byTransversal = new Map();
  let reviewedCount = 0;

  for (const a of answers) {
    if (a.status !== 'reviewed' || a.level == null) continue;
    const level = clampLevel(a.level);
    if (level == null) continue;

    const q = meta.get(a.question_id);
    if (!q) continue;

    reviewedCount += 1;
    const domain = q.domain || a.domain;
    const cluster = q.cluster;
    if (domain && cluster) {
      const key = `${domain}|${cluster}`;
      if (!byCluster.has(key)) byCluster.set(key, []);
      byCluster.get(key).push(level);
    }

    for (const tag of q.transversal_tags || []) {
      const tid = tagToId(tag);
      if (!tid) continue;
      if (!byTransversal.has(tid)) byTransversal.set(tid, []);
      byTransversal.get(tid).push(level);
    }
  }

  const cluster_levels = {};
  for (const [key, levels] of byCluster) {
    const v = meanRound(levels);
    if (v != null) cluster_levels[key] = v;
  }

  const transversal_levels = {};
  for (const [tid, levels] of byTransversal) {
    const v = meanRound(levels);
    if (v != null) transversal_levels[tid] = v;
  }

  return { cluster_levels, transversal_levels, reviewed_count: reviewedCount };
}

/**
 * Light narrative / interpretation from rolled-up levels (no LLM).
 * Never includes a personal name; safe for later AI generation.
 */
export function buildProgressionCopy({
  roleTitle,
  clusterLevels = {},
  transversalLevels = {},
  demonstrationPathway = null,
  organisation = '',
} = {}) {
  const clusterEntries = Object.entries(clusterLevels);
  const topClusters = clusterEntries
    .slice()
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, level]) => `${key.split('|')[1] || key} (${level})`);

  const transEntries = Object.entries(transversalLevels);
  const topTrans = transEntries
    .slice()
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id, level]) => `${id.replace(/_/g, ' ')} (${level})`);

  const roleBit = roleTitle ? `${roleTitle}` : 'This role';
  const orgBit = organisation ? ` at ${organisation}` : '';

  let pathwayBit = '';
  if (demonstrationPathway === 'leadership') {
    pathwayBit = ' You mainly lead and support others. Broader skills carry more weight than being the deepest expert on every topic.';
  } else if (demonstrationPathway === 'specialist') {
    pathwayBit = ' You mainly work as a subject expert. Topic-area ratings are the primary signal.';
  } else if (demonstrationPathway === 'mixed') {
    pathwayBit = ' You combine subject expertise with leading and supporting others.';
  }

  const narrative = clusterEntries.length
    ? `${roleBit}${orgBit}. Rolled-up maturity from confirmed self-ratings: strongest areas ${topClusters.join(', ') || 'none yet'}.${
      topTrans.length ? ` Strongest broader skills: ${topTrans.join(', ')}.` : ''
    }${pathwayBit}`
    : `${roleBit}${orgBit}. No confirmed ratings yet. Complete questions to build a progression report.`;

  const interpretation = clusterEntries.length
    ? `Based on ${clusterEntries.length} area${clusterEntries.length === 1 ? '' : 's'} with confirmed ratings`
      + (transEntries.length ? ` and ${transEntries.length} broader skill${transEntries.length === 1 ? '' : 's'}` : '')
      + '.'
    : 'Confirm levels on selected questions to populate this report.';

  return { narrative, interpretation };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip personal names from narrative text (leading and mid-sentence first name).
 * "Jordan coordinates…" → "Coordinates…"
 */
export function anonymiseNarrative(text, name) {
  if (!text) return text || '';
  let out = String(text).trim();
  if (!name) {
    return out ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  }
  const full = String(name).trim();
  const parts = full.split(/\s+/).filter(Boolean);
  const first = parts[0] || '';

  for (const n of [full, first]) {
    if (!n) continue;
    const lead = new RegExp(`^${escapeRegExp(n)}\\s+`, 'i');
    if (lead.test(out)) {
      out = out.replace(lead, '');
      break;
    }
  }

  if (first) {
    // Drop remaining first-name tokens (e.g. ". Jordan briefs" → ". Briefs")
    out = out.replace(new RegExp(`([.!?]\\s*)${escapeRegExp(first)}\\s+`, 'gi'), (_, p) => p);
    out = out.replace(new RegExp(`\\b${escapeRegExp(first)}\\b\\s*`, 'gi'), '');
    out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
    out = out.replace(/([.!?]\s+)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }

  return out ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

/**
 * Build a persona-shaped object for renderPersonaReport.
 *
 * @param {object} opts
 * @param {object} opts.profile - session profile (grade_id, role_title, …)
 * @param {Array} opts.answers
 * @param {Map|Array|Record} opts.questionMeta
 * @param {string} [opts.id]
 * @param {string} [opts.name] - display name override
 * @param {string} [opts.organisation]
 * @param {string|null} [opts.demonstration_pathway]
 * @param {string} [opts.narrative] - optional pre-written narrative
 * @param {string} [opts.interpretation]
 */
export function generateProgressionPersona({
  profile = {},
  answers = [],
  questionMeta,
  id = 'progression',
  name = null,
  organisation = null,
  demonstration_pathway = null,
  narrative = null,
  interpretation = null,
} = {}) {
  const { cluster_levels, transversal_levels, reviewed_count } = rollupAnswerLevels({
    answers,
    questionMeta,
  });

  const displayName = name
    || profile.learner_name
    || profile.name
    || profile.role_title
    || 'Your progression report';

  const pathway = demonstration_pathway
    ?? profile.demonstration_pathway
    ?? null;

  const org = organisation ?? profile.organisation ?? '';

  const copy = buildProgressionCopy({
    roleTitle: profile.role_title || '',
    clusterLevels: cluster_levels,
    transversalLevels: transversal_levels,
    demonstrationPathway: pathway,
    organisation: org,
  });

  const rawNarrative = narrative || profile.narrative || copy.narrative;
  const personalName = name || profile.learner_name || profile.name || null;

  return {
    id,
    name: displayName,
    grade_id: profile.grade_id,
    demonstration_pathway: pathway,
    role_title: profile.role_title || '',
    organisation: org,
    narrative: anonymiseNarrative(rawNarrative, personalName),
    interpretation: interpretation || profile.interpretation || copy.interpretation,
    cluster_levels,
    transversal_levels,
    reviewed_count,
  };
}
