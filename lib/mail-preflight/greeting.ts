/**
 * SALUTATION — gérée à UN seul endroit.
 *
 * Constaté le 28/09 (BRIOL) : « Bonjour, Bonjour Monsieur Briol, ». Le mode
 * « sans contact nominatif » imposait « Bonjour, » alors que le corps saluait
 * déjà. Règle : si le corps commence par une salutation, on ne préfixe rien ;
 * deux salutations en tête sont une erreur, corrigeable en un clic.
 */

/** Mots qui ouvrent une salutation (insensible à la casse). */
const OPENER = /^(bonjour|bonsoir|madame|monsieur|mesdames|messieurs|cher|ch[èe]re|hello|salut)\b/i;
/** Salutation « nue » : « Bonjour, », sans nom. */
const BARE = /^(bonjour|bonsoir|hello|salut)\s*[,!.]?\s*$/i;
/** « Bonjour, » suivi d'un second « Bonjour » sur la même ligne (« Bonjour Monsieur X » est UNE salutation). */
const INLINE_DUP = /^(bonjour|bonsoir|hello|salut)\s*[,!.]?\s+(?=(bonjour|bonsoir|hello|salut)\b)/i;

export const isGreetingLine = (line: string) => OPENER.test(line.trim());

/** Indices des premières lignes non vides. */
function headLines(lines: string[], count: number): number[] {
  const indices: number[] = [];
  for (let index = 0; index < lines.length && indices.length < count; index += 1) {
    if (lines[index].trim()) indices.push(index);
  }
  return indices;
}

/** Salutations dans les 3 premières lignes, doublons d'une même ligne compris. */
export function greetingCount(body: string): number {
  const lines = body.split(/\r?\n/);
  let count = 0;
  for (const index of headLines(lines, 3)) {
    let line = lines[index].trim();
    if (!isGreetingLine(line)) continue;
    count += 1;
    while (INLINE_DUP.test(line)) {
      line = line.replace(INLINE_DUP, "");
      count += 1;
    }
  }
  return count;
}

export const hasGreeting = (body: string) => greetingCount(body) > 0;

/**
 * Ne garde qu'une salutation : la plus précise (celle qui nomme). « Bonjour,
 * Bonjour Monsieur Briol, » → « Bonjour Monsieur Briol, ».
 */
export function dedupeGreeting(body: string): string {
  const lines = body.split(/\r?\n/);
  const head = headLines(lines, 3);
  if (!head.length) return body;

  const first = head[0];
  while (INLINE_DUP.test(lines[first].trim())) lines[first] = lines[first].trim().replace(INLINE_DUP, "");

  const greetings = head.filter((index) => isGreetingLine(lines[index]));
  if (greetings.length < 2) return lines.join("\n");
  // On retire les salutations nues ; s'il n'y en a pas, on garde la première.
  const bare = greetings.filter((index) => BARE.test(lines[index].trim()));
  const drop = new Set(bare.length === greetings.length ? greetings.slice(1) : bare.length ? bare : greetings.slice(1));
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (drop.has(index)) {
      // La ligne vide qui suivait la salutation retirée part avec elle.
      if (!lines[index + 1]?.trim()) index += 1;
      continue;
    }
    kept.push(lines[index]);
  }
  return kept.join("\n");
}

/** Pose la salutation voulue SAUF si le corps salue déjà. */
export function applyGreeting(body: string, greeting: string): string {
  const clean = dedupeGreeting(body.replace(/^\s+/, ""));
  return hasGreeting(clean) ? clean : `${greeting}\n\n${clean}`;
}
