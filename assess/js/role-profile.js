import { dataUrls } from './data-urls.js';

const ROLE_MAPPING_URL = dataUrls.roleMapping;
export const ROLE_PROFILE_SESSION_KEY = 'gs-role-profile';

let mappingCache = null;

export async function loadRoleMapping() {
  if (mappingCache) return mappingCache;
  const res = await fetch(ROLE_MAPPING_URL);
  if (!res.ok) throw new Error('Could not load role-mapping.json');
  mappingCache = await res.json();
  return mappingCache;
}

export function clusterKey(domain, cluster) {
  return `${domain}|${cluster}`;
}

export function getGradeById(data, gradeId) {
  return data.grades.find((g) => g.grade_id === gradeId) ?? null;
}

export function getClusterRelevance(data, domain, cluster) {
  return data.clusterRelevance?.[clusterKey(domain, cluster)] ?? null;
}

export function getQuestionOverride(data, questionId) {
  return data.questionOverrides?.[questionId] ?? null;
}

function clampLevel(value, min = 1, max = 5) {
  return Math.min(max, Math.max(min, value));
}

export function getDemonstrationPathwayMeta(data, pathwayId) {
  if (!pathwayId || !data?.demonstration_pathways) return null;
  return data.demonstration_pathways[pathwayId] ?? null;
}

export function computeProfile(data, gradeId, answers = {}, source = 'sidebar') {
  if (!gradeId) return null;

  const grade = getGradeById(data, gradeId);
  if (!grade) return null;

  let ceiling = grade.base_ceiling;
  let focusMin = grade.base_focus_min;
  let focusMax = grade.base_focus_max;

  const ddiCentrality = answers.ddi_centrality;
  const influence = answers.influence;
  const specialistRole = answers.specialist_role;
  const demonstrationPathway = answers.demonstration_pathway || null;
  const pathwayMeta = getDemonstrationPathwayMeta(data, demonstrationPathway);

  const ddiMod = ddiCentrality ? data.modifiers?.ddi_centrality?.[ddiCentrality] : null;
  if (ddiMod?.ceiling_delta) ceiling += ddiMod.ceiling_delta;
  if (ddiMod?.focus_max_bump) focusMax += ddiMod.focus_max_bump;

  const infMod = influence ? data.modifiers?.influence?.[influence] : null;
  if (infMod?.ceiling_delta) ceiling += infMod.ceiling_delta;

  const specMod = specialistRole === 'yes' ? data.modifiers?.specialist_role?.yes : null;
  if (specMod?.ceiling_delta) ceiling += specMod.ceiling_delta;

  ceiling = clampLevel(ceiling);
  focusMin = clampLevel(focusMin);
  focusMax = clampLevel(Math.max(focusMin, focusMax));
  focusMax = Math.min(focusMax, ceiling);

  return {
    grade_id: grade.grade_id,
    grade_name: grade.grade_name,
    grade_order: grade.sort_order,
    ddi_centrality: ddiCentrality || null,
    influence: influence || null,
    specialist_role: specialistRole || null,
    demonstration_pathway: demonstrationPathway,
    pathway_label: pathwayMeta?.label || null,
    pathway_summary: pathwayMeta?.summary || null,
    role_ceiling: ceiling,
    focus_min: focusMin,
    focus_max: focusMax,
    source,
    answers: {
      ...(demonstrationPathway ? { demonstration_pathway: demonstrationPathway } : {}),
      ...(ddiCentrality ? { ddi_centrality: ddiCentrality } : {}),
      ...(influence ? { influence } : {}),
      ...(specialistRole ? { specialist_role: specialistRole } : {}),
    },
  };
}

export function formatProfileSummary(profile, levelNames = []) {
  if (!profile) return '';

  const ceilingName = levelNames[profile.role_ceiling - 1] || `Level ${profile.role_ceiling}`;
  const focusMinName = levelNames[profile.focus_min - 1] || `Level ${profile.focus_min}`;
  const focusMaxName = levelNames[profile.focus_max - 1] || `Level ${profile.focus_max}`;

  return `${profile.grade_name} · focus ${profile.focus_min}–${profile.focus_max} (${focusMinName}–${focusMaxName}) · ceiling ${profile.role_ceiling} (${ceilingName})`;
}

