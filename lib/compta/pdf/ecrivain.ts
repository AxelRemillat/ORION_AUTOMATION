// Écrivain PDF minimal, sans dépendance : pages A4, polices standard Helvetica / Helvetica-Bold (aucune police à
// embarquer), encodage WinAnsi (accents français, €, « », œ), texte, rectangles et filets. Flux non compressés : le
// texte reste lisible dans le fichier, ce qui permet aux tests de vérifier les mentions obligatoires.

export type Couleur = [number, number, number]; // 0..1
type OptionsTexte = { taille?: number; gras?: boolean; couleur?: Couleur; aligne?: "gauche" | "droite" | "centre" };

export const A4 = { largeur: 595.28, hauteur: 841.89 };

// Chasses Helvetica (AFM, millièmes d'em) pour l'ASCII imprimable ; lettres accentuées = lettre de base.
const CHASSES =
  "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584"
    .split(",")
    .map(Number);

const SPECIAUX: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‹": 0x8b, "Œ": 0x8c, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "›": 0x9b, "œ": 0x9c, "Ÿ": 0x9f };

/** Caractère → octet WinAnsi (espaces fines et insécables → espace insécable ; inconnu → « ? »). */
function octet(c: string): number {
  if (c === " " || c === " ") return 0xa0;
  if (SPECIAUX[c] !== undefined) return SPECIAUX[c];
  const code = c.charCodeAt(0);
  return code >= 32 && code <= 255 && !(code >= 127 && code < 160) ? code : 63;
}

const base = (c: string) => c.normalize("NFD").charAt(0);
/** Largeur d'un texte en points. */
export function largeurTexte(texte: string, taille: number, gras = false): number {
  let total = 0;
  for (const c of texte) {
    const b = base(c).charCodeAt(0);
    total += b >= 32 && b <= 126 ? CHASSES[b - 32] : c === "€" ? 556 : 556;
  }
  return (total * taille * (gras ? 1.06 : 1)) / 1000;
}

/** Coupe un texte en lignes d'au plus `largeur` points. */
export function couper(texte: string, largeur: number, taille: number, gras = false): string[] {
  const lignes: string[] = [];
  for (const paragraphe of texte.split("\n")) {
    let ligne = "";
    for (const mot of paragraphe.split(" ")) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (ligne && largeurTexte(essai, taille, gras) > largeur) {
        lignes.push(ligne);
        ligne = mot;
      } else ligne = essai;
    }
    lignes.push(ligne);
  }
  return lignes;
}

const chaine = (texte: string) => {
  let s = "";
  for (const c of texte) {
    const o = octet(c);
    s += o === 0x28 || o === 0x29 || o === 0x5c ? `\\${String.fromCharCode(o)}` : String.fromCharCode(o);
  }
  return `(${s})`;
};
const n = (x: number) => (Math.round(x * 100) / 100).toString();
const rgb = (c: Couleur) => c.map(n).join(" ");

export class DocumentPdf {
  private pages: string[][] = [];
  constructor(private readonly titre: string) {
    this.nouvellePage();
  }
  nouvellePage(): void {
    this.pages.push([]);
  }
  get numeroPage(): number {
    return this.pages.length;
  }
  private get ops() {
    return this.pages[this.pages.length - 1];
  }
  /** Texte dont la ligne de base est à `y` (origine en HAUT de page, comme à l'écran). */
  texte(x: number, y: number, texte: string, o: OptionsTexte = {}): void {
    const taille = o.taille ?? 10;
    const l = largeurTexte(texte, taille, o.gras);
    const gx = o.aligne === "droite" ? x - l : o.aligne === "centre" ? x - l / 2 : x;
    this.ops.push(`BT /${o.gras ? "F2" : "F1"} ${n(taille)} Tf ${rgb(o.couleur ?? [0.08, 0.07, 0.06])} rg ${n(gx)} ${n(A4.hauteur - y)} Td ${chaine(texte)} Tj ET`);
  }
  rectangle(x: number, y: number, l: number, h: number, couleur: Couleur): void {
    this.ops.push(`${rgb(couleur)} rg ${n(x)} ${n(A4.hauteur - y - h)} ${n(l)} ${n(h)} re f`);
  }
  filet(x1: number, y: number, x2: number, couleur: Couleur, epaisseur = 0.6): void {
    this.ops.push(`${rgb(couleur)} RG ${n(epaisseur)} w ${n(x1)} ${n(A4.hauteur - y)} m ${n(x2)} ${n(A4.hauteur - y)} l S`);
  }
  /** Le fichier PDF complet, en octets. */
  octets(): Uint8Array {
    const objets: string[] = [];
    const ajouter = (o: string) => objets.push(o) && objets.length;
    ajouter("<< /Type /Catalog /Pages 2 0 R >>");
    ajouter("PAGES");
    const f1 = ajouter("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = ajouter("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const ops of this.pages) {
      const contenu = ops.join("\n");
      const c = ajouter(`<< /Length ${latin1(contenu).length} >>\nstream\n${contenu}\nendstream`);
      kids.push(ajouter(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largeur} ${A4.hauteur}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objets[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const info = ajouter(`<< /Title ${chaine(this.titre)} /Producer (ORION compta) >>`);
    let sortie = "%PDF-1.4\n%âãÏÓ\n";
    const positions: number[] = [];
    objets.forEach((o, i) => {
      positions.push(latin1(sortie).length);
      sortie += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = latin1(sortie).length;
    sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
    sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return latin1(sortie);
  }
}

/** Les chaînes du PDF sont déjà en octets WinAnsi (un caractère = un octet) : on les écrit telles quelles. */
function latin1(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}
