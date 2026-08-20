import { isAiApiConfigured } from './ai-config.js';
import {
  ensureData,
  buildMeta,
  computeProfile,
  normalizeDomain,
  gatesForProfile,
  deterministicSelect,
  getQuestionById,
  collectDomainQuestions,
  descriptorsWithStretch,
  buildDomainReport,
  buildFullReport,
  buildProgressionReport,
  mergeMemory,
} from './assess-engine.js';
import {
  listSessions as storeListSessions,
  createSession as storeCreateSession,
  getSessionById,
  updateSessionProfile,
  updateSessionMemory,
  upsertDomainRun,
  getDomainRun,
  seedEmptyAnswers,
  upsertAnswer,
  addQuestionToSelection,
  deleteSession as storeDeleteSession,
  publicSession,
  domainCounts,
} from './assess-store.js';
import { DEMO_SESSION_ID, isDemoSessionId, loadDemoSession } from './assess-demo.js';

export { DEMO_SESSION_ID };

function notFound() {
  throw new Error('Session not found');
}

function requireSession(id) {
  const session = getSessionById(id);
  if (!session) notFound();
  return session;
}

function requireWritable(id) {
  if (isDemoSessionId(id)) throw new Error('The example assessment cannot be changed.');
  return requireSession(id);
}

async function loadAnySession(id) {
  if (isDemoSessionId(id)) return loadDemoSession();
  return requireSession(id);
}

function requireDomain(raw) {
  const domain = normalizeDomain(raw);
  if (!domain) throw new Error('Unknown domain');
  return domain;
}

function aiUnavailable() {
  return Promise.reject(new Error(
    isAiApiConfigured()
      ? 'AI is not available yet.'
      : 'AI is not available in this prototype.',
  ));
}

export async function fetchMeta() {
  await ensureData();
  return buildMeta();
}

export async function listSessions() {
  await ensureData();
  return { sessions: storeListSessions() };
}

export async function createSession(body = {}) {
  await ensureData();
  const gradeId = body.grade_id;
  if (!gradeId) throw new Error('grade_id is required');
  const learnerName = String(body.learner_name || body.name || '').trim();
  const profile = computeProfile(gradeId, {
    ddi_centrality: body.ddi_centrality || null,
    influence: body.influence || null,
    demonstration_pathway: body.demonstration_pathway || null,
    learner_name: learnerName,
    role_title: String(body.role_title || '').trim(),
    organisation: String(body.organisation || '').trim(),
    why: String(body.why || '').trim(),
    notes: String(body.notes || '').trim(),
  });
  if (!profile) throw new Error('Unknown grade_id');
  profile.notes = String(body.notes || '').trim();
  if (learnerName) profile.learner_name = learnerName;

  const baseTitle = String(body.title || '').trim()
    || learnerName
    || [profile.role_title, profile.organisation].filter(Boolean).join(': ')
    || [profile.grade_name, profile.role_title].filter(Boolean).join(': ')
    || 'Assessment';

  return publicSession(storeCreateSession(profile, baseTitle));
}

export async function getSession(id) {
  await ensureData();
  if (isDemoSessionId(id)) return publicSession(await loadDemoSession());
  return publicSession(requireSession(id));
}

