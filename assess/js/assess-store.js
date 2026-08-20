const STORAGE_KEY = 'ddi-ai-assess-v1';
const LEGACY_STORAGE_KEY = 'ddai-assess-v1';

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function emptyDb() {
  return { version: 1, sessions: {} };
}

function loadDb() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.sessions !== 'object') {
      return emptyDb();
    }
    return { version: 1, sessions: parsed.sessions };
  } catch {
    return emptyDb();
  }
}

function saveDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sessions: db.sessions }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isDemoTitle(title) {
  return String(title || '').startsWith('Demo:');
}

export function domainCounts(session, domain) {
  const run = (session.domains || []).find((d) => d.domain === domain);
  const selected = run?.selection?.suggested_order?.length
    || run?.selection?.include?.length
    || 0;
  const answers = (session.answers || []).filter((a) => a.domain === domain);
  return {
    domain,
    status: run?.status || 'locked',
    selected,
    ai_suggested: answers.filter((a) => a.status === 'ai_suggested').length,
    reviewed: answers.filter((a) => a.status === 'reviewed' || a.status === 'skipped').length,
  };
}

export function publicSession(session) {
  if (!session) return null;
  const counts = {};
  for (const d of session.domains || []) {
    counts[d.domain] = domainCounts(session, d.domain);
  }
  return { ...clone(session), domain_counts: counts };
}

export function listSessions() {
  const db = loadDb();
  const rows = Object.values(db.sessions)
    .filter((s) => !isDemoTitle(s.title))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    profile_summary: {
      grade_name: row.profile?.grade_name,
      role_title: row.profile?.role_title,
      learner_name: row.profile?.learner_name || row.profile?.name || null,
    },
    domains: (row.domains || []).map((d) => ({ domain: d.domain, status: d.status })),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export function uniqueSessionTitle(baseTitle) {
  const base = String(baseTitle || 'Assessment').trim() || 'Assessment';
  const existing = new Set(Object.values(loadDb().sessions).map((s) => s.title));
  if (!existing.has(base)) return base;

  const stamp = new Date().toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  let candidate = `${base} (${stamp})`;
  if (!existing.has(candidate)) return candidate;

  const withSeconds = new Date().toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  candidate = `${base} (${withSeconds})`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${base} (${withSeconds} · ${n})`;
    n += 1;
  }
  return candidate;
}

export function createSession(profile, title = 'Assessment', { id = null } = {}) {
  const db = loadDb();
  const sessionId = id || newId();
  const ts = nowIso();
  db.sessions[sessionId] = {
    id: sessionId,
    title: uniqueSessionTitle(title),
    status: 'active',
    profile: clone(profile),
    memory: { notes: [], domains: {} },
    created_at: ts,
    updated_at: ts,
    domains: [],
    answers: [],
    messages: [],
  };
  saveDb(db);
  return getSessionById(sessionId);
}

export function getSessionById(id) {
  const row = loadDb().sessions[id];
  return row ? clone(row) : null;
}

function writeSession(session) {
  const db = loadDb();
  session.updated_at = nowIso();
  db.sessions[session.id] = session;
  saveDb(db);
}

export function updateSessionProfile(sessionId, profile, title = null) {
  const session = getSessionById(sessionId);
  if (!session) return null;
  session.profile = clone(profile);
  if (title != null) session.title = String(title).trim() || 'Assessment';
  writeSession(session);
  return getSessionById(sessionId);
}

export function updateSessionMemory(sessionId, memory) {
  const session = getSessionById(sessionId);
  if (!session) return null;
  session.memory = clone(memory);
  writeSession(session);
  return session;
}

export function upsertDomainRun(sessionId, domain, patch = {}) {
  const session = getSessionById(sessionId);
  if (!session) return null;
  const ts = nowIso();
  const existing = session.domains.find((d) => d.domain === domain);
  if (!existing) {
    session.domains.push({
      id: newId(),
      domain,
      status: patch.status || 'qualifying',
      gates: patch.gates !== undefined ? clone(patch.gates) : null,
      selection: patch.selection !== undefined ? clone(patch.selection) : null,
      completed_at: patch.status === 'complete' ? ts : null,
      created_at: ts,
      updated_at: ts,
    });
  } else {
    if (patch.gates !== undefined) existing.gates = clone(patch.gates);
    if (patch.selection !== undefined) existing.selection = clone(patch.selection);
    if (patch.status) existing.status = patch.status;
    if (patch.status === 'complete') existing.completed_at = ts;
    existing.updated_at = ts;
  }
  writeSession(session);
  return getSessionById(sessionId);
}

export function getDomainRun(sessionId, domain) {
  const session = getSessionById(sessionId);
  return session?.domains.find((d) => d.domain === domain) || null;
}

export function seedEmptyAnswers(sessionId, domain, questionIds) {
  const session = getSessionById(sessionId);
  if (!session) return;
  const ts = nowIso();
  for (const qid of questionIds) {
    if (session.answers.some((a) => a.domain === domain && a.question_id === qid)) continue;
    session.answers.push({
      question_id: qid,
      domain,
      status: 'empty',
      level: null,
      ai_rationale: null,
      evidence: [],
      reviewed_at: null,
      ai_updated_at: null,
      updated_at: ts,
    });
  }
  writeSession(session);
}

export function addQuestionToSelection(sessionId, domain, questionId) {
  const session = getSessionById(sessionId);
  if (!session) return null;
  const run = session.domains.find((d) => d.domain === domain);
  if (!run?.selection) return null;

  const order = [...(run.selection.suggested_order || [])];
  if (order.includes(questionId)) return session;

  order.push(questionId);
  const include = [...(run.selection.include || [])];
  if (!include.some((x) => x.question_id === questionId)) {
    include.push({
      question_id: questionId,
      reason: 'Added by you from the full question list',
      priority: 9,
    });
  }
  upsertDomainRun(sessionId, domain, {
    selection: { ...run.selection, suggested_order: order, include },
    status: 'assessing',
  });
  seedEmptyAnswers(sessionId, domain, [questionId]);
  return getSessionById(sessionId);
}

export function upsertAnswer(sessionId, domain, answer) {
  const session = getSessionById(sessionId);
  if (!session) return;
  const ts = nowIso();
  const status = answer.status || 'empty';
  const reviewedAt = status === 'reviewed' || status === 'skipped' ? ts : null;
  const existing = session.answers.find((a) => a.domain === domain && a.question_id === answer.question_id);
  if (existing) {
    existing.status = status;
    existing.level = answer.level ?? null;
    existing.ai_rationale = answer.ai_rationale ?? existing.ai_rationale;
    existing.evidence = answer.evidence ? clone(answer.evidence) : (existing.evidence || []);
    if (reviewedAt) existing.reviewed_at = reviewedAt;
    existing.updated_at = ts;
  } else {
    session.answers.push({
      question_id: answer.question_id,
      domain,
      status,
      level: answer.level ?? null,
      ai_rationale: answer.ai_rationale ?? null,
      evidence: answer.evidence ? clone(answer.evidence) : [],
      reviewed_at: reviewedAt,
      ai_updated_at: null,
      updated_at: ts,
    });
  }
  writeSession(session);
}

export function deleteSession(sessionId) {
  const db = loadDb();
  delete db.sessions[sessionId];
  saveDb(db);
}

export function findSessionByTitle(title) {
  return Object.values(loadDb().sessions).find((s) => s.title === title) || null;
}

export function putSession(session) {
  const db = loadDb();
  session.updated_at = session.updated_at || nowIso();
  db.sessions[session.id] = clone(session);
  saveDb(db);
  return getSessionById(session.id);
}
