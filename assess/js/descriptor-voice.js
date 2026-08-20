/** Canonical rubric voice stored in framework data (third person). */
export const DESCRIPTOR_VOICE_CANONICAL = 'canonical';

/** Second-person voice for self-assessment surfaces. */
export const DESCRIPTOR_VOICE_SELF = 'self';

const SKIP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'when', 'where', 'how', 'what', 'why', 'who',
  'their', 'your', 'not', 'own', 'even', 'also', 'both', 'than', 'that', 'this',
  'with', 'from', 'into', 'over', 'under', 'for', 'to', 'in', 'on', 'at', 'by',
  'if', 'as', 'so', 'it', 'its', 'can', 'may', 'must', 'should', 'would', 'could',
  'generative', 'other', 'systems', 'tools', 'tasks', 'people', 'teams', 'work',
]);

/** Common descriptor verbs, used to avoid noun false-positives (e.g. "tools and platforms"). */
const VERB_FORMS = new Set([
  'accepts', 'acknowledges', 'addresses', 'adapts', 'advises', 'analyses', 'applies', 'approaches',
  'asks', 'assesses', 'avoids', 'begins', 'brings', 'builds', 'challenges', 'champions', 'checks',
  'chooses', 'coaches', 'collects', 'communicates', 'confirms', 'considers', 'constructs', 'contributes',
  'corrects', 'creates', 'cultivates', 'defines', 'delivers', 'designs', 'develops', 'disposes',
  'distinguishes', 'draws', 'drives', 'embeds', 'encourages', 'ensures', 'escalates', 'establishes',
  'evaluates', 'explains', 'finds', 'fixes', 'flags', 'follows', 'frames', 'handles', 'helps',
  'holds', 'identifies', 'implements', 'improves', 'interprets', 'iterates', 'keeps', 'knows',
  'leads', 'looks', 'maintains', 'makes', 'manages', 'maps', 'masters', 'models', 'notices',
  'organises', 'participates', 'plans', 'prepares', 'presents', 'produces', 'promotes', 'provides',
  'raises', 'reads', 'recognises', 'reflects', 'represents', 'responds', 'reviews', 'runs', 'saves', 'seeks',
  'selects', 'sets', 'shapes', 'shares', 'shows', 'solves', 'speaks', 'specifies', 'spots', 'stores',
  'structures', 'supports', 'takes', 'tests', 'tries', 'understands', 'uses', 'verifies', 'weighs', 'works',
  'anticipates', 'breaks', 'connects', 'continues', 'advocates',
]);

function isVerbForm(word) {
  const w = word.toLowerCase();
  return VERB_FORMS.has(w);
}

function looksLikeThirdPersonVerb(word) {
  const w = word.toLowerCase();
  if (SKIP_WORDS.has(w)) return false;
  if (!isVerbForm(w)) return false;
  if (w.length < 3) return false;
  return /(?:ies|es|s)$/i.test(w);
}

/**
 * Convert a third-person singular verb to second person (UK spelling preserved).
 * @param {string} verb
 * @returns {string}
 */
export function conjugateThirdToSecond(verb) {
  const v = verb.toLowerCase();
  const irregular = {
    has: 'have',
    does: 'do',
    is: 'are',
    goes: 'go',
    was: 'were',
  };
  if (irregular[v]) return irregular[v];
  if (v.endsWith('ies')) return `${v.slice(0, -3)}y`;
  if (/(?:xes|ches|shes|sses|zes)$/.test(v)) return v.slice(0, -2);
  if (v.endsWith('es')) return v.slice(0, -1);
  if (v.endsWith('s') && !v.endsWith('ss')) return v.slice(0, -1);
  return v;
}

/**
 * Fix coordinated and clause-internal verbs still in third person.
 * @param {string} text
 * @returns {string}
 */
function fixRemainingThirdPersonVerbs(text) {
  let out = text;
  let prev;

  const conjugateIfVerb = (prefix, verb) => (
    looksLikeThirdPersonVerb(verb)
      ? `${prefix}${conjugateThirdToSecond(verb)}`
      : `${prefix}${verb}`
  );

  do {
    prev = out;
    out = out
      .replace(/,\s+and\s+([A-Za-z]+)/gi, (_, verb) => conjugateIfVerb(', and ', verb))
      .replace(/\sand\s+([A-Za-z]+)/gi, (_, verb) => conjugateIfVerb(' and ', verb))
      .replace(/,\s+([A-Za-z]+)/gi, (_, verb) => conjugateIfVerb(', ', verb))
      .replace(/;\s+([A-Za-z]+)/gi, (_, verb) => conjugateIfVerb('; ', verb))
      .replace(/\bbut\s+([A-Za-z]+)/gi, (_, verb) => conjugateIfVerb('but ', verb));
  } while (out !== prev);

  return out;
}

/**
 * Transform coordinated predicates: "Organises and independently manages" → "organise and independently manage".
 * @param {string} text
 * @returns {string}
 */
function transformCoordinatedVerbs(text) {
  return text.replace(
    /\band (independently |actively |consistently )([A-Za-z]+)\b/gi,
    (_, adv, verb) => `and ${adv}${conjugateThirdToSecond(verb)}`,
  );
}

/**
 * Transform one clause (sentence fragment) from third person to "You …".
 * @param {string} clause
 * @returns {string}
 */
