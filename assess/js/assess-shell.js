import { mountAssessHeader } from './app-header.js';
import { scrollPageToTop } from './scroll-page.js';
import {
  fetchMeta,
  listSessions,
  createSession,
  getSession,
  DEMO_SESSION_ID,
  patchSession,
  deleteSession,
  fetchGates,
  qualifyDomain,
  fetchQuestions,
  includeDomainQuestion,
  postAnswer,
  prefillDomain,
  selectDomainQuestions,
  chatSession,
  fetchReport,
  completeDomain,
  clearChatThread,
} from './assess-api.js';
import { renderMarkdown } from './assess-markdown.js';
import { getDescriptorDisplayText, DESCRIPTOR_VOICE_SELF } from './descriptor-voice.js';
import { renderPersonaReport, buildClusterRows, clusterRagStatus } from './report-demo.js';
import { rollupAnswerLevels } from './report-generate.js';
import { computeProfile, loadRoleMapping } from './role-profile.js';
import { loadTransversals } from './transversals.js';
import { dataUrls } from './data-urls.js';

const QUESTION_STEM = 'How would you rate your';

function pathIsExample() {
  return /\/example(\.html)?\/?$/i.test(window.location.pathname);
}

function isDemoEntry() {
  if (document.body?.getAttribute('data-assess-demo') === 'true') return true;
  if (pathIsExample()) return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === '1') return true;
  const hash = (window.location.hash || '').replace(/^#/, '').split('&')[0];
  return hash === 'demo';
}

function appListPath() {
  if (pathIsExample() || document.body?.getAttribute('data-assess-demo') === 'true') {
    return 'assess.html';
  }
  const path = window.location.pathname;
  if (/\/assess(\.html)?\/?$/i.test(path)) return path;
  return 'assess.html';
}
const CHAT_WIDTH_KEY = 'gs-assess-chat-w';

/** Plain-language pathway labels for the self-assessment UI (not framework jargon). */
const PATHWAY_OPTION_LABELS = {
  specialist: 'Subject expert: deep knowledge and expert practice in my area',
  leadership: 'Team leader: helping others succeed, coordinating work, listening to experts',
  mixed: 'Both: expert in my area and responsible for leading others',
};

function pathwayOptionLabel(option) {
  return PATHWAY_OPTION_LABELS[option.option_id] || option.option_label;
}

const state = {
  meta: null,
  user: null,
  session: null,
  view: 'boot',
  nav: 'profile',
  domain: null,
  questions: [],
  focusedId: null,
  gatesConfig: null,
  busy: false,
  reportDeps: null,
  activeTask: null,
  intakeStep: 1,
  profStep: 1,
  isDemo: false,
  pendingOptional: false,
  questionMeta: null,
  domainRag: {},
  transversalLevels: {},
  catalogueQuestions: [],
  showCatalogue: false,
};

const $ = (id) => document.getElementById(id);

function formPrefixForView() {
  if ($('view-intake') && !$('view-intake').hidden) return 'intake';
  if ($('pane-profile') && !$('pane-profile').hidden) return 'prof';
  return null;
}

function formFieldIds(prefix) {
  return [`${prefix}-name`, `${prefix}-grade`, `${prefix}-pathway`, `${prefix}-role`, `${prefix}-organisation`];
}

function clearFieldValidity(prefix) {
  for (const id of formFieldIds(prefix)) {
    const el = $(id);
    if (!el) continue;
    el.removeAttribute('aria-invalid');
    const hint = $(`${id}-hint`);
    if (hint) el.setAttribute('aria-describedby', hint.id);
    else el.removeAttribute('aria-describedby');
  }
}

function setErrorTarget(el, msg) {
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
}

function showError(msg, fieldId) {
  const prefix = formPrefixForView();
  if (prefix) clearFieldValidity(prefix);

  const intakeErr = $('intake-error');
  const profileErr = $('profile-error');
  const mainErr = $('main-error');
  const bootErr = $('assess-boot-error');

  if (prefix === 'intake') {
    setErrorTarget(intakeErr, msg);
    setErrorTarget(profileErr, '');
    setErrorTarget(mainErr, '');
    setErrorTarget(bootErr, '');
  } else if (prefix === 'prof') {
    setErrorTarget(profileErr, msg);
    setErrorTarget(intakeErr, '');
    setErrorTarget(mainErr, '');
    setErrorTarget(bootErr, '');
  } else {
    setErrorTarget(intakeErr, '');
    setErrorTarget(profileErr, '');
    const bootOpen = $('assess-boot') && !$('assess-boot').hidden;
    if (bootOpen) {
      setErrorTarget(bootErr, msg);
      setErrorTarget(mainErr, '');
    } else {
      setErrorTarget(mainErr, msg);
      setErrorTarget(bootErr, '');
    }
  }

  if (!msg || !fieldId) return;
  const field = $(fieldId);
  if (!field) return;
  field.setAttribute('aria-invalid', 'true');
  const hint = $(`${fieldId}-hint`);
  const errorEl = prefix === 'intake' ? intakeErr : prefix === 'prof' ? profileErr : null;
  const described = [errorEl?.id, hint?.id].filter(Boolean).join(' ');
  if (described) field.setAttribute('aria-describedby', described);
  field.focus();
}

function setSkipTarget(id) {
  const skip = document.getElementById('skip-link');
  if (!skip || !id) return;
  skip.setAttribute('href', `#${id}`);
}

function fillSelect(select, options, { valueKey = 'id', labelKey = 'label', empty = 'Choose…', selected = '' } = {}) {
  select.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = empty;
  select.appendChild(blank);
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = typeof opt === 'string' ? opt : opt[valueKey];
    o.textContent = typeof opt === 'string' ? opt : opt[labelKey];
    if (o.value === selected) o.selected = true;
    select.appendChild(o);
  }
}

function populateProfilerSelects(centralityEl, influenceEl, selected = {}, pathwayEl = null) {
  const centrality = state.meta.profiler.ddi_centrality?.options || [];
  const influence = state.meta.profiler.influence?.options || [];
  if (centralityEl) {
    fillSelect(centralityEl, centrality.map((o) => ({ id: o.option_id, label: o.option_label })), {
      empty: 'Skip for now',
      selected: selected.ddi_centrality || '',
    });
  }
  if (influenceEl) {
    fillSelect(influenceEl, influence.map((o) => ({ id: o.option_id, label: o.option_label })), {
      empty: 'Skip for now',
      selected: selected.influence || '',
    });
  }
  if (pathwayEl) {
    const pathway = state.meta.profiler.demonstration_pathway?.options || [];
    fillSelect(pathwayEl, pathway.map((o) => ({ id: o.option_id, label: pathwayOptionLabel(o) })), {
      empty: 'Skip for now',
      selected: selected.demonstration_pathway || '',
    });
  }
}

/** Pathway question applies from EO+ (grade_order >= 2) per role-mapping / proficiency examples. */
function pathwayMinGradeOrder() {
  return state.meta?.profiler?.demonstration_pathway?.min_grade_order ?? 2;
}

function gradeOrderForId(gradeId) {
  const g = state.meta?.grades?.find((x) => x.grade_id === gradeId);
  return g?.sort_order ?? 0;
}

function syncPathwayVisibility(gradeSelectId, wrapId, pathwaySelectId) {
  const gradeId = $(gradeSelectId)?.value || '';
  const wrap = $(wrapId);
  const select = $(pathwaySelectId);
  if (!wrap || !select) return;
  const show = gradeOrderForId(gradeId) >= pathwayMinGradeOrder();
  wrap.hidden = !show;
  if (!show) select.value = '';
}

function populateGradeSelect(el, selected = '') {
  fillSelect(el, state.meta.grades.map((g) => ({
    id: g.grade_id,
    label: `${g.grade_name}: ${g.full_title}`,
  })), { empty: 'Select grade', selected });
}

function setView(name) {
  state.view = name;
  $('assess-boot').hidden = name !== 'boot';
  $('view-list').hidden = name !== 'list';
  $('view-intake').hidden = name !== 'intake';
  $('view-shell').hidden = name !== 'shell';
  document.body.classList.toggle('assess-wizard-open', name === 'intake');
  const skipId = name === 'boot'
    ? 'assess-boot'
    : name === 'list'
      ? 'view-list'
      : name === 'intake'
        ? 'view-intake'
        : 'main-pane';
  setSkipTarget(skipId);
  scrollPageToTop();
}

function levelLabel(n) {
  return state.meta?.levels?.[n - 1] || `Level ${n}`;
}

/** Park the AI coach UI. Backend + optional profile fields stay for a future AI version. */
const AI_UI_ENABLED = false;

function aiEnabled() {
  if (!AI_UI_ENABLED || isDemoMode()) return false;
  return Boolean(state.meta?.ai_enabled);
}

function isDemoSessionTitle(title) {
  return String(title || '').startsWith('Demo:');
}

function isDemoMode() {
  return Boolean(state.isDemo) || isDemoSessionTitle(state.session?.title);
}

/** Nav / detail status chip. When AI is off, reviewed shows the level name. */
function statusBadge(qOrStatus, level = null) {
  const status = typeof qOrStatus === 'string' ? qOrStatus : qOrStatus?.status;
  const lvl = typeof qOrStatus === 'string' ? level : (qOrStatus?.level ?? level);

  if (status === 'reviewed') {
    const name = lvl ? levelLabel(lvl).toUpperCase() : 'RATED';
    return `<span class="assess-badge assess-badge--reviewed">${escapeHtml(name)}</span>`;
  }
  if (status === 'skipped') {
    return '<span class="assess-badge assess-badge--skipped">Skipped</span>';
  }
  if (status === 'ai_suggested') {
    if (!aiEnabled()) {
      return '<span class="assess-badge assess-badge--empty">To do</span>';
    }
    return '<span class="assess-badge assess-badge--ai">AI suggested</span>';
  }
  return '<span class="assess-badge assess-badge--empty">To do</span>';
}

function formatDomainCounts(counts) {
  if (!counts || !counts.selected) return 'Not started';
  if (counts.reviewed >= counts.selected) return 'Completed';
  return `${counts.reviewed} of ${counts.selected}`;
}

function domainNavTagClass(domainId) {
  if (!domainHasSelection(domainId)) return 'assess-nav-item-meta assess-nav-tag assess-nav-tag--start';
  const counts = state.session.domain_counts?.[domainId];
  if (counts?.selected && counts.reviewed >= counts.selected) {
    return 'assess-nav-item-meta assess-nav-tag assess-nav-tag--done';
  }
  return 'assess-nav-item-meta assess-nav-tag assess-nav-tag--progress';
}

function domainHasSelection(domainId, session = state.session) {
  const run = (session?.domains || []).find((d) => d.domain === domainId);
  return Boolean(run?.selection);
}

function domainNavMeta(domainId) {
  if (!domainHasSelection(domainId)) return 'Start';
  const counts = state.session.domain_counts?.[domainId];
  if (counts?.selected) return formatDomainCounts(counts);
  return '0 / 0';
}

function domainNavAriaLabel(domainId, label) {
  if (!domainHasSelection(domainId)) {
    return `${label}: start pre-assessment`;
  }
  const counts = state.session.domain_counts?.[domainId];
  const selected = counts?.selected || 0;
  const reviewed = counts?.reviewed || 0;
  return `${label}: ${reviewed} of ${selected} questions done`;
}

