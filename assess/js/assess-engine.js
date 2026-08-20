import { dataUrls } from './data-urls.js';
import { DOMAIN_ORDER } from './framework.js';
import { generateProgressionPersona } from './report-generate.js';

export const DOMAINS = DOMAIN_ORDER;
export const SELECTION_CAP = 12;
export const BASELINE_CAP = 40;

let frameworkCache = null;
let roleMappingCache = null;
let gatesCache = null;
let outcomesCache = null;
let dataReady = null;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  return res.json();
}

export async function ensureData() {
  if (!dataReady) {
    dataReady = Promise.all([
      fetchJson(dataUrls.framework).then((d) => { frameworkCache = d; }),
      fetchJson(dataUrls.roleMapping).then((d) => { roleMappingCache = d; }),
      fetchJson(dataUrls.assessGates).then((d) => { gatesCache = d; }),
      fetchJson(dataUrls.learningOutcomes).then((d) => { outcomesCache = d; }).catch(() => {
        outcomesCache = { clusters: [] };
      }),
    ]);
  }
  await dataReady;
}

export function loadFramework() {
  if (!frameworkCache) throw new Error('Framework data not loaded');
  return frameworkCache;
}

export function loadRoleMapping() {
  if (!roleMappingCache) throw new Error('Role mapping not loaded');
  return roleMappingCache;
}