function transformClause(clause) {
  let s = clause.trim();
  if (!s) return s;

  const rules = [
    [/^With (support|guidance), begins to (\w+)(.*)$/i, (_, w, v, r) => `With ${w}, you ${conjugateThirdToSecond(v)}${r}`],
    [/^Begins to (\w+)(.*)$/i, (_, v, r) => `You ${conjugateThirdToSecond(v)}${r}`],
    [/^Beginning to (\w+)(.*)$/i, (_, v, r) => `You are beginning to ${conjugateThirdToSecond(v)}${r}`],
    [/^Continues to (.*)$/i, (_, r) => `You continue to ${r}`],
    [/^Has no established practice here$/i, () => 'You have no established practice here'],
    [/^Has (.*)$/i, (_, r) => `You have ${r}`],
    [/^Does not (\w+)(.*)$/i, (_, v, r) => `You do not ${conjugateThirdToSecond(v)}${r}`],
    [/^Cannot yet (\w+)(.*)$/i, (_, v, r) => `You cannot yet ${conjugateThirdToSecond(v)}${r}`],
    [/^Cannot (\w+)(.*)$/i, (_, v, r) => `You cannot ${conjugateThirdToSecond(v)}${r}`],
    [/^Not yet aware(.*)$/i, (_, r) => `You are not yet aware${r}`],
    [/^May not yet (\w+)(.*)$/i, (_, v, r) => `You may not yet ${conjugateThirdToSecond(v)}${r}`],
    [/^May not be (.*)$/i, (_, r) => `You may not be ${r}`],
    [/^May (\w+)(.*)$/i, (_, v, r) => `You may ${conjugateThirdToSecond(v)}${r}`],
    [/^Little knowledge of(.*)$/i, (_, r) => `You have little knowledge of${r}`],
    [/^Basic or minimal knowledge(.*)$/i, (_, r) => `You have basic or minimal knowledge${r}`],
    [/^Deep understanding of(.*)$/i, (_, r) => `You have deep understanding of${r}`],
    [/^Authoritative knowledge of(.*)$/i, (_, r) => `You have authoritative knowledge of${r}`],
    [/^Familiar with(.*)$/i, (_, r) => `You are familiar with${r}`],
    [/^Aware that(.*)$/i, (_, r) => `You are aware that${r}`],
    [/^Knows that(.*)$/i, (_, r) => `You know that${r}`],
    [/^Understands(.*)$/i, (_, r) => `You understand${r}`],
    [/^Knows(.*)$/i, (_, r) => `You know${r}`],
    [/^Can connect(.*)$/i, (_, r) => `You can connect${r}`],
    [/^Can (\w+)(.*)$/i, (_, v, r) => `You can ${conjugateThirdToSecond(v)}${r}`],
    [/^Needs (.*)$/i, (_, r) => `You need ${r}`],
    [
      /^((?:Actively|Consistently|Deliberately|Systematically|Confidently|Constructively|Habitually|Regularly|Clearly|Proactively|Critically|Routinely)) (\w+)(.*)$/i,
      (_, adv, v, r) => `You ${adv.toLowerCase()} ${conjugateThirdToSecond(v)}${r}`,
    ],
  ];

  for (const [re, fn] of rules) {
    const m = s.match(re);
    if (m) {
      s = fn(...m);
      return fixRemainingThirdPersonVerbs(transformCoordinatedVerbs(s));
    }
  }

  const verbMatch = s.match(/^([A-Za-z]+)(.*)$/);
  if (verbMatch && isVerbForm(verbMatch[1])) {
    s = `You ${conjugateThirdToSecond(verbMatch[1])}${verbMatch[2]}`;
    return fixRemainingThirdPersonVerbs(transformCoordinatedVerbs(s));
  }

  return fixRemainingThirdPersonVerbs(s);
}

/**
 * Transform one sentence, including semicolon-separated clauses.
 * @param {string} sentence
 * @returns {string}
 */
function transformSentence(sentence) {
  const trimmed = sentence.trim();
  if (!trimmed) return trimmed;

  const hasPeriod = trimmed.endsWith('.');
  const core = hasPeriod ? trimmed.slice(0, -1) : trimmed;
  const clauses = core.split(/;\s*/);
  const out = clauses.map((clause) => transformClause(clause)).join('; ');
  return hasPeriod ? `${out}.` : out;
}

/**
 * Convert canonical third-person descriptor text to second-person self-assessment voice.
 * @param {string} text
 * @returns {string}
 */
export function toSelfAssessmentText(text) {
  if (!text || typeof text !== 'string') return text || '';

  const sentences = text.match(/[^.]+(?:\.|$)/g) || [text];
  return sentences
    .map((part) => transformSentence(part))
    .filter(Boolean)
    .join(' ');
}

/**
 * Resolve descriptor display text for the requested voice.
 * Uses `text_self` override when present.
 * @param {{ text?: string, text_self?: string | null }} descriptor
 * @param {'canonical' | 'self'} [voice='canonical']
 * @returns {string}
 */
export function getDescriptorDisplayText(descriptor, voice = DESCRIPTOR_VOICE_CANONICAL) {
  if (!descriptor) return '-';

  if (voice === DESCRIPTOR_VOICE_SELF) {
    if (descriptor.text_self?.trim()) return descriptor.text_self.trim();
    return toSelfAssessmentText(descriptor.text || '');
  }

  return descriptor.text || '-';
}