function processIntroSeen(session = state.session) {
  return Boolean(session?.memory?.process_intro_seen);
}

async function markProcessIntroSeen() {
  if (!state.session || processIntroSeen() || isDemoMode()) return;
  try {
    state.session = await patchSession(state.session.id, {
      memory: { process_intro_seen: true },
    });
  } catch {
    /* keep going; welcome may show again on refresh */
    if (state.session.memory) state.session.memory.process_intro_seen = true;
    else state.session.memory = { notes: [], domains: {}, process_intro_seen: true };
  }
}

async function continueFromWelcome() {
  await markProcessIntroSeen();
  await showNav('hub');
}

function postProfileLandingKey() {
  if (state.pendingOptional && aiEnabled()) return 'profile';
  if (!isDemoMode() && !processIntroSeen()) return 'welcome';
  return 'hub';
}

async function leaveShellToList() {
  state.session = null;
  state.nav = 'hub';
  state.domain = null;
  state.questions = [];
  state.focusedId = null;
  state.isDemo = false;
  state.pendingOptional = false;
  if (pathIsExample() || document.body?.getAttribute('data-assess-demo') === 'true') {
    window.location.href = 'assess.html';
    return;
  }
  history.replaceState(null, '', appListPath());
  setView('list');
  await renderSessionList();
}

const RAG_LABELS = {
  low: 'Below focus',
  mid: 'Within focus',
  high: 'At or above focus',
  neutral: 'No score yet',
};

function slugifyQuestionPart(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function ensureQuestionMeta() {
  if (state.questionMeta) return state.questionMeta;
  const res = await fetch(dataUrls.framework);
  if (!res.ok) throw new Error('Could not load framework for live progress');
  const fw = await res.json();
  const map = new Map();
  for (const domain of fw.domains || []) {
    for (const cluster of domain.clusters || []) {
      for (const strand of cluster.skills || []) {
        for (const section of strand.sections || []) {
          (section.rows || []).forEach((row, index) => {
            const question_id = [
              slugifyQuestionPart(domain.domain_name),
              slugifyQuestionPart(cluster.cluster_name),
              slugifyQuestionPart(strand.strand_name),
              slugifyQuestionPart(section.type),
              String(index),
            ].join('|');
            map.set(question_id, {
              question_id,
              domain: domain.domain_name,
              cluster: cluster.cluster_name,
              transversal_tags: row.transversal_tags || [],
            });
          });
        }
      }
    }
  }
  state.questionMeta = map;
  return map;
}

function summariseDomainRag(clusterRows) {
  const byDomain = {};
  for (const row of clusterRows || []) {
    if (!byDomain[row.domain]) byDomain[row.domain] = [];
    byDomain[row.domain].push(row);
  }
  const names = state.reportDeps?.levelNames || state.meta?.levels || [];
  const out = {};
  for (const [domain, rows] of Object.entries(byDomain)) {
    const scored = rows.filter((r) => r.inScope && r.level != null && r.bounds);
    if (!scored.length) {
      out[domain] = { rag: 'neutral', label: RAG_LABELS.neutral, scored: 0, level: null, levelText: '' };
      continue;
    }
    const rags = scored.map((r) => clusterRagStatus(r));
    let rag = 'mid';
    if (rags.includes('low')) rag = 'low';
    else if (rags.every((r) => r === 'high')) rag = 'high';

    const level = Math.round(scored.reduce((s, r) => s + r.level, 0) / scored.length);
    out[domain] = {
      rag,
      label: RAG_LABELS[rag],
      scored: scored.length,
      level,
      levelText: `${level} · ${names[level - 1] || `Level ${level}`}`,
    };
  }
  return out;
}

async function refreshLiveRag() {
  const empty = {};
  for (const d of state.meta?.domains || []) {
    empty[d.id] = { rag: 'neutral', label: RAG_LABELS.neutral, scored: 0, level: null, levelText: '' };
  }

  if (!state.session || !profileComplete() || reviewedAnswerCount() === 0) {
    state.domainRag = empty;
    state.transversalLevels = {};
    syncDomainProgressUi();
    syncNavTransversals();
    return;
  }

  try {
    const [deps, questionMeta] = await Promise.all([
      ensureReportDeps(),
      ensureQuestionMeta(),
    ]);
    const { cluster_levels, transversal_levels } = rollupAnswerLevels({
      answers: state.session.answers || [],
      questionMeta,
    });
    const profile = computeProfile(deps.roleMapping, state.session.profile.grade_id, {
      demonstration_pathway: state.session.profile.demonstration_pathway,
      ddi_centrality: state.session.profile.ddi_centrality,
      influence: state.session.profile.influence,
    });
    if (!profile) {
      state.domainRag = empty;
      state.transversalLevels = {};
      syncDomainProgressUi();
      syncNavTransversals();
      return;
    }
    const rows = buildClusterRows(deps.roleMapping, { cluster_levels }, profile);
    state.domainRag = { ...empty, ...summariseDomainRag(rows) };
    state.transversalLevels = transversal_levels || {};
  } catch {
    state.domainRag = empty;
    state.transversalLevels = {};
  }
  syncDomainProgressUi();
  syncNavTransversals();
}

function syncDomainProgressUi() {
  for (const d of state.meta?.domains || []) {
    const info = state.domainRag?.[d.id] || {
      rag: 'neutral',
      label: RAG_LABELS.neutral,
      levelText: '',
    };
    const block = document.querySelector(`.assess-nav-domain[data-domain="${d.id}"]`);
    const btn = document.querySelector(`.assess-nav-item[data-nav="domain:${d.id}"]`);
    if (block) {
      block.classList.remove(
        'assess-nav-domain--rag-low',
        'assess-nav-domain--rag-mid',
        'assess-nav-domain--rag-high',
        'assess-nav-domain--rag-neutral',
      );
      block.classList.add(`assess-nav-domain--rag-${info.rag}`);
      block.classList.toggle('is-open', state.nav === `domain:${d.id}`);
    }
    if (!btn) continue;
    btn.classList.remove(
      'assess-nav-item--rag-low',
      'assess-nav-item--rag-mid',
      'assess-nav-item--rag-high',
      'assess-nav-item--rag-neutral',
    );
    btn.classList.add(`assess-nav-item--rag-${info.rag}`);

    const metaEl = btn.querySelector('.assess-nav-item-meta');
    if (metaEl) {
      metaEl.className = domainNavTagClass(d.id);
      metaEl.textContent = domainNavMeta(d.id);
    }

    const row = btn.querySelector('.assess-nav-item-rag-row');
    if (row) row.hidden = info.rag === 'neutral';

    const status = btn.querySelector('.assess-nav-item-rag-status');
    if (status) {
      status.textContent = info.rag === 'neutral' ? '' : info.label;
      status.hidden = info.rag === 'neutral';
    }
    const levelEl = btn.querySelector('.assess-nav-item-rag-level');
    if (levelEl) {
      levelEl.textContent = info.levelText || '';
      levelEl.hidden = !info.levelText;
    }
  }
}

function profileComplete(session = state.session) {
  const p = session?.profile || {};
  if (!String(p.learner_name || p.name || '').trim()) return false;
  if (!p.grade_id || !String(p.role_title || '').trim() || !String(p.organisation || '').trim()) {
    return false;
  }
  if (gradeOrderForId(p.grade_id) >= pathwayMinGradeOrder() && !p.demonstration_pathway) {
    return false;
  }
  return true;
}

function domainComplete(domainId, session = state.session) {
  const counts = session?.domain_counts?.[domainId];
  if (!counts?.selected) return false;
  return counts.reviewed >= counts.selected;
}

function updateQuestionProgress(q) {
  const el = $('question-progress');
  if (!el) return;
  if (!q) {
    el.hidden = true;
    return;
  }
  const domainLabel = state.meta.domains.find((d) => d.id === state.domain)?.label || state.domain;
  if (q.in_selection === false) {
    el.hidden = false;
    el.textContent = `Not in your selected questions for ${domainLabel}`;
    return;
  }
  if (!state.questions.length) {
    el.hidden = true;
    return;
  }
  const idx = state.questions.findIndex((x) => x.question_id === q.question_id) + 1;
  el.hidden = false;
  el.textContent = `Question ${idx} of ${state.questions.length} in ${domainLabel}`;
}

function syncNavProfileCard() {
  syncNavTransversals();
}

function transversalRag(level) {
  if (level == null) return 'neutral';
  if (level >= 4) return 'high';
  if (level >= 3) return 'mid';
  return 'low';
}

function syncNavTransversals() {
  const wrap = $('nav-profile-transversals');
  const list = $('nav-profile-transversal-list');
  if (!wrap || !list) return;

  const axes = state.reportDeps?.transversalsData?.transversals || [];
  const levels = state.transversalLevels || {};
  const names = state.reportDeps?.levelNames || state.meta?.levels || [];
  const scored = axes.filter((t) => levels[t.id] != null);

  if (!scored.length) {
    wrap.hidden = true;
    list.innerHTML = '';
    return;
  }

  wrap.hidden = false;
  list.innerHTML = '';
  for (const t of axes) {
    const level = levels[t.id];
    const li = document.createElement('li');
    const rag = transversalRag(level);
    li.className = `assess-nav-trans-item assess-nav-trans-item--${rag}`;
    if (level == null) {
      li.innerHTML = `
        <span class="assess-nav-trans-name">${escapeHtml(t.name)}</span>
        <span class="assess-nav-trans-level">No score</span>
      `;
    } else {
      li.innerHTML = `
        <span class="assess-nav-trans-name">${escapeHtml(t.name)}</span>
        <span class="assess-nav-trans-level">${escapeHtml(`${level} · ${names[level - 1] || ''}`)}</span>
      `;
    }
    list.appendChild(li);
  }
}

function syncProfileNavCheck() {
  syncNavProfileCard();
}

function syncProfileBreadcrumbs() {
  const nav = $('profile-breadcrumbs');
  if (!nav) return;
  if (state.nav !== 'profile') {
    nav.hidden = true;
    nav.innerHTML = '';
    return;
  }
  renderBreadcrumbs(nav, [
    {
      text: 'Your assessment',
      onClick: () => {
        if (profileComplete()) showNav('hub');
        else leaveShellToList();
      },
    },
    { text: 'Profile' },
  ]);
}

/* Wizard helpers (intake + shell profile) */

function wizardPrefix(mode) {
  return mode === 'profile' ? 'prof' : 'intake';
}

/** Profile wizard: 1 = required details; 2 = optional (AI only). Intake is a single form. */
function wizardMaxStep(mode = 'profile') {
  if (mode === 'intake') return 1;
  return aiEnabled() ? 2 : 1;
}

function syncWizardChrome() {
  const max = wizardMaxStep('profile');
  const stepper = $('prof-stepper');
  if (stepper) {
    stepper.hidden = max < 2;
    stepper.querySelectorAll('.assess-stepper-step').forEach((el) => {
      const n = Number(el.dataset.step);
      el.hidden = n > max;
    });
  }
  const intakeLead = $('intake-lead');
  if (intakeLead) {
    intakeLead.textContent = 'About two minutes, then we open your assessment with questions for your role.';
  }
  const profileLead = $('profile-pane-lead');
  if (profileLead && !isDemoMode()) {
    profileLead.hidden = false;
    profileLead.textContent = 'Update your details anytime.';
  }
}

function validateMandatoryFields(prefix) {
  if (!$(`${prefix}-name`)?.value.trim()) {
    return { message: 'Enter your name.', fieldId: `${prefix}-name` };
  }
  const grade = $(`${prefix}-grade`)?.value;
  if (!grade) return { message: 'Select your grade.', fieldId: `${prefix}-grade` };
  if (gradeOrderForId(grade) >= pathwayMinGradeOrder() && !$(`${prefix}-pathway`)?.value) {
    return {
      message: 'Choose whether you mainly work as a subject expert or as someone who leads and supports others.',
      fieldId: `${prefix}-pathway`,
    };
  }
  if (!$(`${prefix}-role`)?.value.trim()) {
    return { message: 'Enter what you do.', fieldId: `${prefix}-role` };
  }
  if (!$(`${prefix}-organisation`)?.value.trim()) {
    return { message: 'Enter where you work.', fieldId: `${prefix}-organisation` };
  }
  return null;
}

function validateWizardStep(mode, step) {
  if (mode === 'intake' || step === 1) {
    return validateMandatoryFields(wizardPrefix(mode));
  }
  return null;
}

function renderWizardStepper(mode, step) {
  if (mode !== 'profile') return;
  const stepper = $('prof-stepper');
  if (!stepper) return;
  const max = wizardMaxStep('profile');
  stepper.hidden = max < 2;
  stepper.querySelectorAll('.assess-stepper-step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.hidden = n > max;
    el.classList.toggle('is-active', n === step);
    el.classList.toggle('is-done', n < step);
  });
}

