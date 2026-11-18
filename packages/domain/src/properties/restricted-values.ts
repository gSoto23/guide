/**
 * Restricted-value detector (feature 002 FR-012, FR-013, FR-031, research R4).
 *
 * It runs on pasted listing text, text recognized from screenshots, imported PMS text, AI output,
 * and listing content the host edits, BEFORE any of it is stored or sent to the AI. It removes
 * likely door, gate, lockbox, and alarm codes and Wi-Fi passwords, and puts a marker such as
 * `[door code removed]` in their place.
 *
 * Recall matters far more than precision: a false positive removes a harmless token and the host
 * is told what was removed, while a missed code is a security failure. The rules, in short:
 *
 * - Keyword families in Spanish and English: código, clave, contraseña, PIN, puerta, portón, caja
 *   de seguridad, alarma, Wi-Fi, red, door, gate, lockbox, keypad, alarm, password, passcode,
 *   network, and close variants. Matching ignores case and accents.
 * - A value is a nearby token of 4 to 12 characters with at least one digit, on the same line as
 *   a keyword (up to {@link WINDOW} words after it), or on the next line when the keyword line
 *   ends with a colon or a keyword. Spaced digits ("4 8 2 1") count as one value. Longer tokens
 *   are removed after password keywords (Wi-Fi passwords), and a letters-only token is removed
 *   right after "password:", "contraseña:", or "password is".
 * - A value may also come first when the keywords name it ("4821 is the door code") or when an
 *   entry verb introduces it ("Use 4821 to open the door", "Marque 4455 en el teclado").
 * - Values listed after a removed value ("4821 o 4822") are removed too.
 * - Wi-Fi network names are kept: after a Wi-Fi keyword with no password keyword, the first word
 *   is the network name; a value right after the name is the password.
 * - Look-alikes are left alone: prices, measures, times, postal and area codes, map pins, and
 *   phone numbers placed before a keyword.
 *
 * The detector is pure and deterministic, and running it on its own output changes nothing.
 */
export const RESTRICTED_VALUE_KINDS = [
  "door_code",
  "gate_code",
  "lockbox_code",
  "alarm_code",
  "wifi_password",
  "other",
] as const;
export type RestrictedValueKind = (typeof RESTRICTED_VALUE_KINDS)[number];

/** One removed value (R4). */
export interface RestrictedMatch {
  kind: RestrictedValueKind;
  /** The value exactly as written. Restricted (FR-031): store it encrypted and never log it. */
  value: string;
  /** Offset of its first character in the ORIGINAL text. */
  start: number;
  /** Offset just after its last character in the ORIGINAL text. */
  end: number;
}

export interface RedactionResult {
  /** The text with each removed value replaced by its marker. */
  text: string;
  /** Removed values per kind; kinds with none are absent (US2 scenario 2). */
  counts: Partial<Record<RestrictedValueKind, number>>;
  /** Removed values in text order, used to store PMS codes encrypted (FR-031). Never log these. */
  matches: RestrictedMatch[];
}

/** Markers that replace removed values. They are English because they reach the model. */
export const REDACTION_MARKERS: Record<RestrictedValueKind, string> = Object.freeze({
  door_code: "[door code removed]",
  gate_code: "[gate code removed]",
  lockbox_code: "[lockbox code removed]",
  alarm_code: "[alarm code removed]",
  wifi_password: "[Wi-Fi password removed]",
  other: "[code removed]",
});

/** Removes likely restricted values and reports what was removed (FR-012, FR-013, FR-031). */
export function redactRestrictedValues(text: string): RedactionResult {
  const matches = new Detector(text).detect();
  const counts: Partial<Record<RestrictedValueKind, number>> = {};
  let redacted = "";
  let cursor = 0;
  for (const match of matches) {
    redacted += text.slice(cursor, match.start) + REDACTION_MARKERS[match.kind];
    cursor = match.end;
    counts[match.kind] = (counts[match.kind] ?? 0) + 1;
  }
  redacted += text.slice(cursor);
  return { text: redacted, counts, matches };
}

/** A text with its likely restricted values replaced by numbered placeholders. */
export interface MaskResult {
  /** The text with `{{R1}}`, `{{R2}}`, … in place of each value. */
  text: string;
  /** The removed values, in placeholder order. Restricted: never log or send these. */
  values: string[];
  counts: Partial<Record<RestrictedValueKind, number>>;
}

const PLACEHOLDER = /\{\{R(\d{1,4})\}\}/gu;