export async function patchSession(id, body = {}) {
  await ensureData();
  const session = requireWritable(id);
  const gradeId = body.grade_id || session.profile.grade_id;
  const profile = computeProfile(gradeId, {
    ddi_centrality: body.ddi_centrality ?? session.profile.ddi_centrality,
    influence: body.influence ?? session.profile.influence,
    demonstration_pathway: body.demonstration_pathway !== undefined
      ? (body.demonstration_pathway || null)
      : session.profile.demonstration_pathway,
    learner_name: body.learner_name != null
      ? String(body.learner_name).trim()
      : (session.profile.learner_name || session.profile.name || ''),
    role_title: body.role_title != null ? String(body.role_title).trim() : session.profile.role_title,
    organisation: body.organisation != null
      ? String(body.organisation).trim()
      : (session.profile.organisation || ''),
    why: body.why != null ? String(body.why).trim() : session.profile.why,
  });
  if (!profile) throw new Error('Unknown grade_id');
  profile.notes = body.notes != null ? String(body.notes).trim() : (session.profile.notes || '');
  for (const key of ['learner_name', 'name', 'narrative', 'interpretation']) {
    if (body[key] != null) profile[key] = String(body[key]).trim();
    else if (session.profile[key] != null && profile[key] == null) profile[key] = session.profile[key];
  }
  let title = body.title != null ? body.title : null;
  if (title == null && profile.learner_name) {
    const prevName = String(session.profile.learner_name || session.profile.name || '').trim();
    if (!prevName || session.title === prevName || session.title === 'Assessment') {
      title = profile.learner_name;
    }
  }
  updateSessionProfile(session.id, profile, title);
  if (body.memory != null && typeof body.memory === 'object') {
    const prev = session.memory || { notes: [], domains: {} };
    updateSessionMemory(session.id, {
      ...prev,
      ...body.memory,
      notes: Array.isArray(body.memory.notes) ? body.memory.notes : (prev.notes || []),
      domains: {
        ...(prev.domains || {}),
        ...(body.memory.domains && typeof body.memory.domains === 'object'
          ? body.memory.domains
          : {}),
      },
    });
  }
  return publicSession(getSessionById(session.id));
}

export async function deleteSession(id) {
  await ensureData();
  requireWritable(id);
  storeDeleteSession(id);
  return { ok: true };
}

export async function fetchGates(sessionId, domainName) {
  await ensureData();
  const session = await loadAnySession(sessionId);
  const domain = requireDomain(domainName);
  return gatesForProfile(domain, session.profile);
}

export async function qualifyDomain(sessionId, domainName, gates) {
  await ensureData();
  const session = requireWritable(sessionId);
  const domain = requireDomain(domainName);
  const gateAnswers = gates || {};
  const selection = deterministicSelect({
    domain,
    profile: session.profile,
    gateAnswers,
    memory: session.memory,
  });

  upsertDomainRun(session.id, domain, {
    gates: gateAnswers,
    selection,
    status: 'assessing',
  });
  seedEmptyAnswers(session.id, domain, selection.suggested_order);
  updateSessionMemory(session.id, {
    notes: [...new Set([...(session.memory?.notes || []), ...(selection.memory_notes || [])])].slice(-20),
    domains: {
      ...(session.memory?.domains || {}),
      [domain]: {
        ...(session.memory?.domains?.[domain] || {}),
        selection_notes: selection.memory_notes || [],
      },
    },
  });

  const questions = {};
  for (const qid of selection.suggested_order) {
    const q = getQuestionById(domain, qid);
    if (q) {
      questions[qid] = {
        question_id: q.question_id,
        cluster: q.cluster,
        strand: q.strand,
        section_type: q.section_type,
        question: q.question,
        descriptors: q.descriptors,
        transversal_tags: q.transversal_tags,
      };
    }
  }

  const fresh = getSessionById(session.id);
  return {
    selection: {
      ...selection,
      questions,
      remaining: selection.suggested_order.length,
    },
    domain_counts: domainCounts(fresh, domain),
    session: publicSession(fresh),
  };
}

function buildQuestionItem(session, domain, questionId, inSelection) {
  const q = getQuestionById(domain, questionId);
  const a = session.answers.find((x) => x.domain === domain && x.question_id === questionId);
  return {
    question_id: questionId,
    cluster: q?.cluster,
    strand: q?.strand,
    section_type: q?.section_type,
    question: q?.question,
    descriptors: q ? descriptorsWithStretch(session.profile, q) : [],
    status: a?.status || 'empty',
    level: a?.level ?? null,
    ai_rationale: a?.ai_rationale || null,
    evidence: a?.evidence || [],
    in_selection: inSelection,
  };
}