function showWizardStep(mode, step) {
  if (mode === 'intake') {
    state.intakeStep = 1;
    const panel = $('intake-step-1');
    if (panel) panel.hidden = false;
    const next = $('intake-next');
    if (next) {
      next.hidden = false;
      next.textContent = 'Start assessment';
    }
    return;
  }

  const max = wizardMaxStep('profile');
  const safeStep = Math.min(max, Math.max(1, step));
  state.profStep = safeStep;

  for (let i = 1; i <= 2; i++) {
    const panel = $(`prof-step-${i}`);
    if (panel) panel.hidden = i !== safeStep;
  }
  renderWizardStepper('profile', safeStep);

  const next = $('prof-next');
  if (next) {
    next.hidden = false;
    next.textContent = isDemoMode() ? 'Continue to your assessment' : 'Save';
  }

  const title = $('profile-pane-title');
  const lead = $('profile-pane-lead');
  if (!isDemoMode() && title && lead) {
    title.textContent = 'Your profile';
    lead.hidden = false;
    lead.textContent = 'Update your details anytime.';
  }
  scrollPageToTop();
}

async function advanceWizard(mode, delta) {
  if (mode === 'intake') {
    if (delta > 0) await onIntakeSubmit(new Event('submit'));
    return;
  }

  if (isDemoMode() && delta > 0 && $('prof-next')?.dataset.demoSkip === '1') {
    await showNav('hub');
    return;
  }

  const max = wizardMaxStep('profile');
  const current = state.profStep;
  if (delta > 0) {
    if (!isDemoMode()) {
      const err = validateWizardStep('profile', current);
      if (err) {
        showError(err.message, err.fieldId);
        return;
      }
    }
    if (current >= max) {
      if (isDemoMode()) {
        await showNav('hub');
        return;
      }
      await onProfileSave({ goToDomains: true });
      return;
    }
  }
  const next = Math.min(max, Math.max(1, current + delta));
  showWizardStep('profile', next);
  showError('');
}

async function skipOptionalProfile() {
  showError('');
  state.pendingOptional = false;
  await showNav(postProfileLandingKey());
}