/**
 * Reversible masking for translation (feature 003 research R5, FR-025): each likely value becomes
 * a placeholder the model keeps, and {@link unmaskRestrictedValues} puts the values back unchanged
 * in the translated text, so a code never reaches the model.
 */
export function maskRestrictedValues(text: string): MaskResult {
  const matches = new Detector(text).detect();
  const values: string[] = [];
  const counts: Partial<Record<RestrictedValueKind, number>> = {};
  let masked = "";
  let cursor = 0;
  for (const match of matches) {
    values.push(match.value);
    masked += `${text.slice(cursor, match.start)}{{R${values.length}}}`;
    cursor = match.end;
    counts[match.kind] = (counts[match.kind] ?? 0) + 1;
  }
  masked += text.slice(cursor);
  return { text: masked, values, counts };
}

/** Puts masked values back; a placeholder with no value is left as it is. */
export function unmaskRestrictedValues(text: string, values: readonly string[]): string {
  return text.replace(
    PLACEHOLDER,
    (placeholder, number: string) => values[Number(number) - 1] ?? placeholder,
  );
}

/** True when {@link redactRestrictedValues} would remove anything (FR-013). */
export function containsRestrictedValue(text: string): boolean {
  return new Detector(text).detect().length > 0;
}

// ---------------------------------------------------------------------------------------------
// Keywords

type Topic = "door" | "gate" | "lockbox" | "alarm" | "wifi";

const TOPIC_KINDS: Record<Topic, RestrictedValueKind> = {
  door: "door_code",
  gate: "gate_code",
  lockbox: "lockbox_code",
  alarm: "alarm_code",
  wifi: "wifi_password",
};

interface KeywordRule {
  /** Matches on folded text: lowercase, without accents. */
  readonly pattern: RegExp;
  /** What the code opens, when the keyword says so. */
  readonly topic: Topic | null;
  /** Names a secret: code, PIN, password. */
  readonly secret: boolean;
  /** Names a password, after which long and letters-only values are accepted. */
  readonly password: boolean;
}

/**
 * Whole words only; a hyphen joins words ("Casa-Wifi") but may glue a value ("PIN-0000"). With
 * `digitsMayFollow`, digits right after the word are a glued value ("code4821", as text
 * recognition sometimes drops the space). Password words never take it, because "Password123" is
 * itself a likely password.
 */
function wordPattern(source: string, digitsMayFollow = false): RegExp {
  const next = digitsMayFollow ? "[\\p{L}_]" : "[\\p{L}\\p{N}_]";
  return new RegExp(`(?<![\\p{L}\\p{N}_]|[\\p{L}\\p{N}]-)(?:${source})(?!${next}|-\\p{L})`, "gu");
}

function keyword(source: string, topic: Topic | null, secret = false, password = false) {
  return {
    pattern: wordPattern(source, !password),
    topic,
    secret,
    password,
  } satisfies KeywordRule;
}

const WIFI = String.raw`wi[\s\-\u2010-\u2015.]?fi`;

const KEYWORD_RULES: readonly KeywordRule[] = [
  keyword(
    String.raw`caj(?:a|ita)s?\s+(?:(?:de|para)\s+)?(?:las\s+)?(?:seguridad|llaves?)|cajas?\s+fuertes?|guarda\s?llaves|(?:lock|key)[\s\-]?box(?:es)?|key[\s\-]?safes?|safes?|candados?|padlocks?|caj(?:a|ita)s?`,
    "lockbox",
  ),
  keyword(String.raw`alarmas?|alarms?|sistemas?\s+de\s+seguridad|security\s+systems?`, "alarm"),
  keyword(
    String.raw`porton(?:es)?|gates?|garages?|garajes?|cocheras?|verjas?|rejas?|talanqueras?`,
    "gate",
  ),
  keyword(
    String.raw`puertas?|doors?|keypads?|teclados?|cerraduras?|smart\s?locks?|locks?|deadbolts?|keyless`,
    "door",
  ),
  keyword(String.raw`(?:${WIFI}|network|wlan|wpa2?)\s+key|wpa2?(?:-psk)?`, "wifi", true, true),
  // On their own, Wi-Fi words introduce a network name, which is kept.
  keyword(String.raw`${WIFI}|wlan|ssid|redes|red|networks?|wireless|internet`, "wifi"),
  keyword(String.raw`contrasenas?|passwords?|passphrases?|pass|pwd?|claves?`, null, true, true),
  keyword(
    String.raw`codigos?|codes?|passcodes?|pins?|pines|combinaci(?:on|ones)|combinations?|combos?`,
    null,
    true,
  ),
];