export async function fetchQuestions(sessionId, domainName, { extended = false } = {}) {
  await ensureData();
  const session = await loadAnySession(sessionId);
  const domain = requireDomain(domainName);
  const run = (session.domains || []).find((d) => d.domain === domain) || null;
  const order = run?.selection?.suggested_order || [];
  const selectedSet = new Set(order);
  const items = order.map((qid) => buildQuestionItem(session, domain, qid, true));
  let catalogue = [];
  if (extended) {
    catalogue = collectDomainQuestions(domain)
      .filter((q) => !selectedSet.has(q.question_id))
      .map((q) => buildQuestionItem(session, domain, q.question_id, false));
  }
  return {
    domain,
    status: run?.status || 'locked',
    questions: items,
    catalogue,
    counts: domainCounts(session, domain),
  };
}

export async function includeDomainQuestion(sessionId, domainName, questionId) {
  await ensureData();
  const session = requireWritable(sessionId);
  const domain = requireDomain(domainName);
  if (!getQuestionById(domain, questionId)) throw new Error('Unknown question');
  const updated = addQuestionToSelection(session.id, domain, questionId);
  if (!updated) throw new Error('Domain not qualified yet');
  return {
    ok: true,
    session: publicSession(updated),
    counts: domainCounts(updated, domain),
  };
}

export async function postAnswer(sessionId, domainName, body = {}) {
  await ensureData();
  const session = requireWritable(sessionId);
  const domain = requireDomain(domainName);
  const questionId = body.question_id;
  const status = body.status;
  if (!questionId || !status) throw new Error('question_id and status are required');
  if (!['reviewed', 'skipped'].includes(status)) throw new Error('status must be reviewed or skipped');
  if (status === 'reviewed' && (body.level == null || body.level < 1 || body.level > 5)) {
    throw new Error('level 1–5 required when reviewed');
  }

  const run = getDomainRun(session.id, domain);
  const allowed = new Set(run?.selection?.suggested_order || []);
  if (run?.selection && !allowed.has(questionId)) {
    throw new Error('question_id not in selection');
  }

  const existing = session.answers.find((a) => a.domain === domain && a.question_id === questionId);
  upsertAnswer(session.id, domain, {
    question_id: questionId,
    status,
    level: status === 'skipped' ? null : Number(body.level),
    ai_rationale: existing?.ai_rationale || null,
    evidence: existing?.evidence || [],
  });

  const fresh = getSessionById(session.id);
  const counts = domainCounts(fresh, domain);
  const remaining = (run?.selection?.suggested_order || []).filter((qid) => {
    const a = fresh.answers.find((x) => x.domain === domain && x.question_id === qid);
    return !a || a.status === 'empty' || a.status === 'ai_suggested';
  });

  return {
    ok: true,
    counts,
    remaining: remaining.length,
    complete: remaining.length === 0 && counts.selected > 0,
    session: publicSession(fresh),
  };
}

export async function completeDomain(sessionId, domainName) {
  await ensureData();
  const session = requireWritable(sessionId);
  const domain = requireDomain(domainName);
  const run = getDomainRun(session.id, domain);
  upsertDomainRun(session.id, domain, {
    status: 'complete',
    selection: run?.selection,
    gates: run?.gates,
  });
  const fresh = getSessionById(session.id);
  updateSessionMemory(session.id, mergeMemory(fresh, domain, run?.selection));
  return buildDomainReport(getSessionById(session.id), domain);
}

export async function fetchReport(sessionId, { domain = null, view = null } = {}) {
  await ensureData();
  const session = await loadAnySession(sessionId);
  if (String(view || '') === 'progression') return buildProgressionReport(session);
  if (domain) return buildDomainReport(session, requireDomain(domain));
  return buildFullReport(session);
}

export function prefillDomain() {
  return aiUnavailable();
}

export function selectDomainQuestions() {
  return aiUnavailable();
}

export function chatSession() {
  return aiUnavailable();
}

export async function clearChatThread() {
  return { ok: true, deleted: 0 };
}

export async function ensureDemoSession() {
  await ensureData();
  const session = await loadDemoSession();
  return { session_id: session.id || DEMO_SESSION_ID, persona_id: 'jordan-chen', created: false };
}