/** Strip shared stem for nav labels; full question stays in the detail pane. */
function navQuestionLabel(question) {
  const raw = String(question || '').trim();
  const re = new RegExp(`^${QUESTION_STEM}\\s+`, 'i');
  if (re.test(raw)) {
    const rest = raw.replace(re, '').replace(/[?？]\s*$/, '');
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return raw;
}

function questionsShareStem(questions) {
  return (questions || []).length > 0
    && questions.every((q) => new RegExp(`^${QUESTION_STEM}\\s+`, 'i').test(String(q.question || '')));
}

/* List / intake */

async function renderSessionList() {
  const { sessions } = await listSessions();
  const wrap = $('session-list');
  wrap.innerHTML = '';
  const own = (sessions || []).filter((s) => !isDemoSessionTitle(s.title));
  if (!own.length) {
    wrap.innerHTML = '<p class="assess-hint">No assessments yet. Create one to get started.</p>';
    return;
  }
  for (const s of own) {
    const card = document.createElement('article');
    card.className = 'assess-session-card';
    const done = (s.domains || []).filter((d) => d.status === 'complete').map((d) => d.domain);
    card.innerHTML = `
      <div>
        <h2>${escapeHtml(s.title)}</h2>
        <p class="assess-session-meta">${escapeHtml([s.profile_summary?.learner_name, s.profile_summary?.grade_name, s.profile_summary?.role_title].filter(Boolean).join(' · ') || 'No profile yet')}
        ${done.length ? ` · Done: ${escapeHtml(done.join(', '))}` : ''}</p>
      </div>
    `;
    const actions = document.createElement('div');
    actions.className = 'assess-session-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-primary btn-sm';
    open.textContent = 'Open';
    open.addEventListener('click', () => openSession(s.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-secondary btn-sm';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this assessment?')) return;
      await deleteSession(s.id);
      await renderSessionList();
    });
    actions.append(open, del);
    card.appendChild(actions);
    wrap.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function openSession(id, { demo = false } = {}) {
  showError('');
  state.session = await getSession(id);
  state.isDemo = demo || isDemoEntry();
  if (state.isDemo) {
    const examplePath = pathIsExample() ? window.location.pathname : 'example.html';
    history.replaceState(null, '', examplePath);
  } else {
    const qs = new URLSearchParams();
    qs.set('id', id);
    history.replaceState(null, '', `${appListPath()}?${qs.toString()}`);
  }
  enterShell();
}

function showIntake() {
  syncWizardChrome();
  const nameEl = $('intake-name');
  if (nameEl) nameEl.value = '';
  populateGradeSelect($('intake-grade'));
  populateProfilerSelects(
    null,
    null,
    {},
    $('intake-pathway'),
  );
  const pathwaySelect = $('intake-pathway');
  if (pathwaySelect?.options[0]) pathwaySelect.options[0].textContent = 'Choose…';
  syncPathwayVisibility('intake-grade', 'intake-pathway-wrap', 'intake-pathway');
  if ($('intake-role')) $('intake-role').value = '';
  if ($('intake-organisation')) $('intake-organisation').value = '';
  showWizardStep('intake', 1);
  setView('intake');
}

async function onIntakeSubmit(e) {
  e?.preventDefault?.();
  showError('');
  const err = validateMandatoryFields('intake');
  if (err) {
    showError(err.message, err.fieldId);
    return;
  }
  const grade_id = $('intake-grade').value;
  try {
    const pathwayEligible = gradeOrderForId(grade_id) >= pathwayMinGradeOrder();
    const session = await createSession({
      learner_name: $('intake-name').value.trim(),
      grade_id,
      role_title: $('intake-role').value.trim(),
      organisation: $('intake-organisation').value.trim(),
      demonstration_pathway: pathwayEligible ? ($('intake-pathway').value || null) : null,
    });
    state.pendingOptional = aiEnabled();
    await openSession(session.id);
  } catch (submitErr) {
    showError(submitErr.message);
  }
}

/* Shell */

function enterShell() {
  setView('shell');
  state.isDemo = isDemoMode();
  const aiOn = aiEnabled();
  $('view-shell').classList.toggle('is-ai-off', !aiOn);
  $('view-shell').classList.toggle('is-demo', state.isDemo);
  document.body.classList.toggle('assess-ai-off', !aiOn);
  document.body.classList.toggle('assess-demo', state.isDemo);
  const demoBanner = $('demo-banner');
  if (demoBanner) demoBanner.hidden = !state.isDemo;
  applyStoredChatWidth();
  syncHeaderHeight();
  syncWizardChrome();
  setupChatPane(aiOn);
  renderNav();
  syncProfileNavCheck();
  refreshLiveRag();

  if (profileComplete()) {
    if (state.pendingOptional && aiOn) {
      showNav('profile');
    } else {
      state.pendingOptional = false;
      showNav(postProfileLandingKey());
    }
  } else {
    state.pendingOptional = false;
    showNav('profile');
  }
  refreshChatHistory();
  renderChatStarters();
}

function syncHeaderHeight() {
  const header = document.getElementById('app-header');
  if (!header) return;
  const h = Math.ceil(header.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--assess-header-h', `${h}px`);
}

function setupChatPane(aiOn) {
  const pane = $('chat-pane');
  const resizer = $('chat-resizer');
  const fab = $('btn-open-coach');
  const backdrop = $('chat-backdrop');
  const closeBtn = $('btn-close-coach');
  if (pane) pane.hidden = !aiOn;
  if (resizer) resizer.hidden = !aiOn;
  if (fab) fab.hidden = !aiOn;
  if (backdrop) backdrop.hidden = true;
  if (closeBtn) closeBtn.hidden = !aiOn;
  document.body.classList.remove('assess-coach-open');
  if (!aiOn) return;
  $('chat-disabled').hidden = true;
  $('chat-active').hidden = false;
}

function openCoachSheet() {
  if (!aiEnabled()) return;
  document.body.classList.add('assess-coach-open');
  const backdrop = $('chat-backdrop');
  if (backdrop) backdrop.hidden = false;
  const pane = $('chat-pane');
  if (pane) pane.hidden = false;
}

function closeCoachSheet() {
  document.body.classList.remove('assess-coach-open');
  const backdrop = $('chat-backdrop');
  if (backdrop) backdrop.hidden = true;
}

function applyStoredChatWidth() {
  const stored = Number(localStorage.getItem(CHAT_WIDTH_KEY));
  if (Number.isFinite(stored) && stored >= 200 && stored <= 560) {
    document.documentElement.style.setProperty('--assess-chat-w', `${stored}px`);
  }
}

function setupChatResizer() {
  const shell = $('view-shell');
  const handle = $('chat-resizer');
  if (!shell || !handle || handle.dataset.bound) return;
  handle.dataset.bound = '1';

  const clamp = (n) => Math.min(560, Math.max(200, n));

  const setWidth = (px) => {
    const w = clamp(px);
    document.documentElement.style.setProperty('--assess-chat-w', `${w}px`);
    localStorage.setItem(CHAT_WIDTH_KEY, String(w));
    return w;
  };

  let dragging = false;

  const onMove = (clientX) => {
    if (!dragging) return;
    const rect = shell.getBoundingClientRect();
    setWidth(rect.right - clientX);
  };

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    shell.classList.add('is-resizing-chat');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => onMove(e.clientX));
  handle.addEventListener('pointerup', (e) => {
    dragging = false;
    shell.classList.remove('is-resizing-chat');
    try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  handle.addEventListener('pointercancel', () => {
    dragging = false;
    shell.classList.remove('is-resizing-chat');
  });
  handle.addEventListener('keydown', (e) => {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--assess-chat-w')) || 320;
    if (e.key === 'ArrowLeft') {
      setWidth(current + 16);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      setWidth(current - 16);
      e.preventDefault();
    }
  });
}

function reviewedAnswerCount(session = state.session) {
  return (session?.answers || []).filter((a) => a.status === 'reviewed' && a.level != null).length;
}

function syncReportNavButton() {
  if (state.nav === 'hub') renderHub();
}

function profileSummaryRows() {
  const p = state.session?.profile || {};
  const grade = state.meta?.grades?.find((g) => g.grade_id === p.grade_id);
  const rows = [
    { key: 'Name', value: p.learner_name || p.name || '', change: 'name' },
    { key: 'Grade', value: grade ? `${grade.grade_name}: ${grade.full_title}` : (p.grade_id || ''), change: 'grade' },
  ];
  if (gradeOrderForId(p.grade_id) >= pathwayMinGradeOrder() || p.demonstration_pathway) {
    rows.push({
      key: 'How you work',
      value: pathwayLabelForId(p.demonstration_pathway),
      change: 'how you work',
    });
  }
  rows.push(
    { key: 'Role', value: p.role_title || '', change: 'role' },
    { key: 'Organisation', value: p.organisation || '', change: 'organisation' },
  );
  return rows;
}

function renderHub() {
  renderBreadcrumbs($('hub-breadcrumbs'), [
    { text: 'Your assessments', onClick: () => leaveShellToList() },
    { text: 'Your assessment' },
  ]);
  renderHubSummary();
  renderHubAreas();
  renderHubReport();
}

function renderHubSummary() {
  const dl = $('hub-summary');
  if (!dl) return;
  dl.innerHTML = '';
  const canChange = !isDemoMode();
  for (const row of profileSummaryRows()) {
    const wrap = document.createElement('div');
    wrap.className = 'assess-summary-list__row';
    if (!canChange) wrap.classList.add('assess-summary-list__row--no-actions');

    const dt = document.createElement('dt');
    dt.className = 'assess-summary-list__key';
    dt.textContent = row.key;

    const dd = document.createElement('dd');
    dd.className = 'assess-summary-list__value';
    if (row.value) {
      dd.textContent = row.value;
    } else {
      dd.textContent = 'Not provided';
      dd.classList.add('assess-summary-list__value--empty');
    }

    wrap.append(dt, dd);
    if (canChange) {
      const actions = document.createElement('dd');
      actions.className = 'assess-summary-list__actions';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'assess-summary-list__change';
      btn.innerHTML = `Change<span class="visually-hidden"> ${escapeHtml(row.change)}</span>`;
      btn.addEventListener('click', () => {
        state.pendingOptional = false;
        showNav('profile');
      });
      actions.appendChild(btn);
      wrap.appendChild(actions);
    }
    dl.appendChild(wrap);
  }
}

function domainHubStatus(domainId) {
  if (!profileComplete()) {
    return { kind: 'cannot-start', label: 'Cannot start yet', hint: '', linked: false };
  }
  if (!domainHasSelection(domainId)) {
    return { kind: 'not-started', label: 'Not started', hint: '', linked: true };
  }
  const counts = state.session.domain_counts?.[domainId];
  const selected = counts?.selected || 0;
  const reviewed = counts?.reviewed || 0;
  if (selected && reviewed >= selected) {
    return { kind: 'completed', label: 'Completed', hint: '', linked: true };
  }
  const hint = selected ? `${reviewed} of ${selected} questions` : '';
  return { kind: 'incomplete', label: 'Incomplete', hint, linked: true };
}

function renderHubAreas() {
  const list = $('hub-areas');
  if (!list) return;
  list.innerHTML = '';
  for (const d of state.meta?.domains || []) {
    const status = domainHubStatus(d.id);
    list.appendChild(hubTaskItem({
      name: d.label || d.id,
      hint: status.hint,
      status: status.label,
      kind: status.kind,
      onClick: status.linked ? () => showNav(`domain:${d.id}`) : null,
    }));
  }
}

function renderHubReport() {
  const list = $('hub-report');
  if (!list) return;
  list.innerHTML = '';
  const ready = reviewedAnswerCount() > 0;
  list.appendChild(hubTaskItem({
    name: 'View your progression report',
    hint: ready ? '' : 'Rate at least one question',
    status: ready ? '' : 'Cannot start yet',
    kind: ready ? null : 'cannot-start',
    onClick: ready ? () => showNav('report') : null,
  }));
}

function hubTaskItem({ name, hint, status, kind, onClick }) {
  const li = document.createElement('li');
  li.className = 'assess-task-list__item';
  if (onClick) li.classList.add('assess-task-list__item--with-link');

  const nameWrap = document.createElement('div');
  nameWrap.className = 'assess-task-list__name-and-hint';
  if (onClick) {
    const a = document.createElement('a');
    a.className = 'assess-task-list__link';
    a.href = '#';
    a.textContent = name;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    nameWrap.appendChild(a);
  } else {
    const span = document.createElement('span');
    span.className = 'assess-task-list__name';
    span.textContent = name;
    nameWrap.appendChild(span);
  }
  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'assess-task-list__hint';
    hintEl.textContent = hint;
    nameWrap.appendChild(hintEl);
  }

  const statusWrap = document.createElement('div');
  statusWrap.className = 'assess-task-list__status';
  if (kind === 'cannot-start' || !status) {
    if (kind === 'cannot-start') {
      statusWrap.classList.add('assess-task-list__status--cannot-start');
      statusWrap.textContent = status || 'Cannot start yet';
    }
  } else {
    const tag = document.createElement('strong');
    tag.className = `assess-tag assess-tag--${kind}`;
    tag.textContent = status;
    statusWrap.appendChild(tag);
  }

  li.append(nameWrap, statusWrap);
  return li;
}

function syncShellChrome(isFullwidth) {
  const shell = $('view-shell');
  shell?.classList.toggle('is-hub', isFullwidth);
  if (isFullwidth) {
    closeCoachSheet();
    const pane = $('chat-pane');
    const resizer = $('chat-resizer');
    const fab = $('btn-open-coach');
    if (pane) pane.hidden = true;
    if (resizer) resizer.hidden = true;
    if (fab) fab.hidden = true;
  } else {
    setupChatPane(aiEnabled());
  }
}

function renderNav() {
  const wrap = $('nav-domains');
  wrap.innerHTML = '';
  const profileDone = profileComplete();

  for (const d of state.meta.domains) {
    const block = document.createElement('div');
    block.className = 'assess-nav-domain';
    block.dataset.domain = d.id;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assess-nav-item';
    btn.dataset.nav = `domain:${d.id}`;
    if (state.nav === `domain:${d.id}`) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'location');
    }
    btn.disabled = !profileDone;
    btn.classList.toggle('is-locked', !profileDone);

    const meta = domainNavMeta(d.id);
    const ragInfo = state.domainRag?.[d.id] || {
      rag: 'neutral',
      label: RAG_LABELS.neutral,
      levelText: '',
    };
    block.classList.add(`assess-nav-domain--rag-${ragInfo.rag}`);
    btn.classList.add(`assess-nav-item--rag-${ragInfo.rag}`);
    if (state.nav === `domain:${d.id}`) block.classList.add('is-open');
    btn.setAttribute('aria-label', domainNavAriaLabel(d.id, d.label));
    btn.innerHTML = `
      <span class="assess-nav-item-top">
        <span class="assess-nav-item-label">${escapeHtml(d.label)}</span>
        <span class="${domainNavTagClass(d.id)}">${escapeHtml(meta)}</span>
      </span>
      <span class="assess-nav-item-rag-row"${ragInfo.rag === 'neutral' ? ' hidden' : ''}>
        <span class="assess-nav-item-rag-status">${escapeHtml(ragInfo.rag === 'neutral' ? '' : ragInfo.label)}</span>
        <span class="assess-nav-item-rag-level"${ragInfo.levelText ? '' : ' hidden'}>${escapeHtml(ragInfo.levelText || '')}</span>
      </span>
    `;
    if (profileDone) {
      btn.addEventListener('click', () => showNav(`domain:${d.id}`));
    }

    block.appendChild(btn);
    wrap.appendChild(block);
  }

  syncProfileNavCheck();
  syncReportNavButton();
  syncDomainProgressUi();
}

async function showNav(key) {
  state.nav = key;
  scrollPageToTop();
  if (key.startsWith('domain:') || key === 'report' || key === 'welcome' || key === 'hub') {
    state.pendingOptional = false;
  }
  if (key.startsWith('domain:') && !processIntroSeen() && !isDemoMode()) {
    await markProcessIntroSeen();
  }
  document.querySelectorAll('.assess-nav-item').forEach((el) => {
    const active = el.dataset.nav === key;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'location');
    else el.removeAttribute('aria-current');
  });
  document.querySelectorAll('.assess-nav-domain').forEach((el) => {
    el.classList.toggle('is-open', key === `domain:${el.dataset.domain}`);
  });
  syncProfileNavCheck();

  const isHub = key === 'hub';
  const isProfile = key === 'profile';
  const isReport = key === 'report';
  const isWelcome = key === 'welcome';
  const isDomain = key.startsWith('domain:');
  const gated = isDomain && !profileComplete();
  const isFullwidth = isHub || isWelcome || isProfile || isReport;

  $('pane-hub').hidden = !isHub;
  $('pane-profile').hidden = !isProfile;
  $('pane-gated').hidden = !gated;
  $('pane-welcome').hidden = !isWelcome;
  $('pane-domain').hidden = isHub || isProfile || isReport || isWelcome || gated;
  $('pane-report').hidden = !isReport;
  syncShellChrome(isFullwidth);
  syncProfileBreadcrumbs();

  if (gated) {
    state.domain = null;
    state.questions = [];
    state.focusedId = null;
    return;
  }

  if (isHub) {
    state.domain = null;
    state.questions = [];
    state.focusedId = null;
    renderHub();
    updateChatFocus(null);
    return;
  }

  if (isWelcome) {
    state.domain = null;
    state.questions = [];
    state.focusedId = null;
    updateChatFocus(null);
    return;
  }

  if (isProfile) {
    state.domain = null;
    state.questions = [];
    state.focusedId = null;
    fillProfileForm();
    updateChatFocus(null);
    return;
  }

  if (isReport) {
    state.domain = null;
    state.questions = [];
    state.focusedId = null;
    renderBreadcrumbs($('report-breadcrumbs'), [
      { text: 'Your assessment', onClick: () => showNav('hub') },
    ]);
    updateChatFocus(null);
    refreshChatHistory();
    renderChatStarters();
    await loadProgressionReport();
    return;
  }

  const domain = key.replace(/^domain:/, '');
  state.domain = domain;
  state.questions = [];
  state.focusedId = null;
  syncReportNavButton();
  await openDomain(domain);
  updateChatFocus(null);
  refreshChatHistory();
  renderChatStarters();
}

async function ensureReportDeps() {
  if (state.reportDeps) return state.reportDeps;
  const [roleMapping, transversalsData] = await Promise.all([
    loadRoleMapping(),
    loadTransversals(),
  ]);
  state.reportDeps = {
    roleMapping,
    transversalsData,
    levelNames: roleMapping.level_names || state.meta?.levels || [],
  };
  return state.reportDeps;
}