/** Phrases where a keyword does not introduce a restricted value ("código postal", "map pin"). */
const NEUTRAL_PHRASES = wordPattern(
  [
    String.raw`(?:zip|postal|post|area|country|promo|promotional|discount|coupon|dress|qr|bar|tax|booking|confirmation|reservation)\s+codes?`,
    String.raw`codes?\s+of\s+conduct`,
    String.raw`codigos?\s+(?:postal(?:es)?|promocional(?:es)?|qr|de\s+(?:la\s+)?(?:area|pais|descuento|vestimenta|conducta|barras|reserva(?:cion)?|confirmacion|promocion))`,
    String.raw`(?:google\s+)?(?:maps?|mapa|location|ubicacion)\s+pins?`,
    String.raw`pin(?:es)?\s+(?:de\s+)?(?:la\s+)?(?:ubicacion|mapa|google)`,
    String.raw`redes?\s+sociales?|social\s+(?:networks?|media)`,
    String.raw`(?:boarding|day|bus|ski|season|beach|park)\s+pass(?:es)?`,
  ].join("|"),
);

// ---------------------------------------------------------------------------------------------
// Words and values

/** A set of folded words, written as one space-separated string. */
function words(list: string): ReadonlySet<string> {
  return new Set(list.split(/\s+/u).filter(Boolean));
}

/** Words skipped between a keyword and what it introduces ("the code IS 4821"). */
const FILLERS = words(`
  a al an are called current de del el es esta este for id is its la las llama llamada llamado
  lo los main name names new nombre nombres nueva nuevo nuestra nuestro of our para principal se
  sera son su the this to tu un una your
`);

/** Words that may sit between a password keyword and a letters-only password. */
const COPULAS = words("are equals es is sera son");

/** Words that join listed values ("4821 o 4822"). */
const CONNECTORS = words("ademas also and e luego mas o or plus tambien then u y");

/** Verbs that introduce a value typed on a keypad ("Use 4821 to open the door"). */
const ENTRY_VERBS = words(`
  dial digita digite enter escriba escribe ingresa ingrese input introduce introduzca key marca
  marque press presiona presione punch teclea teclee type usa use usar utilice
`);

/** Particles after an entry verb ("punch in", "key in"). */
const ENTRY_PARTICLES = words("in into");

/**
 * Digit words in Spanish and English, for codes spoken in voice notes or spelled out ("cuatro ocho
 * dos uno", "oh nine oh nine"; feature 003 research R5). "o" is left out: it is also Spanish "or".
 */
const NUMBER_WORDS = words(`
  cero uno una dos tres cuatro cinco seis siete ocho nueve
  zero oh one two three four five six seven eight nine
`);
const SPELLED_GAP = /^[ \t\u00a0]{1,2}$|^,[ \t\u00a0]?$|^[ \t\u00a0]?-[ \t\u00a0]?$/u;

/** Common words after "password:" that are not a password ("Password: provided at check-in"). */
const STOPWORDS = words(`
  abajo above abierta abierto adjunta adjunto arriba available below check consulte contact
  contacte dentro disponible eliminada eliminado emailed enviada enviado enviamos enviaremos
  escrita etiqueta free given gratis gratuita gratuito guia guide guidebook hidden impresa
  incluida incluido included inside label libre llegada located manual mensaje message misma
  mismo modem needed ninguna ninguno none open oculta pegada pegado please posted pregunta
  pregunte printed protected provided removed required router same secure sent shared solicite
  sticker tarjeta texted written
`);

const MIN_VALUE_LENGTH = 4;
const MAX_CODE_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 64;
const MAX_MERGED_DIGITS = 12;
/** Most words between a keyword and its value. */
const WINDOW = 8;
/** Most words between a value and a keyword that follows it. */
const FORWARD_WINDOW = 4;
/** Lines above a value searched for what a bare "password" or "code" refers to. */
const CONTEXT_LINES = 3;

type Shape = "code" | "long" | "alpha";

