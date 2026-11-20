// Synthèses du tableau de bord Compta (pures, testées) : CA encaissé du mois / trimestre / année, prochaine échéance
// URSSAF et son estimation, jauges du plafond micro et de la franchise de TVA.
import { bornesTrimestre, jauge, totalEntre, trimestreDe, type Jauge } from "./calculs";
import { COMPTA_CONFIG } from "./config";
import type { Declaration, Encaissement, Parametres } from "./types";
import { estimer, finAcre, periodes, plafondProratise, type Estimation, type Periode } from "./urssaf";

export type LigneUrssaf = Periode & { estimation: Estimation; declaration: Declaration | null; enRetard: boolean };

/** Toutes les périodes depuis le début d'activité jusqu'au trimestre en cours, avec estimation et état déclaré. */
export function lignesUrssaf(enc: Encaissement[], decl: Declaration[], p: Parametres | null, jour: string): LigneUrssaf[] {
  if (!p?.date_debut_activite) return [];
  const acre = { active: p.acre, fin: p.acre ? finAcre(p.date_debut_activite) : null };
  return periodes(p.date_debut_activite, jour).map((per) => {
    const declaration = decl.find((d) => d.annee === per.trimestre.annee && d.trimestre === per.trimestre.trimestre) ?? null;
    return { ...per, estimation: estimer(enc, per, acre), declaration, enRetard: !declaration && jour > per.limite };
  });
}

export function synthese(enc: Encaissement[], decl: Declaration[], p: Parametres | null, jour: string) {
  const annee = Number(jour.slice(0, 4));
  const mois = jour.slice(0, 7);
  const [debT, finT] = bornesTrimestre(trimestreDe(jour));
  const caAnnee = totalEntre(enc, `${annee}-01-01`, `${annee}-12-31`);
  const urssaf = lignesUrssaf(enc, decl, p, jour);
  const prochaine = urssaf.find((l) => !l.declaration) ?? null;
  const plafond = plafondProratise(COMPTA_CONFIG.plafondMicro, p?.date_debut_activite ?? null, annee);
  const jauges: { micro: Jauge; tva: Jauge; tvaMajore: Jauge } = {
    micro: jauge(caAnnee, plafond, COMPTA_CONFIG.alerte),
    tva: jauge(caAnnee, COMPTA_CONFIG.seuilTva, COMPTA_CONFIG.alerte),
    tvaMajore: jauge(caAnnee, COMPTA_CONFIG.seuilTvaMajore, COMPTA_CONFIG.alerte),
  };
  return {
    caMois: totalEntre(enc, `${mois}-01`, `${mois}-31`),
    caTrimestre: totalEntre(enc, debT, finT),
    caAnnee,
    prochaine,
    urssaf,
    plafond,
    jauges,
  };
}