async function loadProgressionReport() {
  const loading = $('report-loading');
  const errorEl = $('report-error');
  const content = $('report-content');
  if (!loading || !content) return;

  loading.hidden = false;
  errorEl.hidden = true;
  content.hidden = true;
  content.innerHTML = '';

  try {
    if (reviewedAnswerCount() === 0) {
      throw new Error('Confirm at least one question level to build a progression report.');
    }
    const [deps, report] = await Promise.all([
      ensureReportDeps(),
      fetchReport(state.session.id, { view: 'progression' }),
    ]);
    const persona = report.persona;
    if (!persona) {
      throw new Error(
        report.view === 'progression'
          ? 'Progression report was empty.'
          : 'Report did not include progression data. Restart the API server so ?view=progression is available.',
      );
    }

    renderPersonaReport(content, {
      persona,
      roleMapping: deps.roleMapping,
      transversalsData: deps.transversalsData,
      levelNames: deps.levelNames,
    });
    renderBreadcrumbs($('report-breadcrumbs'), [
      { text: 'Your assessment', onClick: () => showNav('hub') },
    ]);
    loading.hidden = true;
    content.hidden = false;
  } catch (err) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = err.message || 'Could not load progression report.';
  }
}

function pathwayLabelForId(id) {
  if (!id) return '';
  return PATHWAY_OPTION_LABELS[id]?.split(': ')[0] || id;
}

