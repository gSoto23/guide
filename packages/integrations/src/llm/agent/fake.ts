import type {
  AnswerGuestInput,
  GuestAnswer,
  GuestClassification,
  GuestClassificationInput,
} from "./schemas.js";

/**
 * Deterministic stand-ins for the assistant's calls (feature 005, LLM_MODE=fake): keyword rules for
 * the classification and word overlap with the knowledge's sections for the answer. Good enough
 * for end-to-end tests and local work; the eval suite measures the real model.
 */
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const RULES: [GuestClassification["escalation"], RegExp][] = [
  [
    "emergency",
    /\b(fire|smoke|gas smell|smell of gas|ambulance|hospital|bleeding|injured|unconscious|flood(ing)?|fuego|incendio|humo|olor a gas|ambulancia|herido|sangr|inundaci|emergenc|locked out)\b/,
  ],
  [
    "legal",
    /\b(lawyer|lawsuit|sue|discriminat|harass|police|abogado|demanda|denuncia|discrimin|acoso|policia)\b/,
  ],
  [
    "money",
    /\b(refund|reimburs|compensat|deposit|charge[ds]?|pay(ment)?|money back|reembolso|devoluci|compensaci|deposito|cobr|pago|pagar|dinero)\b/,
  ],
  [
    "reservation_change",
    /\b(change (my|the|our) dates|extend|extra night|cancel|late checkout|early check-?in|add (a )?guest|cambiar (las |mis )?fechas|extender|cancelar|salida tard|entrada temprano|noche extra)\b/,
  ],
  [
    "malfunction",
    /\b(broken|leak(ing)?|not working|doesn'?t work|stopped working|no power|no hot water|roto|rota|fuga|gotea|no funciona|dejo de funcionar|sin luz|sin agua)\b/,
  ],
  [
    "complaint",
    /\b(dirty|disgusting|terrible|awful|unacceptable|complain|noisy|sucio|sucia|asqueroso|terrible|inaceptable|queja|ruido)\b/,
  ],
  ["sensitive_request", /\b(code|codigo|password|contrasena|clave|pin|combination|combinacion)\b/],
];
const TOPICS: [string, RegExp][] = [
  ["wifi", /\b(wifi|wi-fi|internet|network|red)\b/],
  ["checkout", /\b(checkout|check-out|check out|salida|leave|irnos|dejar la casa)\b/],
  [
    "arrival",
    /\b(check-?in|arrive|arrival|get in|llegada|llegar|entrar|lockbox|caja|door|puerta|gate|porton)\b/,
  ],
  ["parking", /\b(park(ing)?|parqueo|estacionar|car|carro)\b/],
  [
    "appliances",
    /\b(coffee|cafetera|washer|lavadora|oven|horno|tv|air conditioning|aire acondicionado|ac)\b/,
  ],
  [
    "house_rules",
    /\b(rules?|normas|reglas|pets?|mascotas|smok(e|ing)|fumar|party|fiesta|quiet|silencio)\b/,
  ],
  [
    "local_recommendations",
    /\b(restaurant|eat|food|beach|supermarket|restaurante|comer|playa|super)\b/,
  ],
];
const GREETING =
  /^\s*(hi|hello|hey|hola|buenas|buenos dias|buenas tardes|buenas noches|thanks|thank you|gracias|ok|okay)[\s!.,]*$/;
const INJECTION =
  /(ignore (all |your |previous )|disregard (your|the) (rules|instructions)|system prompt|you are now|i am the (host|owner|developer)|ignora (las |tus )?instrucciones|soy (el|la) (anfitrion|duen))/;
const SPANISH =
  /\b(el|la|los|las|de|que|como|donde|cual|hay|para|por|una|un|es|esta|gracias|hola|puedo|tengo|casa)\b/g;
const PORTUGUESE = /\b(voce|obrigad|onde|qual|tem|uma|nao|esta|casa|para)\b/g;

function language(text: string): string {
  const folded = fold(text);
  const es = folded.match(SPANISH)?.length ?? 0;
  const pt = folded.match(PORTUGUESE)?.length ?? 0;
  if (pt > es && pt >= 2) return "pt";
  return es >= 1 ? "es" : "en";
}

export function fakeClassify(input: GuestClassificationInput): GuestClassification {
  const text = fold(input.message);
  const escalation = RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "none";
  const topic = GREETING.test(text)
    ? "greeting"
    : ((TOPICS.find(([, pattern]) => pattern.test(text))?.[0] ??
        "other") as GuestClassification["topic"]);
  return {
    language: language(input.message),
    topic,
    escalation,
    sentiment: escalation === "complaint" ? "negative" : "neutral",
    injection: INJECTION.test(text),
  };
}

const STOP = new Set(
  "the a an is are do does how what where when can i my we to of in on for and or it you your there this that el la los las de del que como donde cuando hay es esta un una por para con mi mis y o se lo".split(
    " ",
  ),
);

function words(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

export function fakeAnswer(input: AnswerGuestInput): GuestAnswer {
  const blocks = input.knowledge
    .split(/\n(?=\[section )/)
    .filter((block) => block.startsWith("[section "));
  const asked = words(input.message);
  let best: { id: string; score: number; body: string } | null = null;
  for (const block of blocks) {
    const [header = "", ...body] = block.split("\n");
    const id = /^\[section ([^\]]+)\]/.exec(header)?.[1] ?? "";
    const text = body.join(" ");
    const known = words(`${header} ${text}`);
    let score = 0;
    for (const word of asked) if (known.has(word)) score += 1;
    if (!best || score > best.score) best = { id, score, body: text };
  }
  if (!best || best.score < 1 || !best.body.trim()) {
    return {
      answer: input.language.startsWith("es")
        ? "No tengo esa información en la guía. Tu anfitrión te responderá aquí."
        : "I don't have that in the guide. Your host will reply here.",
      sectionIds: [],
      answerable: false,
      needsHost: true,
    };
  }
  return {
    answer: best.body.trim().slice(0, 600),
    sectionIds: [best.id],
    answerable: true,
    needsHost: false,
  };
}