export function loadAssessGates() {
  if (!gatesCache) throw new Error('Assess gates not loaded');
  return gatesCache;
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

export function collectDomainQuestions(domainName) {
  const data = loadFramework();
  const domain = data.domains.find((d) => d.domain_name === domainName);
  if (!domain) return [];

  const questions = [];
  for (const cluster of domain.clusters || []) {
    for (const strand of cluster.skills || []) {
      for (const section of strand.sections || []) {
        (section.rows || []).forEach((row, index) => {
          const id = questionId({
            domain: domain.domain_name,
            cluster: cluster.cluster_name,
            strand: strand.strand_name,
            sectionType: section.type,
            index,
          });
          questions.push({
            question_id: id,
            domain: domain.domain_name,
            cluster: cluster.cluster_name,
            strand: strand.strand_name,
            strand_definition: strand.strand_definition || '',
            section_type: section.type,
            question: row.question,
            descriptors: (row.descriptors || []).map((d) => ({
              level: d.level,
              level_name: d.level_name,
              text: d.text,
            })),
            transversal_tags: row.transversal_tags || [],
          });
        });
      }
    }
  }
  return questions;
}

function clampLevel(value, min = 1, max = 5) {
  return Math.min(max, Math.max(min, value));
}

export function computeProfile(gradeId, answers = {}) {
  const data = loadRoleMapping();
  const grade = data.grades.find((g) => g.grade_id === gradeId);
  if (!grade) return null;

  let ceiling = grade.base_ceiling;
  let focusMin = grade.base_focus_min;
  let focusMax = grade.base_focus_max;

  const ddiCentrality = answers.ddi_centrality || null;
  const influence = answers.influence || null;
  const demonstrationPathway = answers.demonstration_pathway || null;
  const pathwayMeta = demonstrationPathway
    ? data.demonstration_pathways?.[demonstrationPathway]
    : null;

  const ddiMod = ddiCentrality ? data.modifiers?.ddi_centrality?.[ddiCentrality] : null;
  if (ddiMod?.ceiling_delta) ceiling += ddiMod.ceiling_delta;
  if (ddiMod?.focus_max_bump) focusMax += ddiMod.focus_max_bump;

  const infMod = influence ? data.modifiers?.influence?.[influence] : null;
  if (infMod?.ceiling_delta) ceiling += infMod.ceiling_delta;

  ceiling = clampLevel(ceiling);
  focusMin = clampLevel(focusMin);
  focusMax = clampLevel(Math.max(focusMin, focusMax));
  focusMax = Math.min(focusMax, ceiling);

  const pathwayAllowed = grade.sort_order >= 2;
  const pathway = pathwayAllowed ? demonstrationPathway : null;

  return {
    grade_id: grade.grade_id,
    grade_name: grade.grade_name,
    grade_order: grade.sort_order,
    ddi_centrality: ddiCentrality,
    influence,
    demonstration_pathway: pathway,
    pathway_label: pathway ? (pathwayMeta?.label || null) : null,
    role_ceiling: ceiling,
    focus_min: focusMin,
    focus_max: focusMax,
    learner_name: String(answers.learner_name || answers.name || '').trim(),
    role_title: answers.role_title || '',
    organisation: answers.organisation || '',
    why: answers.why || '',
    notes: answers.notes || '',
  };
}

export function isQuestionVisibleForProfile(profile, q) {
  if (!profile) return true;
  const data = loadRoleMapping();
  const key = `${q.domain}|${q.cluster}`;
  const clusterRule = data.clusterRelevance?.[key];
  const clusterMin = clusterRule?.min_grade_order ?? 1;
  const override = data.questionOverrides?.[q.question_id];
  const effectiveMin = override?.min_grade_order ?? clusterMin;
  return profile.grade_order >= effectiveMin;
}

function clampBounds(maxLevel, focusMin, focusMax) {
  const max_level = clampLevel(maxLevel);
  let focus_min = clampLevel(focusMin);
  let focus_max = clampLevel(Math.max(focusMin, focusMax));
  focus_max = Math.min(focus_max, max_level);
  focus_min = Math.min(focus_min, focus_max);
  return { max_level, focus_min, focus_max };
}

export function resolveQuestionLevelBounds(profile, q) {
  if (!profile || !q) return null;
  const data = loadRoleMapping();
  const grade = data.grades.find((g) => g.grade_id === profile.grade_id);
  if (!grade) return null;

  const override = data.questionOverrides?.[q.question_id];
  const clusterRule = data.clusterRelevance?.[`${q.domain}|${q.cluster}`];
  const tier = override?.tier || clusterRule?.tier || 'professional';
  const tierLevels = data.levelExpectations?.[tier]?.[grade.grade_id];

  let maxLevel = tierLevels?.max_level ?? profile.role_ceiling;
  let focusMin = tierLevels?.focus_min ?? profile.focus_min;
  let focusMax = tierLevels?.focus_max ?? profile.focus_max;

  const sectionAdj = data.levelExpectations?.section_adjustments?.[tier]?.[q.section_type]?.[grade.grade_id];
  if (sectionAdj) {
    if (sectionAdj.max_level != null) maxLevel = sectionAdj.max_level;
    if (sectionAdj.focus_min != null) focusMin = sectionAdj.focus_min;
    if (sectionAdj.focus_max != null) focusMax = sectionAdj.focus_max;
  }

  if (override?.max_level != null) maxLevel = override.max_level;
  if (override?.focus_min != null) focusMin = override.focus_min;
  if (override?.focus_max != null) focusMax = override.focus_max;

  maxLevel = Math.min(maxLevel, profile.role_ceiling);
  return clampBounds(maxLevel, focusMin, focusMax);
}

export function descriptorsWithStretch(profile, q) {
  const bounds = resolveQuestionLevelBounds(profile, q);
  const maxLevel = bounds?.max_level ?? 5;
  return (q?.descriptors || []).map((d) => ({
    ...d,
    stretch: d.level > maxLevel,
  }));
}

export function visibleDomainQuestions(domain, profile) {
  return collectDomainQuestions(domain).filter((q) => isQuestionVisibleForProfile(profile, q));
}

export function getQuestionById(domain, qid) {
  return collectDomainQuestions(domain).find((q) => q.question_id === qid) || null;
}

export function allQuestionMeta() {
  const list = [];
  for (const domain of DOMAINS) list.push(...collectDomainQuestions(domain));
  return list;
}

export function domainMeta() {
  const gates = loadAssessGates();
  const fw = loadFramework();
  const outcomes = outcomesCache || { clusters: [] };
  const clusterSummaries = {};
  for (const c of outcomes.clusters || []) {
    if (c.key && c.summary) clusterSummaries[c.key] = c.summary;
  }

  return DOMAINS.map((name) => {
    const domain = (fw.domains || []).find((d) => d.domain_name === name);
    return {
      id: name,
      label: name,
      full_label: gates.domains?.[name]?.label || name,
      blurb: gates.domains?.[name]?.blurb || '',
      description: domain?.domain_description || '',
      cluster_summaries: Object.fromEntries(
        Object.entries(clusterSummaries).filter(([key]) => key.startsWith(`${name}|`)),
      ),
    };
  });
}

export function levelNames() {
  const fw = loadFramework();
  return (fw.levels || []).map((l) => l.name);
}

export function buildMeta() {
  const roleMapping = loadRoleMapping();
  return {
    ai_enabled: false,
    domains: domainMeta(),
    grades: roleMapping.grades.map((g) => ({
      grade_id: g.grade_id,
      grade_name: g.grade_name,
      full_title: g.full_title,
      sort_order: g.sort_order,
    })),
    profiler: {
      demonstration_pathway: roleMapping.profiler?.find((p) => p.question_id === 'demonstration_pathway') || null,
      ddi_centrality: roleMapping.profiler?.find((p) => p.question_id === 'ddi_centrality') || null,
      influence: roleMapping.profiler?.find((p) => p.question_id === 'influence') || null,
    },
    levels: levelNames(),
  };
}

export function normalizeDomain(raw) {
  return DOMAINS.find((d) => d.toLowerCase() === String(raw || '').toLowerCase()) || null;
}

function resolveGatePrompt(gate, gradeId) {
  if (gate.prompt_by_grade?.[gradeId]) return gate.prompt_by_grade[gradeId];
  return gate.prompt;
}

export function gatesForProfile(domain, profile) {
  const config = loadAssessGates();
  const domainConfig = config.domains?.[domain];
  if (!domainConfig) return { domain, label: domain, blurb: '', gates: [] };

  const gradeOrder = profile?.grade_order ?? 1;
  const gradeId = profile?.grade_id;
  const roleMapping = loadRoleMapping();

  const gates = [];
  for (const gate of domainConfig.gates || []) {
    let minOrder = gate.min_grade_order ?? 1;
    if (gate.aligns_with_cluster) {
      const clusterMin = roleMapping.clusterRelevance?.[gate.aligns_with_cluster]?.min_grade_order;
      if (clusterMin != null) minOrder = Math.max(minOrder, clusterMin);
    }
    if (gradeOrder < minOrder) continue;
    gates.push({
      id: gate.id,
      type: gate.type || 'choice',
      prompt: resolveGatePrompt(gate, gradeId),
      placeholder: gate.placeholder || '',
      options: gate.options || null,
      depends_on: gate.depends_on || null,
      min_grade_order: minOrder,
      aligns_with_cluster: gate.aligns_with_cluster || null,
    });
  }

  return {
    domain,
    label: domainConfig.label || domain,
    blurb: domainConfig.blurb || '',
    gates,
  };
}

export function visibleAnsweredGates(domain, profile, answers = {}) {
  const { gates } = gatesForProfile(domain, profile);
  const visible = [];
  for (const gate of gates) {
    if (gate.depends_on) {
      const ok = Object.entries(gate.depends_on).every(([key, allowed]) => {
        const val = answers[key];
        return allowed.includes(val);
      });
      if (!ok) continue;
    }
    if (answers[gate.id] === undefined || answers[gate.id] === null || answers[gate.id] === '') {
      continue;
    }
    visible.push({
      id: gate.id,
      prompt: gate.prompt,
      value: answers[gate.id],
      aligns_with_cluster: gate.aligns_with_cluster,
    });
  }
  return visible;
}

function gateValue(gates, id) {
  const g = gates.find((x) => x.id === id);
  return g?.value;
}

function exposureKey(domain) {
  const map = {
    AI: 'ai_exposure',
    Digital: 'digital_exposure',
    Data: 'data_exposure',
    Innovation: 'innovation_exposure',
  };
  return map[domain] || `${domain.toLowerCase()}_exposure`;
}

function detailGateId(domain) {
  const map = {
    AI: 'ai_exposure_detail',
    Digital: 'digital_exposure_detail',
    Data: 'data_exposure_detail',
    Innovation: 'innovation_exposure_detail',
  };
  return map[domain];
}

export function fallbackSelect({ domain, profile, gateAnswers, memory }) {
  const catalogue = visibleDomainQuestions(domain, profile);
  const asked = visibleAnsweredGates(domain, profile, gateAnswers);
  const exposure = gateValue(asked, exposureKey(domain)) || gateAnswers[exposureKey(domain)];
  const detail = gateAnswers[detailGateId(domain)] || '';
  const detailLower = String(detail).toLowerCase();

  const include = [];
  const exclude = [];

  const governanceAffirmed = ['partial', 'yes'].includes(
    gateAnswers.ai_governance_remit || gateAnswers.data_sharing_remit || '',
  );
  const enableOthers = ['informally', 'yes'].includes(
    gateAnswers.ai_enable_others || gateAnswers.digital_user_centred || gateAnswers.innovation_delivery || '',
  );

  for (const q of catalogue) {
    const clusterLower = q.cluster.toLowerCase();
    const strandLower = q.strand.toLowerCase();
    const isGovernance = /governance|ethics|responsible|sharing|leadership|scale|embedding/.test(
      `${clusterLower} ${strandLower}`,
    );
    const isFoundational = /foundational|literacy|tools effectively|conditions for innovation/.test(
      `${clusterLower} ${strandLower}`,
    );
    const isKnowledge = q.section_type === 'knowledge';

    let take = false;
    let reason = '';

    if (exposure === 'none' || !exposure) {
      take = isFoundational && isKnowledge;
      reason = take
        ? 'Light exposure: literacy and knowledge only'
        : 'Skipped: little exposure to this area';
    } else if (exposure === 'occasionally') {
      take = isFoundational || (enableOthers && !isGovernance);
      if (isGovernance && !governanceAffirmed) {
        take = false;
        reason = 'Governance not in remit from qualification';
      } else {
        reason = take ? 'Matches occasional exposure' : 'Lower priority for occasional exposure';
      }
    } else {
      take = true;
      if (isGovernance && !governanceAffirmed && profile.grade_order < 4) {
        take = false;
        reason = 'Governance remits not indicated';
      } else if (isGovernance && !governanceAffirmed && !/ethic|responsib|govern|policy|assurance/.test(detailLower)) {
        take = isKnowledge || enableOthers || exposure === 'core_to_role';
        reason = take
          ? 'Included as awareness given role visibility'
          : 'Governance practice not indicated';
      } else {
        reason = 'Relevant given exposure and role';
      }
    }

    if (detailLower) {
      const keywords = detailLower.split(/\W+/).filter((w) => w.length > 4);
      const hay = `${q.question} ${q.strand} ${q.cluster}`.toLowerCase();
      if (keywords.some((k) => hay.includes(k))) {
        take = true;
        reason = 'Matches details you described';
      }
    }

    if (take) {
      include.push({
        question_id: q.question_id,
        reason,
        priority: isFoundational ? 1 : isGovernance ? 3 : 2,
      });
    } else {
      exclude.push({ question_id: q.question_id, reason: reason || 'Not selected for this session' });
    }
  }

  include.sort((a, b) => a.priority - b.priority || a.question_id.localeCompare(b.question_id));
  const capped = include.slice(0, SELECTION_CAP);
  for (const item of include.slice(SELECTION_CAP)) {
    exclude.push({ question_id: item.question_id, reason: 'Capped for a shorter session' });
  }

  const opening = exposure === 'none' || !exposure
    ? `Thanks. We'll keep ${domain} light and focus on foundational awareness that still helps in your role.`
    : `Thanks for describing how ${domain} shows up in your work. I've picked questions that look most relevant. You can skip any that aren't.`;

  const memoryNotes = [
    `${domain} exposure: ${exposure || 'unknown'}`,
    detail ? `${domain} detail: ${String(detail).slice(0, 200)}` : null,
    ...(memory?.notes || []).slice(0, 3),
  ].filter(Boolean);

  return {
    include: capped,
    exclude,
    suggested_order: capped.map((x) => x.question_id),
    opening_message: opening,
    memory_notes: memoryNotes,
    meta: {
      provider: 'fallback',
      prompt_version: 'assess-select-v1',
      model: null,
    },
  };
}

export function validateSelection(raw, catalogue) {
  const byId = new Map(catalogue.map((q) => [q.question_id, q]));
  const include = [];
  const seen = new Set();

  for (const item of raw.include || []) {
    const id = item.question_id;
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    include.push({
      question_id: id,
      reason: String(item.reason || 'Selected'),
      priority: Number(item.priority) || 2,
    });
  }

  include.sort((a, b) => a.priority - b.priority);
  const capped = include.slice(0, SELECTION_CAP);
  const cappedIds = new Set(capped.map((x) => x.question_id));

  const exclude = [];
  for (const item of raw.exclude || []) {
    if (!byId.has(item.question_id)) continue;
    exclude.push({
      question_id: item.question_id,
      reason: String(item.reason || 'Excluded'),
    });
  }
  for (const q of catalogue) {
    if (!cappedIds.has(q.question_id) && !exclude.some((e) => e.question_id === q.question_id)) {
      exclude.push({ question_id: q.question_id, reason: 'Not included in this session' });
    }
  }

  let order = (raw.suggested_order || []).filter((id) => cappedIds.has(id));
  for (const item of capped) {
    if (!order.includes(item.question_id)) order.push(item.question_id);
  }

  return {
    include: capped,
    exclude,
    suggested_order: order,
    opening_message: String(raw.opening_message || '').trim()
      || 'Here are questions tailored to what you told us.',
    memory_notes: Array.isArray(raw.memory_notes)
      ? raw.memory_notes.map(String).slice(0, 12)
      : [],
  };
}

export function deterministicSelect({ domain, profile, gateAnswers, memory, cap = BASELINE_CAP }) {
  const catalogue = visibleDomainQuestions(domain, profile);
  const raw = fallbackSelect({ domain, profile, gateAnswers, memory });
  const byId = new Map(catalogue.map((q) => [q.question_id, q]));
  const include = [];
  const seen = new Set();

  for (const item of raw.include || []) {
    if (!byId.has(item.question_id) || seen.has(item.question_id)) continue;
    seen.add(item.question_id);
    include.push(item);
  }

  const asked = visibleAnsweredGates(domain, profile, gateAnswers);
  const exposureKeys = ['ai_exposure', 'digital_exposure', 'data_exposure', 'innovation_exposure'];
  const exposure = asked.find((g) => exposureKeys.includes(g.id))?.value
    || gateAnswers.ai_exposure
    || gateAnswers.digital_exposure
    || gateAnswers.data_exposure
    || gateAnswers.innovation_exposure;

  if (exposure && exposure !== 'none') {
    for (const q of catalogue) {
      if (seen.has(q.question_id)) continue;
      include.push({
        question_id: q.question_id,
        reason: 'In scope for your grade and qualification answers',
        priority: 5,
      });
      seen.add(q.question_id);
      if (include.length >= cap) break;
    }
  }

  include.sort((a, b) => (a.priority || 5) - (b.priority || 5) || a.question_id.localeCompare(b.question_id));
  const capped = include.slice(0, cap);
  const validated = validateSelection({
    include: capped,
    exclude: raw.exclude,
    suggested_order: capped.map((x) => x.question_id),
    opening_message: raw.opening_message,
    memory_notes: raw.memory_notes,
  }, catalogue);

  const order = capped.map((x) => x.question_id);
  const exclude = catalogue
    .filter((q) => !order.includes(q.question_id))
    .map((q) => ({ question_id: q.question_id, reason: 'Not included for this session' }));

  return {
    include: capped,
    exclude,
    suggested_order: order,
    opening_message: validated.opening_message,
    memory_notes: validated.memory_notes,
    meta: {
      provider: 'deterministic',
      prompt_version: 'assess-baseline-v1',
      model: null,
      selection_cap: SELECTION_CAP,
      baseline_cap: cap,
    },
  };
}

export function buildDomainReport(session, domain) {
  const answers = (session.answers || []).filter((a) => a.domain === domain);
  const run = (session.domains || []).find((d) => d.domain === domain);
  const names = levelNames();
  const byCluster = {};
  const byStrand = {};
  const questionRows = [];

  for (const a of answers) {
    if (a.status === 'skipped') {
      const q = getQuestionById(domain, a.question_id);
      questionRows.push({
        question_id: a.question_id,
        level: null,
        source: 'skipped',
        status: a.status,
        cluster: q?.cluster,
        strand: q?.strand,
        question: q?.question,
      });
      continue;
    }
    if (a.level == null || (a.status !== 'reviewed' && a.status !== 'ai_suggested')) continue;
    const q = getQuestionById(domain, a.question_id);
    if (!q) continue;

    questionRows.push({
      question_id: a.question_id,
      level: a.level,
      level_name: names[a.level - 1] || String(a.level),
      source: a.status,
      status: a.status,
      cluster: q.cluster,
      strand: q.strand,
      section_type: q.section_type,
      question: q.question,
    });

    if (a.status !== 'reviewed') continue;
    if (!byCluster[q.cluster]) byCluster[q.cluster] = [];
    byCluster[q.cluster].push(a.level);
    const sk = `${q.cluster}|${q.strand}`;
    if (!byStrand[sk]) byStrand[sk] = { cluster: q.cluster, strand: q.strand, levels: [] };
    byStrand[sk].levels.push(a.level);
  }

  const clusters = Object.entries(byCluster).map(([cluster, levels]) => ({
    cluster,
    average_level: Math.round((levels.reduce((s, n) => s + n, 0) / levels.length) * 10) / 10,
    count: levels.length,
  }));

  const strands = Object.values(byStrand).map((s) => {
    const avg = s.levels.reduce((a, b) => a + b, 0) / s.levels.length;
    return {
      cluster: s.cluster,
      strand: s.strand,
      average_level: Math.round(avg * 10) / 10,
      count: s.levels.length,
      gap: avg < (session.profile?.focus_min || 2),
    };
  });

  return {
    domain,
    profile: session.profile,
    status: run?.status || 'in_progress',
    selection_summary: {
      included: run?.selection?.include?.length || 0,
      excluded: run?.selection?.exclude?.length || 0,
    },
    clusters,
    strands,
    questions: questionRows,
    course_hints: [],
    memory_notes: run?.selection?.memory_notes || [],
  };
}

export function buildFullReport(session) {
  const domains = (session.domains || [])
    .filter((d) => d.status === 'complete' || (session.answers || []).some((a) => a.domain === d.domain))
    .map((d) => buildDomainReport(session, d.domain));
  return {
    profile: session.profile,
    memory: session.memory,
    domains,
    completed_domains: domains.filter((d) => d.status === 'complete').map((d) => d.domain),
  };
}

export function buildProgressionReport(session) {
  const profile = session.profile || {};
  const persona = generateProgressionPersona({
    id: session.id,
    profile,
    answers: session.answers || [],
    questionMeta: allQuestionMeta(),
    name: profile.learner_name || profile.name || null,
    organisation: profile.organisation || '',
    demonstration_pathway: profile.demonstration_pathway || null,
    narrative: profile.narrative || null,
    interpretation: profile.interpretation || null,
  });
  return {
    view: 'progression',
    session_id: session.id,
    title: session.title,
    profile,
    persona,
    completed_domains: (session.domains || [])
      .filter((d) => d.status === 'complete')
      .map((d) => d.domain),
    reviewed_count: persona.reviewed_count,
  };
}

export function mergeMemory(session, domain, selection) {
  const memory = session.memory || { notes: [], domains: {} };
  const notes = [
    ...(memory.notes || []),
    ...(selection?.memory_notes || []),
  ].filter(Boolean);
  return {
    notes: [...new Set(notes)].slice(-20),
    domains: {
      ...(memory.domains || {}),
      [domain]: {
        exposure_notes: selection?.memory_notes || [],
        included: selection?.include?.length || 0,
        completed_at: new Date().toISOString(),
      },
    },
  };
}