function fillProfileReadonly() {
  const wrap = $('profile-readonly');
  const editable = $('profile-editable');
  const footer = $('prof-footer');
  const title = $('profile-pane-title');
  const lead = $('profile-pane-lead');
  if (!wrap) return;

  if (!isDemoMode()) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    if (editable) editable.hidden = false;
    if (footer) footer.hidden = false;
    if (title) title.textContent = 'Your profile';
    if (lead) {
      lead.hidden = false;
      lead.textContent = 'Domains unlock once the required fields are complete.';
    }
    const next = $('prof-next');
    if (next) delete next.dataset.demoSkip;
    return;
  }

  const p = state.session.profile || {};
  const grade = state.meta.grades.find((g) => g.grade_id === p.grade_id);
  const rows = [
    ['Name', p.learner_name || p.name],
    ['Grade', grade ? `${grade.grade_name}: ${grade.full_title}` : p.grade_id],
    ['How they work', pathwayLabelForId(p.demonstration_pathway)],
    ['Role', p.role_title],
    ['Organisation', p.organisation],
  ].filter(([, v]) => v);

  wrap.innerHTML = `
    <dl class="assess-profile-dl">
      ${rows.map(([k, v]) => `<div class="assess-profile-dl-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
    </dl>
  `;
  wrap.hidden = false;
  if (editable) editable.hidden = true;
  if (footer) {
    footer.hidden = true;
    const next = $('prof-next');
    if (next) {
      next.textContent = 'Continue to your assessment';
      next.dataset.demoSkip = '1';
    }
  }
  if (title) title.textContent = 'Jordan’s profile';
  if (lead) {
    lead.hidden = true;
    lead.textContent = '';
  }
}

function fillProfileForm() {
  fillProfileReadonly();
  if (isDemoMode()) return;

  syncWizardChrome();
  const p = state.session.profile || {};
  $('prof-name').value = p.learner_name || p.name || '';
  populateGradeSelect($('prof-grade'), p.grade_id || '');
  populateProfilerSelects(
    $('prof-centrality'),
    $('prof-influence'),
    p,
    $('prof-pathway'),
  );
  syncPathwayVisibility('prof-grade', 'prof-pathway-wrap', 'prof-pathway');
  if (p.demonstration_pathway) $('prof-pathway').value = p.demonstration_pathway;
  $('prof-role').value = p.role_title || '';
  $('prof-organisation').value = p.organisation || '';
  $('prof-why').value = p.why || '';
  $('prof-notes').value = p.notes || '';

  if (state.pendingOptional && aiEnabled()) {
    showWizardStep('profile', 2);
  } else {
    state.pendingOptional = false;
    showWizardStep('profile', 1);
  }
}

async function onProfileSave({ goToDomains = false } = {}) {
  showError('');
  if (isDemoMode()) return;
  const err = validateMandatoryFields('prof');
  if (err) {
    showError(err.message, err.fieldId);
    return;
  }
  try {
    const grade_id = $('prof-grade').value;
    const pathwayEligible = gradeOrderForId(grade_id) >= pathwayMinGradeOrder();
    const payload = {
      learner_name: $('prof-name').value.trim(),
      grade_id,
      role_title: $('prof-role').value.trim(),
      organisation: $('prof-organisation').value.trim(),
      demonstration_pathway: pathwayEligible ? ($('prof-pathway').value || null) : null,
    };
    if (aiEnabled()) {
      payload.why = $('prof-why').value.trim();
      payload.notes = $('prof-notes').value.trim();
      payload.ddi_centrality = $('prof-centrality').value || null;
      payload.influence = $('prof-influence').value || null;
    }
    state.session = await patchSession(state.session.id, payload);
    state.pendingOptional = false;
    renderNav();
    syncProfileNavCheck();
    refreshLiveRag();
    renderChatStarters();
    if (!profileComplete()) {
      const again = validateMandatoryFields('prof');
      showError(
        again?.message || 'Save your name, grade, role and organisation to continue.',
        again?.fieldId,
      );
      showWizardStep('profile', 1);
      return;
    }
    if (goToDomains || state.nav === 'profile') {
      await showNav(postProfileLandingKey());
    }
  } catch (saveErr) {
    showError(saveErr.message);
  }
}

async function openDomain(domain) {
  showError('');
  const meta = state.meta.domains.find((d) => d.id === domain);
  $('domain-title').textContent = meta?.label || domain;
  // Short blurb stays in header only when overview is not showing; overview uses full description
  $('domain-blurb').textContent = '';
  $('domain-blurb').hidden = true;
  hideDomainChrome();
  updateQuestionProgress(null);
  state.focusedId = null;

  const run = state.session.domains?.find((d) => d.domain === domain);
  updateDomainCounts(state.session.domain_counts?.[domain]);

  $('domain-start').hidden = true;
  $('domain-qualify').hidden = true;
  $('domain-overview').hidden = true;
  $('domain-workspace').hidden = true;
  document.querySelector('.assess-domain-header')?.classList.remove('is-overview');

  if (run?.selection) {
    await loadQuestions(domain, { focus: false });
    showDomainOverview();
  } else {
    state.questions = [];
    if (isDemoMode()) {
      $('domain-overview').hidden = false;
      $('overview-groups').innerHTML = '<p class="assess-hint">No questions in this area for the case study.</p>';
    } else {
      showDomainStartLanding(domain);
    }
  }

  // Demo with existing selection: still skip qualify
  if (isDemoMode() && run?.selection) {
    $('domain-start').hidden = true;
    $('domain-qualify').hidden = true;
  }

  renderChatStarters();
  updateChatFocus(null);
}

function showDomainStartLanding(domain) {
  const meta = state.meta.domains.find((d) => d.id === domain);
  const label = meta?.label || domain;
  const { full } = splitDomainDescription(meta?.description || meta?.blurb || '');
  const start = $('domain-start');
  const descEl = $('domain-start-desc');
  const leadEl = $('domain-start-lead');
  const hintEl = $('domain-start-hint');
  const cta = $('btn-domain-start');
  const hasQuestions = domainHasQuestions(domain);
  if (descEl) {
    descEl.textContent = full || '';
    descEl.hidden = !full;
  }
  if (leadEl) {
    leadEl.textContent = hasQuestions
      ? `You have a set of ${label} questions for your role. Continue to rate yourself, or read about this area first.`
      : `A short pre-assessment decides which ${label} questions apply to your role.`;
  }
  if (hintEl) {
    hintEl.textContent = hasQuestions
      ? 'Use Continue to open your question list. You can update the pre-assessment from there if your remit has changed.'
      : 'You will answer a few choice questions about your exposure and remit. That unlocks a tailored question list for this area.';
  }
  if (cta) cta.textContent = hasQuestions ? 'Continue to your questions' : 'Start assessment';
  if (start) start.hidden = false;
  $('domain-qualify').hidden = true;
  $('domain-overview').hidden = true;
  $('domain-workspace').hidden = true;
  document.querySelector('.assess-domain-header')?.classList.remove('is-overview');
  showDomainBreadcrumbs(domainTrail());
}

async function beginDomainPreassess() {
  if (!state.domain || isDemoMode()) return;
  showError('');
  state.qualifyReturn = 'start';
  $('domain-start').hidden = true;
  $('domain-qualify').hidden = false;
  const run = state.session.domains?.find((d) => d.domain === state.domain);
  await renderQualifyForm(state.domain, run?.gates || {});
  const submitBtn = $('btn-qualify-submit');
  if (submitBtn) {
    submitBtn.hidden = false;
    submitBtn.textContent = 'Open questions for my role';
  }
  showDomainBreadcrumbs(domainTrail('Pre-assessment'));
}

function showDomainOverview() {
  state.focusedId = null;
  updateQuestionProgress(null);
  $('domain-start').hidden = true;
  $('domain-qualify').hidden = true;
  $('domain-workspace').hidden = true;
  $('domain-overview').hidden = false;
  document.querySelector('.assess-domain-header')?.classList.add('is-overview');
  renderDomainOverview();
  renderChatStarters();
  updateChatFocus(null);
  showDomainBreadcrumbs(domainTrail('Assessment'));
}

function groupQuestionsByCluster(questions) {
  const groups = [];
  const map = new Map();
  for (const q of questions || []) {
    const key = q.cluster || 'Other';
    if (!map.has(key)) {
      const group = { cluster: key, questions: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).questions.push(q);
  }
  return groups;
}

function findQuestion(id) {
  return (state.questions || []).find((q) => q.question_id === id)
    || (state.catalogueQuestions || []).find((q) => q.question_id === id)
    || null;
}

function questionInSelection(id) {
  return (state.questions || []).some((q) => q.question_id === id);
}

function overviewLevelLabel(q) {
  if (q.status === 'skipped') return 'Skipped';
  if (q.status === 'reviewed' && q.level != null) return levelLabel(q.level);
  if (q.status === 'ai_suggested' && q.level != null && aiEnabled()) {
    return `${levelLabel(q.level)} (suggested)`;
  }
  return 'Not rated';
}

function overviewQuestionItem(q, shareStem) {
  const li = document.createElement('li');
  const row = document.createElement('div');
  row.className = 'assess-overview-q';
  if (q.in_selection === false) row.classList.add('is-unselected');
  if (q.status === 'reviewed') row.classList.add('is-rated');
  if (q.status === 'skipped') row.classList.add('is-skipped');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'assess-overview-q-open';
  const qLabel = shareStem && q.in_selection !== false ? navQuestionLabel(q.question) : q.question;
  btn.innerHTML = `<span class="assess-overview-q-text">${escapeHtml(qLabel)}</span>`;
  btn.addEventListener('click', () => focusQuestion(q.question_id));
  row.appendChild(btn);

  if (q.in_selection === false && !isDemoMode()) {
    const include = document.createElement('button');
    include.type = 'button';
    include.className = 'btn btn-secondary btn-sm assess-overview-include';
    include.textContent = 'Include';
    include.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      includeQuestion(q.question_id, { open: false });
    });
    row.appendChild(include);
  } else {
    const level = document.createElement('span');
    level.className = 'assess-overview-q-level';
    level.textContent = overviewLevelLabel(q);
    row.appendChild(level);
  }

  li.appendChild(row);
  return li;
}

function overviewQuestionsForDisplay() {
  const selected = state.questions || [];
  if (!state.showCatalogue) return selected;
  return [...selected, ...(state.catalogueQuestions || [])];
}

function groupOverviewQuestions(questions) {
  const groups = groupQuestionsByCluster(questions);
  for (const group of groups) {
    group.questions.sort((a, b) => {
      const aSel = a.in_selection !== false ? 0 : 1;
      const bSel = b.in_selection !== false ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return 0;
    });
  }
  return groups;
}

async function editDomainPreassess() {
  if (!state.domain || isDemoMode()) return;
  showError('');
  state.qualifyReturn = 'overview';
  $('domain-overview').hidden = true;
  $('domain-workspace').hidden = true;
  $('domain-start').hidden = true;
  $('domain-qualify').hidden = false;
  document.querySelector('.assess-domain-header')?.classList.remove('is-overview');
  const run = state.session.domains?.find((d) => d.domain === state.domain);
  await renderQualifyForm(state.domain, run?.gates || {});
  const submitBtn = $('btn-qualify-submit');
  if (submitBtn) {
    submitBtn.hidden = false;
    submitBtn.textContent = 'Save and refresh questions';
  }
  showDomainBreadcrumbs(domainTrail('Pre-assessment'));
}

function splitDomainDescription(text) {
  const raw = String(text || '').trim();
  if (!raw) return { lead: '', full: '' };
  const marker = /\s+This domain is here\b/i;
  const match = raw.match(marker);
  if (!match) return { lead: raw, full: raw };
  return {
    lead: raw.slice(0, match.index).trim(),
    full: raw,
  };
}

function clusterSummary(domainId, clusterName) {
  const meta = state.meta.domains.find((d) => d.id === domainId);
  const key = `${domainId}|${clusterName}`;
  return meta?.cluster_summaries?.[key] || '';
}

function renderDomainOverview() {
  const groupsEl = $('overview-groups');
  if (!groupsEl) return;

  const meta = state.meta.domains.find((d) => d.id === state.domain);
  const label = meta?.label || state.domain || 'area';

  const { full } = splitDomainDescription(meta?.description || meta?.blurb || '');
  const leadEl = $('overview-lead');
  const introHeading = $('overview-intro-heading');
  if (introHeading) {
    introHeading.textContent = `Why ${label} is important, and what it covers`;
  }
  if (leadEl) leadEl.textContent = full || '';

  const selectedCount = state.questions.length;
  const catalogueCount = (state.catalogueQuestions || []).length;
  const qLead = $('overview-questions-lead');
  if (qLead) {
    qLead.textContent = selectedCount
      ? `${selectedCount} question${selectedCount === 1 ? '' : 's'} selected for your role. Open one to rate yourself. Your level shows beside each once answered.`
      : 'No questions selected for this area yet.';
  }

  const toolbar = $('overview-toolbar');
  const toggle = $('overview-show-catalogue');
  const catalogueHint = $('overview-catalogue-hint');
  if (toolbar) {
    toolbar.hidden = isDemoMode() || !selectedCount;
  }
  if (toggle) {
    toggle.checked = state.showCatalogue;
    toggle.disabled = isDemoMode();
  }
  if (catalogueHint) {
    if (!state.showCatalogue) {
      catalogueHint.hidden = true;
      catalogueHint.textContent = '';
    } else {
      catalogueHint.hidden = false;
      catalogueHint.textContent = catalogueCount
        ? `${catalogueCount} other question${catalogueCount === 1 ? '' : 's'} in this area, shown greyed out. Use Include to add one, or open it and choose a level.`
        : 'No other questions in this area. Your list already includes all of them.';
    }
  }

  if (!selectedCount && !state.showCatalogue) {
    groupsEl.innerHTML = '<p class="assess-hint">Complete the short questions above to open a set for your role.</p>';
    return;
  }

  const displayQuestions = overviewQuestionsForDisplay();
  if (!displayQuestions.length) {
    groupsEl.innerHTML = '<p class="assess-hint">No other questions in this area for your grade.</p>';
    return;
  }

  const shareStem = questionsShareStem(displayQuestions.filter((q) => q.in_selection !== false));
  const groups = groupOverviewQuestions(displayQuestions);
  groupsEl.innerHTML = '';
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'assess-overview-cluster';

    const h3 = document.createElement('h3');
    h3.className = 'assess-overview-cluster-title';
    h3.textContent = group.cluster;
    section.appendChild(h3);

    const summary = clusterSummary(state.domain, group.cluster);
    if (summary) {
      const p = document.createElement('p');
      p.className = 'assess-overview-cluster-summary';
      p.textContent = summary;
      section.appendChild(p);
    }

    const selectedQs = group.questions.filter((q) => q.in_selection !== false);
    const extraQs = group.questions.filter((q) => q.in_selection === false);

    if (selectedQs.length) {
      const ul = document.createElement('ul');
      ul.className = 'assess-overview-q-list';
      for (const q of selectedQs) {
        ul.appendChild(overviewQuestionItem(q, shareStem));
      }
      section.appendChild(ul);
    }
    if (extraQs.length) {
      const extraLabel = document.createElement('p');
      extraLabel.className = 'assess-overview-unselected-label';
      extraLabel.textContent = 'Not selected for your role';
      section.appendChild(extraLabel);
      const extraUl = document.createElement('ul');
      extraUl.className = 'assess-overview-q-list';
      for (const q of extraQs) {
        extraUl.appendChild(overviewQuestionItem(q, false));
      }
      section.appendChild(extraUl);
    }
    groupsEl.appendChild(section);
  }
}

function updateDomainCounts(counts) {
  // Counts live in the left nav only; main panel stays focused on the question.
  void counts;
}

function domainLabel(domainId = state.domain) {
  return state.meta?.domains?.find((d) => d.id === domainId)?.label || domainId || 'Area';
}

function domainTrail(currentStep, { linkCurrent = false } = {}) {
  const items = [
    { text: 'Your assessment', onClick: () => showNav('hub') },
  ];
  const label = domainLabel();
  if (currentStep) {
    items.push({ text: label, onClick: () => showDomainStartLanding(state.domain) });
    items.push(linkCurrent
      ? { text: currentStep, onClick: () => showDomainOverview() }
      : { text: currentStep });
  } else {
    items.push({ text: label });
  }
  return items;
}

function domainHasQuestions(domainId = state.domain) {
  const run = state.session?.domains?.find((d) => d.domain === domainId);
  return Boolean(run?.selection);
}

function hideDomainChrome() {
  const crumbs = $('domain-breadcrumbs');
  const back = $('domain-back-link');
  if (crumbs) {
    crumbs.hidden = true;
    crumbs.innerHTML = '';
  }
  if (back) {
    back.hidden = true;
    back.onclick = null;
  }
}

function renderBreadcrumbs(navEl, items) {
  if (!navEl) return;
  navEl.innerHTML = '';
  if (!items?.length) {
    navEl.hidden = true;
    return;
  }
  const ol = document.createElement('ol');
  ol.className = 'assess-breadcrumbs-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'assess-breadcrumbs-item';
    if (item.onClick) {
      const a = document.createElement('a');
      a.className = 'assess-breadcrumbs-link';
      a.href = '#';
      a.textContent = item.text;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        item.onClick();
      });
      li.appendChild(a);
    } else {
      li.textContent = item.text;
    }
    ol.appendChild(li);
  }
  navEl.appendChild(ol);
  navEl.hidden = false;
}

function showDomainBreadcrumbs(items) {
  hideDomainBackLink();
  renderBreadcrumbs($('domain-breadcrumbs'), items);
}

function hideDomainBackLink() {
  const back = $('domain-back-link');
  if (!back) return;
  back.hidden = true;
  back.onclick = null;
}

function showDomainBackLink(onClick) {
  const crumbs = $('domain-breadcrumbs');
  if (crumbs) {
    crumbs.hidden = true;
    crumbs.innerHTML = '';
  }
  const back = $('domain-back-link');
  if (!back) return;
  back.hidden = false;
  back.onclick = (e) => {
    e.preventDefault();
    onClick();
  };
}

function updateQuestionBreadcrumb(q) {
  if (!q) {
    updateQuestionProgress(null);
    return;
  }
  showDomainBreadcrumbs(domainTrail('Assessment', { linkCurrent: true }));
  updateQuestionProgress(q);
}

async function renderQualifyForm(domain, existingAnswers = {}) {
  const config = await fetchGates(state.session.id, domain);
  state.gatesConfig = config;
  const form = $('qualify-form');
  form.innerHTML = '';
  const answers = { ...existingAnswers };

  function visibleGates() {
    return (config.gates || []).filter((g) => {
      if (!aiEnabled() && g.type === 'textarea') return false;
      if (!g.depends_on) return true;
      return Object.entries(g.depends_on).every(([key, allowed]) => allowed.includes(answers[key]));
    });
  }

  function redraw() {
    form.innerHTML = '';
    for (const gate of visibleGates()) {
      const wrap = document.createElement('div');
      const label = document.createElement('label');
      label.className = 'assess-label';
      label.textContent = gate.prompt;
      wrap.appendChild(label);
      if (gate.type === 'textarea') {
        const ta = document.createElement('textarea');
        ta.className = 'assess-textarea';
        ta.rows = 3;
        ta.placeholder = gate.placeholder || '';
        ta.value = answers[gate.id] || '';
        ta.addEventListener('input', () => { answers[gate.id] = ta.value; });
        wrap.appendChild(ta);
      } else {
        const opts = document.createElement('div');
        opts.className = 'assess-gate-options';
        for (const opt of gate.options || []) {
          const id = typeof opt === 'string' ? opt : opt.id;
          const lab = typeof opt === 'string' ? opt : opt.label;
          const row = document.createElement('label');
          row.className = 'assess-gate-option';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = gate.id;
          input.value = id;
          if (answers[gate.id] === id) input.checked = true;
          input.addEventListener('change', () => {
            answers[gate.id] = id;
            redraw();
          });
          row.append(input, document.createTextNode(lab));
          opts.appendChild(row);
        }
        wrap.appendChild(opts);
      }
      form.appendChild(wrap);
    }

    if (aiEnabled()) {
      const ctx = document.createElement('div');
      const ctxLabel = document.createElement('label');
      ctxLabel.className = 'assess-label';
      ctxLabel.htmlFor = 'qualify-context';
      ctxLabel.textContent = 'Anything else useful about your work in this area?';
      const ctxTa = document.createElement('textarea');
      ctxTa.id = 'qualify-context';
      ctxTa.className = 'assess-textarea';
      ctxTa.rows = 4;
      ctxTa.placeholder = 'Tools you use, remit, projects, constraints…';
      ctxTa.value = answers.domain_context || '';
      ctxTa.addEventListener('input', () => { answers.domain_context = ctxTa.value; });
      ctx.append(ctxLabel, ctxTa);
      form.appendChild(ctx);
    }

    form._answers = answers;
  }
  redraw();
}

async function onQualifySubmit(e) {
  e.preventDefault();
  if (isDemoMode()) return;
  showError('');
  const answers = $('qualify-form')._answers || {};
  const required = (state.gatesConfig.gates || []).filter((g) => {
    if (g.type === 'textarea') return false;
    if (!g.depends_on) return true;
    return Object.entries(g.depends_on).every(([k, allowed]) => allowed.includes(answers[k]));
  });
  for (const g of required) {
    if (!answers[g.id]) {
      showError('Please answer each qualification question.');
      return;
    }
  }
  try {
    const result = await qualifyDomain(state.session.id, state.domain, answers);
    state.session = result.session;
    renderNav();
    updateDomainCounts(result.domain_counts);
    await loadQuestions(state.domain, { focus: false });
    const submitBtn = $('btn-qualify-submit');
    if (submitBtn) submitBtn.textContent = 'Save and refresh questions';
    renderChatStarters();
    showDomainOverview();
  } catch (err) {
    showError(err.message);
  }
}

async function loadQuestions(domain, { preferNext = false, focus = true } = {}) {
  const data = await fetchQuestions(state.session.id, domain, { extended: state.showCatalogue });
  state.questions = data.questions || [];
  state.catalogueQuestions = data.catalogue || [];
  updateDomainCounts(data.counts);
  if (!focus) {
    state.focusedId = null;
    renderDomainOverview();
    return;
  }
  if (!state.questions.length) {
    state.focusedId = null;
    updateQuestionBreadcrumb(null);
    $('question-detail').innerHTML = '<p class="assess-hint">No questions in this selection.</p>';
    return;
  }

  const pending = (q) => q.status === 'empty' || q.status === 'ai_suggested';
  let targetId = state.focusedId;

  if (preferNext && state.focusedId) {
    const idx = state.questions.findIndex((q) => q.question_id === state.focusedId);
    const after = state.questions.slice(idx + 1).find(pending);
    const any = state.questions.find(pending);
    targetId = after?.question_id || any?.question_id || null;
    if (!targetId) {
      showDomainOverview();
      return;
    }
  } else if (!targetId || !state.questions.some((q) => q.question_id === targetId)) {
    targetId = (state.questions.find(pending) || state.questions[0]).question_id;
  }

  await focusQuestion(targetId);
}

async function includeQuestion(questionId, { open = false } = {}) {
  if (isDemoMode() || questionInSelection(questionId)) {
    if (open) await focusQuestion(questionId);
    return;
  }
  showError('');
  try {
    const result = await includeDomainQuestion(state.session.id, state.domain, questionId);
    state.session = result.session;
    renderNav();
    syncProfileNavCheck();
    refreshLiveRag();
    state.focusedId = open ? questionId : null;
    await loadQuestions(state.domain, { focus: open });
  } catch (err) {
    showError(err.message);
  }
}

async function focusQuestion(id) {
  const q = findQuestion(id);
  if (!q) return;

  state.focusedId = id;
  state.activeTask = 'help_question';
  $('domain-start').hidden = true;
  $('domain-qualify').hidden = true;
  $('domain-overview').hidden = true;
  $('domain-workspace').hidden = false;
  document.querySelector('.assess-domain-header')?.classList.remove('is-overview');
  updateQuestionBreadcrumb(q);
  updateQuestionProgress(q);
  updateChatFocus(q);
  renderQuestionDetail(q);
  refreshChatHistory();
  renderChatStarters();
}

function currentThreadKey() {
  if (state.nav === 'profile') return 'profile';
  if (state.nav === 'report') return 'report';
  if (state.focusedId) return `question:${state.focusedId}`;
  if (state.domain) return `domain:${state.domain}`;
  return 'profile';
}

function threadLabel(threadKey = currentThreadKey()) {
  if (threadKey === 'profile') return 'Conversation: profile';
  if (threadKey === 'report') return 'Conversation: report';
  if (threadKey.startsWith('domain:')) {
    const domain = threadKey.slice('domain:'.length);
    const label = state.meta?.domains?.find((d) => d.id === domain)?.label || domain;
    return `Conversation: ${label}`;
  }
  if (threadKey.startsWith('question:')) {
    const qid = threadKey.slice('question:'.length);
    const q = findQuestion(qid)
      || state.session?.answers?.find((a) => a.question_id === qid);
    const strand = findQuestion(qid)?.strand;
    return strand ? `Conversation: this question (${strand})` : 'Conversation: this question';
  }
  return 'Conversation';
}

function messagesForCurrentThread() {
  const key = currentThreadKey();
  return (state.session?.messages || []).filter((m) => m.thread_key === key);
}

function updateChatFocus(q) {
  const el = $('chat-focus');
  if (!el) return;
  el.textContent = threadLabel();
  syncClearChatButton();
}

function syncClearChatButton() {
  const btn = $('btn-clear-chat');
  if (!btn || !aiEnabled()) return;
  const n = messagesForCurrentThread().length;
  btn.hidden = n === 0;
  btn.disabled = state.busy;
}

function refreshChatHistory() {
  const box = $('chat-messages');
  if (!box) return;
  box.innerHTML = '';
  for (const m of messagesForCurrentThread()) {
    appendChatBubble(m.role, m.content);
  }
  syncClearChatButton();
}

async function onClearChat() {
  if (!aiEnabled() || state.busy || !state.session) return;
  const threadKey = currentThreadKey();
  if (!messagesForCurrentThread().length) return;
  if (!confirm('Clear this conversation? What you said in other places stays available as AI context until you clear those too.')) return;
  showError('');
  try {
    const result = await clearChatThread(state.session.id, threadKey);
    state.session = result.session;
    refreshChatHistory();
    renderChatStarters();
  } catch (err) {
    showError(err.message);
  }
}

function renderQuestionDetail(q) {
  const detail = $('question-detail');
  detail.innerHTML = '';
  const readOnly = isDemoMode();

  const title = document.createElement('h2');
  title.className = 'assess-card-question';
  title.textContent = q.question;
  detail.appendChild(title);

  if (readOnly && q.level) {
    const note = document.createElement('p');
    note.className = 'assess-readonly-note';
    note.textContent = `Jordan rated this: ${levelLabel(q.level)}.`;
    detail.appendChild(note);
  }

  if (aiEnabled() && q.ai_rationale) {
    const rat = document.createElement('div');
    rat.className = 'assess-rationale';
    rat.innerHTML = `<strong>Why this level</strong><div>${escapeHtml(q.ai_rationale)}</div>`;
    if (q.evidence?.length) {
      const ul = document.createElement('ul');
      ul.className = 'assess-evidence';
      for (const e of q.evidence) {
        const li = document.createElement('li');
        li.textContent = e;
        ul.appendChild(li);
      }
      rat.appendChild(ul);
    }
    detail.appendChild(rat);
  }

  const list = document.createElement('div');
  list.className = 'assess-descriptors';
  const selected = q.level;

  for (const d of q.descriptors || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assess-descriptor';
    if (readOnly) {
      btn.disabled = true;
      btn.classList.add('is-readonly');
    }
    if (d.stretch) btn.classList.add('is-stretch');
    if (aiEnabled() && d.level === q.level && q.status === 'ai_suggested') {
      btn.classList.add('is-suggested');
    }
    if (d.level === selected) btn.classList.add('is-selected');
    const levelEl = document.createElement('span');
    levelEl.className = 'assess-descriptor-level';
    levelEl.textContent = d.level_name || levelLabel(d.level);
    if (d.stretch) {
      const badge = document.createElement('span');
      badge.className = 'assess-stretch-badge';
      badge.textContent = 'May be a stretch for your role';
      levelEl.appendChild(badge);
    }
    const textEl = document.createElement('span');
    textEl.className = 'assess-descriptor-text';
    textEl.textContent = getDescriptorDisplayText(d, DESCRIPTOR_VOICE_SELF);
    btn.append(levelEl, textEl);
    if (!readOnly) {
      btn.addEventListener('click', () => {
        list.querySelectorAll('.assess-descriptor').forEach((el) => el.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        saveAnswer(q.question_id, d.level, 'reviewed');
      });
    }
    list.appendChild(btn);
  }
  detail.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'assess-card-actions';

  const navList = q.in_selection === false
    ? overviewQuestionsForDisplay()
    : state.questions;
  const idx = navList.findIndex((x) => x.question_id === q.question_id);
  const nextQ = navList[idx + 1];
  const prevQ = navList[idx - 1];
  if (prevQ) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn btn-secondary assess-card-nav-prev';
    prevBtn.textContent = 'Previous';
    prevBtn.addEventListener('click', () => focusQuestion(prevQ.question_id));
    actions.appendChild(prevBtn);
  }
  if (nextQ) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn-secondary assess-card-nav-next';
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => focusQuestion(nextQ.question_id));
    actions.appendChild(nextBtn);
  } else {
    const finishBtn = document.createElement('button');
    finishBtn.type = 'button';
    finishBtn.className = 'btn btn-primary assess-card-nav-next';
    finishBtn.textContent = 'Finish';
    finishBtn.addEventListener('click', () => showDomainOverview());
    actions.appendChild(finishBtn);
  }

  if (actions.childElementCount) detail.appendChild(actions);
}

async function saveAnswer(questionId, level, status) {
  if (isDemoMode()) return;
  showError('');
  try {
    if (!questionInSelection(questionId)) {
      const included = await includeDomainQuestion(state.session.id, state.domain, questionId);
      state.session = included.session;
      renderNav();
    }
    const result = await postAnswer(state.session.id, state.domain, {
      question_id: questionId,
      level,
      status,
    });
    state.session = result.session;
    renderNav();
    syncProfileNavCheck();
    refreshLiveRag();
    updateDomainCounts(result.counts);
    await loadQuestions(state.domain, { preferNext: false, focus: true });
    if (result.complete) {
      try {
        await completeDomain(state.session.id, state.domain);
        state.session = await getSession(state.session.id);
        renderNav();
        syncProfileNavCheck();
        refreshLiveRag();
      } catch {
        /* non-fatal */
      }
    }
    renderChatStarters();
  } catch (err) {
    showError(err.message);
  }
}

async function runPrefill({ quiet = false } = {}) {
  if (!aiEnabled() || !state.domain) {
    if (!quiet) showError('Open a domain first, then ask the coach to suggest levels.');
    return;
  }
  if (state.busy && !quiet) return;
  const wasBusy = state.busy;
  state.busy = true;
  const status = $('chat-status');
  const statusText = $('chat-status-text');
  if (status) {
    status.hidden = false;
    if (statusText) statusText.textContent = 'Suggesting levels for this domain…';
  }
  if (!quiet) {
    appendChatBubble('user', `Suggest levels for ${state.domain} based on my profile and notes.`);
  }
  try {
    let updateCount = 0;
    await prefillDomain(state.session.id, state.domain, (event, data) => {
      if (event === 'status' && statusText) statusText.textContent = data.message || 'Working…';
      if (event === 'session') {
        state.session = data;
        renderNav();
        refreshLiveRag();
      }
      if (event === 'prefill' && Array.isArray(data.updates)) {
        updateCount = data.updates.length;
      }
    });
    state.session = await getSession(state.session.id);
    await loadQuestions(state.domain, { focus: Boolean(state.focusedId) });
    refreshLiveRag();
    if (!quiet || updateCount > 0) {
      appendChatBubble(
        'assistant',
        updateCount > 0
          ? `Suggested levels on **${updateCount}** question${updateCount === 1 ? '' : 's'}. Review each **AI suggested** item in **${state.domain}**. Nothing is final until you save.`
          : `I did not have enough evidence to suggest levels yet. Add a bit more about your work in this domain, then try again.`,
      );
    }
    renderChatStarters();
  } catch (err) {
    appendChatBubble('assistant', err.message || 'Could not suggest levels.');
    if (!quiet) showError(err.message);
  } finally {
    state.busy = wasBusy ? true : false;
    if (!wasBusy && status) status.hidden = true;
  }
}

function coachTaskDefs() {
  const domain = state.domain;
  const domainLabel = domain
    ? (state.meta.domains.find((d) => d.id === domain)?.label || domain)
    : null;
  const run = domain
    ? state.session?.domains?.find((d) => d.domain === domain)
    : null;
  const onQuestion = Boolean(state.focusedId);
  const onDomain = Boolean(domain) && !onQuestion && String(state.nav || '').startsWith('domain:');

  if (onQuestion) {
    return [{
      id: 'help_question',
      label: 'Help me answer this question',
      task: 'help_question',
      placeholder: 'Describe your knowledge of this question/area and let the AI help you',
    }];
  }

  if (onDomain) {
    const tasks = [];
    if (run?.selection) {
      tasks.push({
        id: 'help_domain',
        label: 'Help answer all questions in this domain',
        task: 'help_domain',
        placeholder: 'Describe your knowledge of this domain. The AI will coach you or suggest levels across the questions',
      });
    }
    if (run?.gates || run?.selection) {
      tasks.push({
        id: 'scope_role',
        label: 'Scope relevant questions to my role',
        task: 'scope_role',
        placeholder: 'Describe your role and remit in this domain so we can pick the most relevant questions',
      });
    }
    return tasks;
  }

  return [];
}

function syncCoachInput() {
  const input = $('chat-input');
  const send = $('chat-send') || document.querySelector('#chat-form button[type="submit"]');
  if (!input) return;
  const tasks = coachTaskDefs();
  const active = tasks.find((t) => t.task === state.activeTask) || null;

  if (!aiEnabled()) {
    input.disabled = true;
    if (send) send.disabled = true;
    return;
  }

  if (!tasks.length) {
    state.activeTask = null;
    input.disabled = true;
    input.placeholder = 'Open a domain or question to use the coach';
    if (send) send.disabled = true;
    return;
  }

  if (!active) {
    input.disabled = true;
    input.placeholder = 'Choose a coach task above…';
    if (send) send.disabled = true;
    return;
  }

  input.disabled = state.busy;
  input.placeholder = active.placeholder;
  if (send) send.disabled = state.busy;
}

function ensureActiveCoachTask() {
  const tasks = coachTaskDefs();
  if (!tasks.length) {
    state.activeTask = null;
    return;
  }
  if (tasks.some((t) => t.task === state.activeTask)) return;
  // Auto-select the only task (question), otherwise wait for an explicit choice.
  state.activeTask = tasks.length === 1 ? tasks[0].task : null;
}

function renderChatStarters() {
  const wrap = $('chat-starters');
  if (!wrap || !aiEnabled()) return;
  ensureActiveCoachTask();
  wrap.innerHTML = '';

  const tasks = coachTaskDefs();
  const heading = document.createElement('p');
  heading.className = 'assess-chat-starters-label';
  heading.textContent = 'Coach tasks';
  wrap.appendChild(heading);

  if (!tasks.length) {
    const hint = document.createElement('p');
    hint.className = 'assess-chat-empty-hint';
    hint.textContent = 'Open a domain or a question to use set coach tasks.';
    wrap.appendChild(hint);
    syncCoachInput();
    return;
  }

  const list = document.createElement('div');
  list.className = 'assess-chat-starters-list';
  for (const s of tasks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assess-chat-starter' + (state.activeTask === s.task ? ' is-active' : '');
    btn.textContent = s.label;
    btn.disabled = state.busy;
    btn.addEventListener('click', () => {
      state.activeTask = s.task;
      renderChatStarters();
      $('chat-input')?.focus();
    });
    list.appendChild(btn);
  }
  wrap.appendChild(list);
  syncCoachInput();
}

async function runScopeToRole(message) {
  if (!aiEnabled() || !state.domain || state.busy) return;
  const run = state.session?.domains?.find((d) => d.domain === state.domain);
  if (!run?.gates && !run?.selection) {
    showError('Complete domain qualification first, then scope questions to your role.');
    return;
  }

  state.busy = true;
  const status = $('chat-status');
  const statusText = $('chat-status-text');
  if (status) {
    status.hidden = false;
    if (statusText) statusText.textContent = 'Scoping questions to your role…';
  }
  if (message) appendChatBubble('user', message);

  let streamed = '';
  const live = document.createElement('div');
  live.className = 'assess-chat-bubble assess-chat-bubble--assistant';
  $('chat-messages').appendChild(live);

  try {
    const gates = $('qualify-form')?._answers || run.gates || {};
    await selectDomainQuestions(state.session.id, state.domain, {
      message: message || '',
      gates,
    }, (event, data) => {
      if (event === 'status' && statusText) statusText.textContent = data.message || 'Working…';
      if (event === 'text') {
        streamed += data.delta || '';
        live.innerHTML = renderMarkdown(streamed);
      }
      if (event === 'session') {
        state.session = data;
        renderNav();
        refreshLiveRag();
      }
    });
    if (!streamed) live.remove();
    state.session = await getSession(state.session.id);
    state.focusedId = null;
    await loadQuestions(state.domain, { focus: false });
    state.activeTask = 'help_domain';
    appendChatBubble(
      'assistant',
      'Questions are updated for your role. You can now **help answer all questions in this domain**, or open a question for one-at-a-time coaching.',
    );
    refreshChatHistory();
    renderChatStarters();
    updateChatFocus(null);
  } catch (err) {
    live.textContent = err.message;
    showError(err.message);
  } finally {
    state.busy = false;
    if (status) status.hidden = true;
    syncClearChatButton();
    syncCoachInput();
  }
}

function appendChatBubble(role, content) {
  const box = $('chat-messages');
  const div = document.createElement('div');
  div.className = `assess-chat-bubble assess-chat-bubble--${role === 'user' ? 'user' : 'assistant'}`;
  if (role === 'assistant') div.innerHTML = renderMarkdown(content);
  else div.textContent = content;
  box.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function onChatSubmit(e) {
  e.preventDefault();
  if (!state.meta.ai_enabled || state.busy) return;
  const message = $('chat-input').value.trim();
  if (!message) return;

  ensureActiveCoachTask();
  if (!state.activeTask) {
    showError('Choose a coach task first.');
    return;
  }

  if (state.activeTask === 'scope_role') {
    $('chat-input').value = '';
    await runScopeToRole(message);
    return;
  }

  state.busy = true;
  $('chat-input').value = '';
  appendChatBubble('user', message);
  const status = $('chat-status');
  const statusText = $('chat-status-text');
  status.hidden = false;
  statusText.textContent = 'Thinking…';
  syncCoachInput();

  let streamed = '';
  const live = document.createElement('div');
  live.className = 'assess-chat-bubble assess-chat-bubble--assistant';
  $('chat-messages').appendChild(live);

  try {
    await chatSession(state.session.id, {
      message,
      domain: state.domain,
      focused_question_id: state.activeTask === 'help_question' ? state.focusedId : null,
      thread_key: currentThreadKey(),
      task: state.activeTask,
    }, (event, data) => {
      if (event === 'status') statusText.textContent = data.message || 'Working…';
      if (event === 'text') {
        streamed += data.delta || '';
        live.innerHTML = renderMarkdown(streamed);
      }
      if (event === 'session') {
        state.session = data;
        renderNav();
        refreshLiveRag();
      }
      if (event === 'chat_result' && data.applied?.length && state.domain) {
        loadQuestions(state.domain, { focus: Boolean(state.focusedId) });
      }
    });
    if (!streamed) live.remove();

    // Domain help: also bulk-suggest from what they wrote when there is enough text.
    if (state.activeTask === 'help_domain' && state.domain && message.length >= 40) {
      statusText.textContent = 'Suggesting levels across the domain…';
      await runPrefill({ quiet: true });
    }

    state.session = await getSession(state.session.id);
    if (state.domain) await loadQuestions(state.domain, { focus: Boolean(state.focusedId) });
    refreshChatHistory();
    renderChatStarters();
  } catch (err) {
    live.textContent = err.message;
    showError(err.message);
  } finally {
    state.busy = false;
    status.hidden = true;
    syncClearChatButton();
    syncCoachInput();
  }
}

/* Boot */

async function init() {
  await mountAssessHeader();
  syncHeaderHeight();
  window.addEventListener('resize', syncHeaderHeight);
  setupChatResizer();
  state.user = null;

  try {
    state.meta = await fetchMeta();
  } catch (err) {
    showError(err.message);
    return;
  }

  document.body.classList.toggle('assess-ai-off', !aiEnabled());
  $('view-shell')?.classList.toggle('is-ai-off', !aiEnabled());
  setupChatPane(aiEnabled());
  syncWizardChrome();
  syncHeaderHeight();

  $('btn-new-assessment').addEventListener('click', showIntake);
  $('btn-intake-back').addEventListener('click', async () => {
    setView('list');
    await renderSessionList();
  });
  $('intake-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    onIntakeSubmit(e);
  });
  $('intake-grade')?.addEventListener('change', () => {
    syncPathwayVisibility('intake-grade', 'intake-pathway-wrap', 'intake-pathway');
  });
  $('intake-next')?.addEventListener('click', () => onIntakeSubmit(new Event('submit')));
  $('btn-welcome-continue')?.addEventListener('click', () => continueFromWelcome());
  $('btn-domain-start')?.addEventListener('click', () => {
    if (domainHasQuestions(state.domain)) showDomainOverview();
    else beginDomainPreassess();
  });
  $('btn-goto-profile')?.addEventListener('click', () => showNav('profile'));
  $('btn-edit-preassessment')?.addEventListener('click', () => editDomainPreassess());
  $('overview-show-catalogue')?.addEventListener('change', async (e) => {
    state.showCatalogue = Boolean(e.target.checked);
    if (!state.domain) return;
    try {
      await loadQuestions(state.domain, { focus: false });
    } catch (err) {
      showError(err.message);
    }
  });
  $('profile-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    advanceWizard('profile', 1);
  });
  $('prof-grade')?.addEventListener('change', () => {
    syncPathwayVisibility('prof-grade', 'prof-pathway-wrap', 'prof-pathway');
  });
  $('prof-next')?.addEventListener('click', () => advanceWizard('profile', 1));
  $('qualify-form').addEventListener('submit', onQualifySubmit);
  $('btn-clear-chat')?.addEventListener('click', () => onClearChat());
  $('btn-open-coach')?.addEventListener('click', () => openCoachSheet());
  $('btn-close-coach')?.addEventListener('click', () => closeCoachSheet());
  $('chat-backdrop')?.addEventListener('click', () => closeCoachSheet());
  $('chat-form').addEventListener('submit', onChatSubmit);

  const params = new URLSearchParams(window.location.search);
  const hash = (window.location.hash || '').replace(/^#/, '').split('&')[0];
  const isDemo = isDemoEntry();
  const id = isDemo ? (params.get('id') || DEMO_SESSION_ID) : params.get('id');

  if (id) {
    try {
      await openSession(id, { demo: isDemo });
      return;
    } catch (err) {
      if (isDemo) {
        showError(err.message || 'Could not load the example assessment.');
        return;
      }
      history.replaceState(null, '', appListPath());
    }
  }

  if (params.get('new') === '1' || hash === 'start') {
    showIntake();
    return;
  }

  setView('list');
  await renderSessionList();
}

init();