export function formatProficiencyBandExplanation(profile, levelNames = []) {
  if (!profile) return '';

  const ceilingName = levelNames[profile.role_ceiling - 1] || `Level ${profile.role_ceiling}`;
  const focusMinName = levelNames[profile.focus_min - 1] || `Level ${profile.focus_min}`;
  const focusMaxName = levelNames[profile.focus_max - 1] || `Level ${profile.focus_max}`;

  const bandIntro = `Focus levels ${profile.focus_min} to ${profile.focus_max} (${focusMinName} to ${focusMaxName}) describe where strong performance is most meaningfully demonstrated. Levels above ${profile.role_ceiling} (${ceilingName}) are stretch goals for your grade. Open a question to see its specific band.`;

  let leadershipNote = '';
  if (profile.role_ceiling <= 3) {
    leadershipNote =
      'Working is the maturity target on strands you use daily. Practitioner behaviours (helping colleagues, modelling standards, improving how the team works) can still be demonstrated informally.';
  } else if (profile.role_ceiling === 4) {
    leadershipNote =
      'Practitioner is the benchmark: coaching others, improving practice and being relied on for advice. Expert is an aspiration where your remit includes setting direction or standards beyond your team.';
  } else {
    leadershipNote =
      'Practitioner to Expert reflects leading practice and shaping organisational capability where DDI & AI falls within your accountability.';
  }

  return `${bandIntro} ${leadershipNote}`;
}

export function renderRoleDescriptionBlock(container, grade, profile, levelNames = []) {
  container.innerHTML = '';
  if (!grade || !profile) return;

  if (grade.full_title && grade.full_title !== grade.grade_name) {
    const title = document.createElement('p');
    title.className = 'role-context-full-title';
    title.textContent = grade.full_title;
    container.appendChild(title);
  }

  if (grade.description) {
    const desc = document.createElement('p');
    desc.className = 'role-context-description';
    desc.textContent = grade.description;
    container.appendChild(desc);
  }

  if (grade.typical_activities?.length) {
    const heading = document.createElement('p');
    heading.className = 'role-context-activities-heading';
    heading.textContent = 'Typical activities at this grade';
    container.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'role-context-activities';
    for (const activity of grade.typical_activities) {
      const li = document.createElement('li');
      li.textContent = activity;
      list.appendChild(li);
    }
    container.appendChild(list);
  }

  if (grade.proficiency_expectation) {
    const expectation = document.createElement('p');
    expectation.className = 'role-context-proficiency-expectation';
    expectation.textContent = grade.proficiency_expectation;
    container.appendChild(expectation);
  }
}

export function renderRoleContextPanel(container, {
  profile,
  grade,
  levelNames = [],
  visibleCount,
  totalCount,
  activeTransversal = null,
  viewMode = 'questions',
  onClear,
}) {
  container.innerHTML = '';
  if (!profile) {
    container.hidden = true;
    return;
  }

  const header = document.createElement('div');
  header.className = 'role-context-header';

  const name = document.createElement('h2');
  name.className = 'role-context-name';
  name.textContent = profile.grade_name;
  header.appendChild(name);

  const meta = document.createElement('p');
  meta.className = 'role-context-meta';
  meta.textContent = activeTransversal
    ? `${visibleCount} question${visibleCount === 1 ? '' : 's'} after role and transversal filters`
    : `${visibleCount} of ${totalCount} questions for your role`;
  header.appendChild(meta);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'role-context-clear';
  clear.textContent = 'Show full framework';
  clear.addEventListener('click', onClear);
  header.appendChild(clear);

  container.appendChild(header);

  const body = document.createElement('div');
  body.className = 'role-context-body';
  renderRoleDescriptionBlock(body, grade, profile, levelNames);
  container.appendChild(body);

  const summary = document.createElement('p');
  summary.className = 'role-context-summary';
  summary.textContent = formatProfileSummary(profile, levelNames);
  container.appendChild(summary);

  if (profile.pathway_label && profile.pathway_summary) {
    const pathway = document.createElement('p');
    pathway.className = 'role-context-pathway';
    pathway.innerHTML = `<strong>${profile.pathway_label}:</strong> ${profile.pathway_summary}`;
    container.appendChild(pathway);
  }

  const explain = document.createElement('p');
  explain.className = 'role-context-explain';
  const itemLabel = viewMode === 'maturity' ? 'row' : 'question';
  const itemLabelPlural = viewMode === 'maturity' ? 'rows' : 'questions';
  const levelNote =
    viewMode === 'maturity'
      ? 'Levels above your focus band are shaded as stretch goals in the tables.'
      : 'Levels above your focus band are marked as stretch goals in open questions.';
  if (activeTransversal) {
    explain.textContent = `Some ${itemLabelPlural} are hidden by your role and transversal filters. ${levelNote}`;
  } else if (totalCount > visibleCount) {
    explain.textContent = `${totalCount - visibleCount} ${itemLabel}${totalCount - visibleCount === 1 ? '' : 's'} hidden as not expected at your grade. ${levelNote}`;
  } else {
    explain.textContent = `All ${itemLabelPlural} match your grade band. ${levelNote}`;
  }
  container.appendChild(explain);

  container.hidden = false;
}