const VALUE_CHARS = /^[\p{L}\p{N}#*_.!@$%&+~^-]+$/u;
const HAS_DIGIT = /\p{N}/u;
const HAS_LETTER = /\p{L}/u;
const PURE_DIGITS = /^\p{Nd}+$/u;
const CURRENCY_SIGN = /[$€£¥₡₹]/u;
/** A currency code before the amount ("usd25") or after it ("25usd"); each side is anchored. */
const CURRENCY_CODE =
  /(?:^(?:usd|us|crc|eur|mxn|cop|gbp|cad)\d)|(?:\d(?:usd|crc|eur|mxn|cop|gbp|cad)$)/u;
const MEASURE =
  /^\d+(?:[.,]\d+)?(?:ghz|mhz|gbps|mbps|kbps|tb|gb|mb|m2|km|kg|cm|mm|mts|ft|sqft|hrs?|am|pm|mins?|pax|%)$/u;

/** Classifies a token as a possible value; prices, measures, and times are never values. */
function shapeOf(core: string, folded: string, prefix: string, suffix: string): Shape | null {
  if (!VALUE_CHARS.test(core)) {
    return null;
  }
  if (
    CURRENCY_SIGN.test(prefix) ||
    CURRENCY_SIGN.test(suffix) ||
    CURRENCY_CODE.test(folded) ||
    MEASURE.test(folded)
  ) {
    return null;
  }
  const length = [...core].length;
  if (HAS_DIGIT.test(core)) {
    if (length >= MIN_VALUE_LENGTH && length <= MAX_CODE_LENGTH) {
      return "code";
    }
    return length > MAX_CODE_LENGTH && length <= MAX_PASSWORD_LENGTH ? "long" : null;
  }
  return HAS_LETTER.test(core) && length >= MIN_VALUE_LENGTH && length <= MAX_PASSWORD_LENGTH
    ? "alpha"
    : null;
}

const COMBINING_MARKS = /\p{M}/gu;

function foldWord(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().replace(/!+$/u, "");
}

/** Lowercase, accent-free text, with the original offset of every folded character. */
function fold(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let offset = 0;
  for (const char of text) {
    const base = char.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
    for (let k = 0; k < base.length; k += 1) {
      origin.push(offset);
    }
    folded += base;
    offset += char.length;
  }
  origin.push(offset);
  return { folded, origin };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MARKER_PATTERN = new RegExp(
  RESTRICTED_VALUE_KINDS.map((kind) => escapeRegExp(REDACTION_MARKERS[kind])).join("|"),
  "giu",
);
const MARKER_KINDS = new Map<string, RestrictedValueKind>(
  RESTRICTED_VALUE_KINDS.map((kind) => [REDACTION_MARKERS[kind].toLowerCase(), kind]),
);

/** Splits words; colons, equals signs, bars, semicolons, commas, and slashes separate them. */
const PIECE = /[^\s:=|;,/]+/gu;
const LEADING_NOISE = /^[^\p{L}\p{N}#*]+/u;
const TRAILING_NOISE = /[^\p{L}\p{N}#*!]+$/u;
const CLAUSE_BREAK = /[.;!?|\n\u2026]/u;
/** Like {@link CLAUSE_BREAK} without "|", which separates table columns ("Door code | 4821"). */
const SENTENCE_BREAK = /[.;!?\n\u2026]/u;
const SPACES_ONLY = /^[ \t\u00a0]{1,2}$/u;

interface Span {
  start: number;
  end: number;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

type Boundary = RestrictedValueKind | "name";

interface Token extends Span {
  index: number;
  /** The word without surrounding punctuation or emoji. */
  core: string;
  /** `core` lowercased and without accents, for word lists. */
  folded: string;
  line: number;
  /** Text between the previous token and this one. */
  gapBefore: string;
  shape: Shape | null;
  /** Set when the token is a marker left by an earlier redaction. */
  marker: RestrictedValueKind | null;
  /** Part of a keyword. */
  hit: boolean;
  /** Spaced digits joined into one value ("4 8 2 1"). */
  merged: boolean;
  /** Starts with "+" or "(", like a phone number. */
  phoneLike: boolean;
  /** A removed value or a kept network name; groups of keywords never reach past it. */
  boundary: Boundary | null;
}

interface Hit extends Span {
  rule: KeywordRule;
  /** Index of the first token of the keyword. */
  first: number;
  /** Index of the last token of the keyword. */
  last: number;
  line: number;
}

// ---------------------------------------------------------------------------------------------
// Detection

class Detector {
  private readonly text: string;
  private readonly lineStarts: number[];
  private readonly tokens: Token[];
  private readonly hits: Hit[];
  private readonly lineFirst: number[];
  private readonly lineLast: number[];

  constructor(text: string) {
    this.text = text;
    this.lineStarts = [0];
    for (let k = 0; k < text.length; k += 1) {
      if (text[k] === "\n") {
        this.lineStarts.push(k + 1);
      }
    }
    const markers = this.findMarkers();
    const keywordSpans = this.findKeywords(markers);
    this.tokens = mergeSpelledDigits(
      mergeSpacedDigits(
        this.tokenize(
          markers,
          keywordSpans.flatMap((span) => [span.start, span.end]),
        ),
        text,
      ),
      text,
    );
    this.hits = [];
    for (const span of keywordSpans) {
      const covered = this.tokens.filter((token) => overlaps(token, span));
      const first = covered[0];
      const last = covered[covered.length - 1];
      if (first && last) {
        covered.forEach((token) => (token.hit = true));
        this.hits.push({ ...span, first: first.index, last: last.index, line: last.line });
      }
    }
    this.lineFirst = this.lineStarts.map(() => -1);
    this.lineLast = this.lineStarts.map(() => -1);
    for (const token of this.tokens) {
      if (this.lineFirst[token.line] === -1) {
        this.lineFirst[token.line] = token.index;
      }
      this.lineLast[token.line] = token.index;
    }
  }

  detect(): RestrictedMatch[] {
    const matches: RestrictedMatch[] = [];
    let line = -1;
    let lastBoundary = -1;
    for (const token of this.tokens) {
      if (token.line !== line) {
        line = token.line;
        lastBoundary = -1;
      }
      if (token.marker) {
        lastBoundary = token.index;
        continue;
      }
      if (token.shape === null || token.hit) {
        continue;
      }
      const decision = this.decide(token, lastBoundary);
      if (decision === null) {
        continue;
      }
      token.boundary = decision;
      lastBoundary = token.index;
      if (decision !== "name") {
        matches.push({ kind: decision, value: token.core, start: token.start, end: token.end });
      }
    }
    return matches;
  }

  private decide(token: Token, lastBoundary: number): Boundary | null {
    const i = token.index;
    // 1. Keywords before the value on the same line: "Door code: 4821". A keyword reaches past
    // the end of a sentence only when nothing but fillers and keywords follow it ("Door code...
    // 4821"), not in "Self check-in with keypad. Check-in after 1500".
    const group = this.hits.filter(
      (hit) =>
        hit.line === token.line &&
        hit.last < i &&
        hit.last > lastBoundary &&
        i - hit.last - 1 <= WINDOW &&
        (!this.hasSentenceBreak(hit.last + 1, i) ||
          this.tokens.slice(hit.last + 1, i).every((t) => t.hit || FILLERS.has(t.folded))),
    );
    if (group.length > 0) {
      return this.resolve(group, token);
    }
    // 2. A value listed after a removed value or a network name: "4821 o 4822".
    const previousBoundary = this.tokens[lastBoundary]?.boundary;
    if (
      previousBoundary &&
      i - lastBoundary - 1 <= 3 &&
      this.onlyConnectorsBetween(lastBoundary, i)
    ) {
      return continuation(previousBoundary, token);
    }
    // 3. A value at the start of a line, below its keyword: "Door code:\n4821".
    const previous = this.tokens[i - 1];
    if (!previous || previous.line !== token.line) {
      const fromLine = this.previousContentLine(token.line);
      const lastIndex = this.lineLast[fromLine] ?? -1;
      const last = this.tokens[lastIndex];
      if (last) {
        const next = this.tokens[i + 1];
        const alone = !next || next.line !== token.line;
        if (last.boundary && alone) {
          return continuation(last.boundary, token);
        }
        if (last.hit || this.endsWithColon(fromLine)) {
          let lineBoundary = -1;
          for (let k = lastIndex; k >= (this.lineFirst[fromLine] ?? 0); k -= 1) {
            if (this.tokens[k]?.boundary) {
              lineBoundary = k;
              break;
            }
          }
          const above = this.hits.filter(
            (hit) =>
              hit.line === fromLine && hit.last > lineBoundary && lastIndex - hit.last <= WINDOW,
          );
          if (above.length > 0) {
            return this.resolve(above, token);
          }
        }
      }
    }
    // 4. A value before its keywords: "4821 is the door code", "Use 4821 to open the door".
    return this.forward(token);
  }

  /** Decides a value from the keywords that introduce it. */
  private resolve(group: Hit[], token: Token): Boundary | null {
    const i = token.index;
    let topic: Topic | null = null;
    let topicLast = -1;
    for (const hit of group) {
      if (hit.rule.topic) {
        topic = hit.rule.topic;
        topicLast = hit.last;
      }
    }
    const secret = group.some((hit) => hit.rule.secret);
    const password = group.some((hit) => hit.rule.password);
    if (topic === "wifi" && !secret) {
      // "Red: CasaColibri_5G" names a network, which is kept; a value right after it is the
      // password ("Wi-Fi: CasaColibri_5G / Colibri2026").
      const nameIndex = this.firstContentAfter(topicLast);
      if (nameIndex === i) {
        return "name";
      }
      return nameIndex !== -1 &&
        nameIndex < i &&
        token.shape !== "alpha" &&
        this.onlyConnectorsBetween(nameIndex, i)
        ? "wifi_password"
        : null;
    }
    const firstHit = group[0];
    const lastHit = group[group.length - 1];
    if (!firstHit || !lastHit) {
      return null;
    }
    const kind = topic ? TOPIC_KINDS[topic] : this.kindFromContext(firstHit.first, token);
    switch (token.shape) {
      case "code":
        return kind;
      case "long":
        return kind === "wifi_password" || password ? kind : null;
      case "alpha":
        return password && this.isExplicitValue(lastHit.last, token) && !STOPWORDS.has(token.folded)
          ? kind
          : null;
      default:
        return null;
    }
  }

  /** A value before the keywords that name it. */
  private forward(token: Token): Boundary | null {
    const i = token.index;
    if (token.shape !== "code" || token.merged || token.phoneLike) {
      return null;
    }
    // Phone numbers and other digit groups are not codes.
    const previous = this.tokens[i - 1];
    const next = this.tokens[i + 1];
    if (previous && previous.line === token.line && holdsNumber(previous)) {
      return null;
    }
    if (next && next.line === token.line && holdsNumber(next)) {
      return null;
    }
    const start = this.hits.findIndex((hit) => hit.first > i);
    const first = this.hits[start];
    if (
      !first ||
      first.line !== token.line ||
      first.first - i - 1 > FORWARD_WINDOW ||
      this.hasClauseBreak(i + 1, first.first)
    ) {
      return null;
    }
    const chain = [first];
    let chainEnd = first;
    for (const hit of this.hits.slice(start + 1)) {
      if (
        hit.line !== token.line ||
        hit.first - chainEnd.last - 1 > 2 ||
        this.hasClauseBreak(chainEnd.last + 1, hit.first) ||
        !this.tokens.slice(chainEnd.last + 1, hit.first).every((t) => FILLERS.has(t.folded))
      ) {
        break;
      }
      chain.push(hit);
      chainEnd = hit;
    }
    const namesSecret = chain.some((hit) => hit.rule.secret);
    // "Use 4821", and with a particle, "Punch in 4821" (feature 003 research R5).
    const beforePrevious = this.tokens[i - 2];
    const entered =
      previous !== undefined &&
      previous.line === token.line &&
      (ENTRY_VERBS.has(previous.folded) ||
        (ENTRY_PARTICLES.has(previous.folded) &&
          beforePrevious !== undefined &&
          beforePrevious.line === token.line &&
          ENTRY_VERBS.has(beforePrevious.folded)));
    const opensSomething = chain.some(
      (hit) => hit.rule.topic !== null && hit.rule.topic !== "wifi",
    );
    if (!namesSecret && !(entered && opensSomething)) {
      return null;
    }
    // "1500, door code 4821": the keywords introduce the value after them, not this one.
    for (const after of this.tokens.slice(chainEnd.last + 1)) {
      if (after.line !== token.line || CLAUSE_BREAK.test(after.gapBefore)) {
        break;
      }
      if (FILLERS.has(after.folded)) {
        continue;
      }
      if (after.marker || after.shape === "code" || after.shape === "long") {
        return null;
      }
      break;
    }
    const topicHit = chain.find((hit) => hit.rule.topic !== null);
    return topicHit?.rule.topic
      ? TOPIC_KINDS[topicHit.rule.topic]
      : this.kindFromContext(first.first, token);
  }

  /**
   * What a bare "code" or "password" refers to: the nearest topic keyword before it in the same
   * block (same line or up to {@link CONTEXT_LINES} lines above, no blank line between), else one
   * right after the value ("PIN 0000 for the smart lock"), else "other".
   */
  private kindFromContext(before: number, token: Token): RestrictedValueKind {
    let minLine = token.line;
    for (let line = token.line - 1; line >= 0 && line >= token.line - CONTEXT_LINES; line -= 1) {
      if (this.lineFirst[line] === -1) {
        break;
      }
      minLine = line;
    }
    for (let k = this.hits.length - 1; k >= 0; k -= 1) {
      const hit = this.hits[k];
      if (!hit || hit.last >= before) {
        continue;
      }
      if (hit.line < minLine) {
        break;
      }
      if (hit.rule.topic) {
        return TOPIC_KINDS[hit.rule.topic];
      }
    }
    for (const hit of this.hits) {
      if (hit.first <= token.index) {
        continue;
      }
      if (hit.line !== token.line || hit.first - token.index - 1 > FORWARD_WINDOW) {
        break;
      }
      if (hit.rule.topic) {
        return TOPIC_KINDS[hit.rule.topic];
      }
    }
    return "other";
  }

  /** The first word after a keyword that is neither a filler nor another keyword, or -1. */
  private firstContentAfter(index: number): number {
    for (let k = index + 1; k < this.tokens.length && k <= index + WINDOW; k += 1) {
      const token = this.tokens[k];
      if (token && !token.hit && !FILLERS.has(token.folded)) {
        return k;
      }
    }
    return -1;
  }

  /** "Password: sunshine", "password is sunshine": the value is clearly given. */
  private isExplicitValue(keywordLast: number, token: Token): boolean {
    const between = this.tokens.slice(keywordLast + 1, token.index);
    if (!between.every((t) => COPULAS.has(t.folded))) {
      return false;
    }
    return between.length > 0 || /[:=]/u.test(token.gapBefore);
  }

  private onlyConnectorsBetween(from: number, to: number): boolean {
    return this.tokens.slice(from + 1, to).every((t) => CONNECTORS.has(t.folded));
  }

  /** Whether a clause ends in the gaps before tokens `from` to `to`. */
  private hasClauseBreak(from: number, to: number): boolean {
    return this.tokens.slice(from, to + 1).some((t) => CLAUSE_BREAK.test(t.gapBefore));
  }

  /** Whether a sentence ends in the gaps before tokens `from` to `to`. */
  private hasSentenceBreak(from: number, to: number): boolean {
    return this.tokens.slice(from, to + 1).some((t) => SENTENCE_BREAK.test(t.gapBefore));
  }

  /** The line above with words, skipping at most one blank line; -1 when there is none. */
  private previousContentLine(line: number): number {
    for (let above = line - 1; above >= 0 && above >= line - 2; above -= 1) {
      if (this.lineFirst[above] !== -1) {
        return above;
      }
    }
    return -1;
  }

  private endsWithColon(line: number): boolean {
    const start = this.lineStarts[line];
    if (start === undefined) {
      return false;
    }
    const end = this.lineStarts[line + 1] ?? this.text.length + 1;
    return this.text
      .slice(start, end - 1)
      .replace(/[^\p{L}\p{N}:]+$/u, "")
      .endsWith(":");
  }

  private lineOf(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((this.lineStarts[middle] ?? 0) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }

  private findMarkers(): Array<Span & { kind: RestrictedValueKind }> {
    const markers: Array<Span & { kind: RestrictedValueKind }> = [];
    for (const match of this.text.matchAll(MARKER_PATTERN)) {
      const kind = MARKER_KINDS.get(match[0].toLowerCase());
      if (kind) {
        markers.push({ start: match.index, end: match.index + match[0].length, kind });
      }
    }
    return markers;
  }

  /** Keyword spans in the original text, longest first where they overlap. */
  private findKeywords(markers: Span[]): Array<Span & { rule: KeywordRule }> {
    const { folded, origin } = fold(this.text);
    const toOriginal = (index: number): number => origin[index] ?? this.text.length;
    const blocked: Span[] = [...markers];
    for (const match of folded.matchAll(NEUTRAL_PHRASES)) {
      blocked.push({
        start: toOriginal(match.index),
        end: toOriginal(match.index + match[0].length),
      });
    }
    const found: Array<Span & { rule: KeywordRule }> = [];
    for (const rule of KEYWORD_RULES) {
      for (const match of folded.matchAll(rule.pattern)) {
        const span = {
          start: toOriginal(match.index),
          end: toOriginal(match.index + match[0].length),
          rule,
        };
        if (!blocked.some((other) => overlaps(other, span))) {
          found.push(span);
        }
      }
    }
    found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
    const kept: Array<Span & { rule: KeywordRule }> = [];
    for (const span of found) {
      if (!kept.some((other) => overlaps(other, span))) {
        kept.push(span);
      }
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  private tokenize(markers: Array<Span & { kind: RestrictedValueKind }>, cuts: number[]): Token[] {
    const text = this.text;
    const tokens: Token[] = [];
    let previousEnd = 0;
    const addPiece = (rawStart: number, rawEnd: number): void => {
      const raw = text.slice(rawStart, rawEnd);
      const rest = raw.replace(LEADING_NOISE, "");
      const coreLength = rest.replace(TRAILING_NOISE, "").length;
      const start = rawStart + raw.length - rest.length;
      const end = start + coreLength;
      const core = text.slice(start, end);
      if (coreLength === 0 || !/[\p{L}\p{N}]/u.test(core)) {
        return;
      }
      const prefix = text.slice(rawStart, start);
      const folded = foldWord(core);
      tokens.push({
        index: tokens.length,
        start,
        end,
        core,
        folded,
        line: this.lineOf(start),
        gapBefore: text.slice(previousEnd, start),
        shape: shapeOf(core, folded, prefix, text.slice(end, rawEnd)),
        marker: null,
        hit: false,
        merged: false,
        phoneLike: /[+(]/u.test(prefix),
        boundary: null,
      });
      previousEnd = end;
    };
    let cursor = 0;
    for (const marker of [...markers, null]) {
      const segmentEnd = marker ? marker.start : text.length;
      for (const match of text.slice(cursor, segmentEnd).matchAll(PIECE)) {
        let start = cursor + match.index;
        const end = start + match[0].length;
        // A keyword glued to a value is its own word: "PIN-0000", "code4821", "4821.Gate".
        for (const cut of cuts) {
          if (cut > start && cut < end) {
            addPiece(start, cut);
            start = cut;
          }
        }
        addPiece(start, end);
      }
      if (marker) {
        tokens.push({
          index: tokens.length,
          start: marker.start,
          end: marker.end,
          core: text.slice(marker.start, marker.end),
          folded: "",
          line: this.lineOf(marker.start),
          gapBefore: text.slice(previousEnd, marker.start),
          shape: null,
          marker: marker.kind,
          hit: false,
          merged: false,
          phoneLike: false,
          boundary: marker.kind,
        });
        previousEnd = marker.end;
        cursor = marker.end;
      }
    }
    return tokens;
  }
}

function holdsNumber(token: Token): boolean {
  return token.marker !== null || HAS_DIGIT.test(token.core);
}

/** A value listed after a removed value takes its kind; a value after a network name is its password. */
function continuation(previous: Boundary, token: Token): RestrictedValueKind | null {
  if (token.shape === "alpha") {
    return null;
  }
  const kind = previous === "name" ? "wifi_password" : previous;
  return token.shape === "long" && kind !== "wifi_password" ? null : kind;
}

/** Joins short digit groups split by spaces ("4 8 2 1", "48 21") into one value. */
function mergeSpacedDigits(tokens: Token[], text: string): Token[] {
  const merged: Token[] = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (!token) {
      continue;
    }
    let digits = token.core.length;
    let last = k;
    if (!token.marker && PURE_DIGITS.test(token.core) && digits < MIN_VALUE_LENGTH) {
      for (let next = tokens[last + 1]; next; next = tokens[last + 1]) {
        if (
          next.marker ||
          !PURE_DIGITS.test(next.core) ||
          next.core.length > MIN_VALUE_LENGTH ||
          !SPACES_ONLY.test(next.gapBefore) ||
          digits + next.core.length > MAX_MERGED_DIGITS
        ) {
          break;
        }
        digits += next.core.length;
        last += 1;
      }
    }
    const end = tokens[last]?.end ?? token.end;
    if (last > k && digits >= MIN_VALUE_LENGTH) {
      const core = text.slice(token.start, end);
      merged.push({ ...token, end, core, folded: core, shape: "code", merged: true });
      k = last;
    } else {
      merged.push(token);
    }
  }
  return merged.map((token, index) => ({ ...token, index }));
}

/**
 * Joins four to twelve digit words in a row ("cuatro ocho dos uno", "oh nine oh nine") into one
 * value, as speech to text writes spoken codes (feature 003 research R5). Fewer than four never
 * merge, so "cuatro habitaciones" and "two parking spots" stay words.
 */
function mergeSpelledDigits(tokens: Token[], text: string): Token[] {
  const merged: Token[] = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (!token) {
      continue;
    }
    let last = k;
    if (!token.marker && !token.hit && NUMBER_WORDS.has(token.folded)) {
      for (let next = tokens[last + 1]; next; next = tokens[last + 1]) {
        if (
          next.marker ||
          next.hit ||
          !NUMBER_WORDS.has(next.folded) ||
          !SPELLED_GAP.test(next.gapBefore) ||
          last + 1 - k >= MAX_CODE_LENGTH
        ) {
          break;
        }
        last += 1;
      }
    }
    const end = tokens[last]?.end ?? token.end;
    if (last - k + 1 >= MIN_VALUE_LENGTH) {
      const core = text.slice(token.start, end);
      merged.push({ ...token, end, core, folded: core, shape: "code", merged: true });
      k = last;
    } else {
      merged.push(token);
    }
  }
  return merged.map((token, index) => ({ ...token, index }));
}