export function saveRoleProfileToSession(profile) {
  if (!profile) {
    sessionStorage.removeItem(ROLE_PROFILE_SESSION_KEY);
    return;
  }
  sessionStorage.setItem(ROLE_PROFILE_SESSION_KEY, JSON.stringify(profile));
}

export function readRoleProfileFromSession() {
  const json = sessionStorage.getItem(ROLE_PROFILE_SESSION_KEY);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function gradeHashSlug(gradeId) {
  return (gradeId || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function gradeFromHashSlug(data, slug) {
  if (!slug) return null;
  return data.grades.find((g) => gradeHashSlug(g.grade_id) === slug)?.grade_id ?? null;
}

export function isQuestionVisibleForProfile(data, profile, { domain, cluster, questionId }) {
  if (!profile) return true;

  const clusterRule = getClusterRelevance(data, domain, cluster);
  const clusterMin = clusterRule?.min_grade_order ?? 1;

  const override = getQuestionOverride(data, questionId);
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

export function resolveQuestionLevelBounds(data, profile, { domain, cluster, questionId, sectionType }) {
  if (!profile) return null;

  const grade = getGradeById(data, profile.grade_id);
  if (!grade) return null;

  const override = getQuestionOverride(data, questionId);
  const clusterRule = getClusterRelevance(data, domain, cluster);
  const tier = override?.tier || clusterRule?.tier || 'professional';
  const tierLevels = data.levelExpectations?.[tier]?.[grade.grade_id];

  let maxLevel = tierLevels?.max_level ?? profile.role_ceiling;
  let focusMin = tierLevels?.focus_min ?? profile.focus_min;
  let focusMax = tierLevels?.focus_max ?? profile.focus_max;

  const sectionAdj = data.levelExpectations?.section_adjustments?.[tier]?.[sectionType]?.[grade.grade_id];
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

/** Cluster rollup approximation: same tier lookup as per-question bounds, without section or question overrides. */
export function resolveClusterLevelBounds(data, profile, { domain, cluster }) {
  if (!profile) return null;

  const grade = getGradeById(data, profile.grade_id);
  if (!grade) return null;

  const clusterRule = getClusterRelevance(data, domain, cluster);
  const tier = clusterRule?.tier || 'professional';
  const tierLevels = data.levelExpectations?.[tier]?.[grade.grade_id];

  let maxLevel = tierLevels?.max_level ?? profile.role_ceiling;
  let focusMin = tierLevels?.focus_min ?? profile.focus_min;
  let focusMax = tierLevels?.focus_max ?? profile.focus_max;

  maxLevel = Math.min(maxLevel, profile.role_ceiling);

  return clampBounds(maxLevel, focusMin, focusMax);
}

export function formatQuestionLevelNote(bounds, levelNames = []) {
  if (!bounds) return '';

  const maxName = levelNames[bounds.max_level - 1] || `Level ${bounds.max_level}`;
  const focusMinName = levelNames[bounds.focus_min - 1] || `Level ${bounds.focus_min}`;
  const focusMaxName = levelNames[bounds.focus_max - 1] || `Level ${bounds.focus_max}`;

  if (bounds.focus_min === bounds.focus_max) {
    return `For this question, level ${bounds.focus_min} (${focusMinName}) is the maturity target. Levels above ${bounds.max_level} (${maxName}) are stretch goals for your role.`;
  }

  return `For this question, focus levels ${bounds.focus_min}–${bounds.focus_max} (${focusMinName}–${focusMaxName}). Levels above ${bounds.max_level} (${maxName}) are stretch goals for your role.`;
}

export function renderProfilerForm(container, data, answers = {}) {
  container.innerHTML = '';

  for (const question of data.profiler) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'role-profiler-question';
    fieldset.dataset.questionId = question.question_id;

    const legend = document.createElement('legend');
    legend.textContent = question.prompt;
    fieldset.appendChild(legend);

    const options = document.createElement('div');
    options.className = 'role-profiler-options';

    for (const option of question.options) {
      const label = document.createElement('label');
      label.className = 'role-profiler-option';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `profiler-${question.question_id}`;
      input.value = option.option_id;
      input.checked = (answers[question.question_id] || '') === option.option_id;
      label.appendChild(input);

      const text = document.createElement('span');
      text.textContent = option.option_label;
      label.appendChild(text);

      options.appendChild(label);
    }

    fieldset.appendChild(options);
    container.appendChild(fieldset);
  }
}

export function readProfilerAnswers(container) {
  const answers = {};
  for (const fieldset of container.querySelectorAll('.role-profiler-question')) {
    const questionId = fieldset.dataset.questionId;
    const checked = fieldset.querySelector('input[type="radio"]:checked');
    if (questionId && checked) answers[questionId] = checked.value;
  }
  return answers;
}

export function populateGradeSelect(select, data, { includeEmpty = true, emptyLabel = 'Not set: show full framework' } = {}) {
  select.innerHTML = '';
  if (includeEmpty) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = emptyLabel;
    select.appendChild(opt);
  }
  for (const grade of data.grades) {
    const opt = document.createElement('option');
    opt.value = grade.grade_id;
    opt.textContent = grade.grade_name;
    select.appendChild(opt);
  }
}

export function applyLevelMarkingToRows(rows, bounds, levels) {
  if (!bounds || !rows) return;

  for (const tr of rows) {
    tr.classList.remove('level-out-of-reach', 'level-in-focus');
    const levelCell = tr.querySelector('td:first-child, th[scope="row"]');
    const existingBadge = levelCell?.querySelector('.level-reach-badge');
    if (existingBadge) existingBadge.remove();
    if (!levelCell) continue;

    const levelText = levelCell.textContent || '';
    const levelId = levels.find((l) => levelText.startsWith(`${l.id}.`))?.id;
    if (!levelId) continue;

    if (levelId > bounds.max_level) {
      tr.classList.add('level-out-of-reach');
      const badge = document.createElement('span');
      badge.className = 'level-reach-badge';
        badge.textContent = 'Stretch for this role';
      levelCell.appendChild(badge);
    } else if (levelId >= bounds.focus_min && levelId <= bounds.focus_max) {
      tr.classList.add('level-in-focus');
    }
  }
}

export function applyLevelMarkingToMaturityRow(tr, bounds, levels) {
  if (!bounds || !tr) return;

  const cells = [...tr.querySelectorAll('td')];
  cells.forEach((td, idx) => {
    if (idx === 0) return;
    const level = levels[idx - 1];
    if (!level) return;
    td.classList.remove('level-out-of-reach', 'level-in-focus');
    if (level.id > bounds.max_level) td.classList.add('level-out-of-reach');
    else if (level.id >= bounds.focus_min && level.id <= bounds.focus_max) {
      td.classList.add('level-in-focus');
    }
  });
}

export function applyLevelColumnMarking(table, profile, levels, mappingData) {
  if (!profile || !table || !mappingData) return;

  const headerCells = table.querySelectorAll('thead th');
  for (const th of headerCells) {
    th.classList.remove('level-col-out-of-reach', 'level-col-in-focus');
  }

  for (const tr of table.querySelectorAll('tbody tr.maturity-row')) {
    const bounds = resolveQuestionLevelBounds(mappingData, profile, {
      domain: tr.dataset.domain,
      cluster: tr.dataset.cluster,
      questionId: tr.dataset.questionId,
      sectionType: tr.dataset.sectionType,
    });
    applyLevelMarkingToMaturityRow(tr, bounds, levels);
  }
}

export function setupRoleProfilerModal({
  modalId = 'role-profiler-modal',
  closeBtnId = 'role-profiler-modal-close',
  formId = 'role-profiler-form',
  saveBtnId = 'role-profiler-save',
  onSave,
} = {}) {
  const modal = document.getElementById(modalId);
  const closeBtn = document.getElementById(closeBtnId);
  const form = document.getElementById(formId);
  const saveBtn = document.getElementById(saveBtnId);

  if (!modal || !form) return { open: () => {} };

  let mappingPromise = null;

  function loadMapping() {
    if (!mappingPromise) mappingPromise = loadRoleMapping();
    return mappingPromise;
  }

  async function open({ gradeId, answers = {} } = {}) {
    const data = await loadMapping();
    renderProfilerForm(form, data, answers);
    modal.dataset.gradeId = gradeId || '';
    modal.hidden = false;
    closeBtn?.focus();
  }

  function close() {
    modal.hidden = true;
  }

  async function save() {
    const gradeId = modal.dataset.gradeId;
    if (!gradeId) {
      close();
      return;
    }
    const data = await loadMapping();
    const answers = readProfilerAnswers(form);
    const profile = computeProfile(data, gradeId, answers, 'sidebar');
    saveRoleProfileToSession(profile);
    onSave?.(profile);
    close();
  }

  saveBtn?.addEventListener('click', () => {
    save().catch((err) => console.error(err));
  });
  closeBtn?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  return { open, close };
}
