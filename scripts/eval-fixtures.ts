/**
 * Fixtures figées de l'évaluation : un rapport doit être comparable d'une
 * exécution à l'autre. Si les données bougent, on ne sait plus si c'est le
 * prompt qui a progressé ou le prospect qui a changé.
 *
 * Le texte du site est porté par `key_figures.site_offer` : c'est ce que
 * l'extraction structurée stocke, et ce que le stratège lit.
 */
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { Prospect } from "@/types";

const base = (over: Partial<Prospect>): Prospect => ({
  id: "x", user_id: "u", company_name: "", siren: null, website: null, email: null, sector: null,
  size_range: null, city: null, source: "auto", signals: [], key_figures: {}, pain_point: null,
  status: "nouveau", created_at: "", updated_at: "", ...over,
});

export interface Fixture {
  prospect: Prospect;
  contact: DecisionMakerContact | null;
  site?: string;
}

const RAW_FIXTURES: Fixture[] = [
  {
    prospect: base({
      id: "ras-0001",
      company_name: "RAS INTERIM JERECRUTE",
      siren: "775614308",
      website: "https://www.ras-interim.fr",
      sector: "Activités des sièges sociaux",
      size_range: "20 à 49 salariés",
      city: "Lyon",
      key_figures: { naf_code: "70.10Z", revenue_eur: 40_878_286, revenue_year: 2024, founded_year: 1969 },
    }),
    contact: null,
    site: `R.A.S Interim, agence d'interim 24h/24 et 7j/7, 190 agences en France, environ 80 000 interimaires par an depuis 1969. Placement et missions d'interim, visite de l'entreprise avant le contrat de mission, assistance administrative, entretiens de suivi. Outils : application my R.A.S (depot de CV, propositions de missions) et plateforme my Temp pour la gestion administrative. Siege a Lyon.`,
  },
  {
    prospect: base({
      id: "blue-0002",
      company_name: "BLUE ENERFREEZE",
      siren: "844104851",
      website: "https://www.blue-enerfreeze.com",
      sector: "Production et distribution de vapeur et d'air conditionné",
      size_range: "20 à 49 salariés",
      city: "Lyon",
      key_figures: {
        naf_code: "35.30Z",
        revenue_eur: 50_290_772,
        revenue_year: 2024,
        founded_year: 2018,
        parent_company: "STEF",
      },
      // Les deux faits qui doivent primer sur les finances : un recrutement
      // d'automaticien recent (rang 1) et l'appartenance au groupe (rang 2).
      signals: [
        {
          type: "recrutement",
          label: "Recrutement en cours",
          quote: "Blue EnerFreeze recrute un automaticien H/F en CDI pour ses installations frigorifiques",
          url: "https://www.blue-enerfreeze.com/carrieres",
          date: new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10),
          confidence: 0.9,
        },
      ],
    }),
    contact: {
      email: "b.dumont@blue-enerfreeze.com",
      full_name: "Benjamin Dumont",
      position: "Managing Director",
      confidence: 99,
    },
    site: `Blue EnerFreeze, producteur d'energie renouvelable et fournisseur d'energie frigorifique securisee, specialiste de la chaine du froid. Conseil en energie, production photovoltaique, securisation energetique (supervision et maintenance des installations frigorifiques), optimisation energetique. 268 points de livraison servis chaque jour, 344 GWh de consommation annuelle geree. Specialiste des operateurs de la supply chain sous temperature dirigee.`,
  },
  {
    prospect: base({
      id: "trans-0003",
      company_name: "TRANSPORTS MERCIER",
      siren: "402118745",
      website: "https://www.transports-mercier.fr",
      sector: "Transports routiers de fret interurbains",
      size_range: "50 à 99 salariés",
      city: "Saint-Étienne",
      key_figures: { naf_code: "49.41A", revenue_eur: 12_400_000, revenue_year: 2024, founded_year: 1995 },
    }),
    contact: null,
    site: `Transports Mercier, transporteur regional de lots et demi-lots, 60 vehicules, messagerie et affretement. Livraisons J+1 sur Auvergne-Rhone-Alpes. Suivi des expeditions, gestion des lettres de voiture et des litiges.`,
  },
  {
    prospect: base({
      id: "cab-0004",
      company_name: "CABINET LAURENT & ASSOCIES",
      siren: "512443901",
      website: "https://www.laurent-associes.fr",
      sector: "Activités comptables",
      size_range: "10 à 19 salariés",
      city: "Villeurbanne",
      key_figures: { naf_code: "69.20Z", revenue_eur: 1_850_000, revenue_year: 2024, founded_year: 2004 },
    }),
    contact: null,
    site: `Cabinet d'expertise comptable, 14 collaborateurs, environ 320 dossiers clients TPE et PME. Tenue, revision, bilans, paie, conseil. Portail client pour le depot des pieces comptables.`,
  },
  {
    // Organisme de formation, 5 salaries. Cas de production : la salutation
    // partait en « Monsieur Victor Grynbaum » et le pain reformulait leur
    // offre (« vos processus de formation »).
    prospect: base({
      id: "andra-0007",
      company_name: "ANDRA LEARNING",
      siren: "985149434",
      website: "https://www.andra-learning.fr",
      sector: "Formation continue d'adultes",
      size_range: "1 à 9 salariés",
      city: "Paris",
      key_figures: { naf_code: "85.59A", headcount: 5, founded_year: 2024 },
    }),
    contact: {
      email: "s.grynbaum@andra-learning.fr",
      full_name: "Sacha Grynbaum",
      position: "Directeur général",
      confidence: 92,
    },
    site: `Andra Learning, organisme de formation professionnelle certifie Qualiopi. Formations sur mesure en presentiel et a distance, catalogue de parcours pour les entreprises. Inscription des stagiaires, conventions de formation, emargements, attestations de fin de parcours et questionnaires d'evaluation a chaque session. Reseau de formateurs independants intervenant sur toute la France.`,
  },
  {
    // Societe de distribution : 1,296 Md€ de CA pour 50 a 99 salaries. Le
    // ratio trahit une filiale, et le malus doit s'appliquer.
    prospect: base({
      id: "egretail-0008",
      company_name: "EG RETAIL (FRANCE) SAS",
      siren: "439793811",
      website: "https://www.egretail.fr",
      sector: "Commerce de détail de carburants en magasin spécialisé",
      size_range: "50 à 99 salariés",
      city: "Nanterre",
      key_figures: {
        naf_code: "47.30Z",
        revenue_eur: 1_296_004_123,
        revenue_year: 2025,
        headcount: 75,
        founded_year: 2001,
      },
    }),
    contact: null,
    site: `EG Retail France exploite un reseau de stations-service et de boutiques de proximite. Approvisionnement carburant, gestion des stocks boutique, releves de cuves, plannings des equipes de station, remontee des ventes et reporting quotidien par site.`,
  },
  {
    // Distributeur d'aciers inoxydables. Les montants viennent des comptes
    // publies ; le texte de site est resume a la main a partir de leurs pages
    // publiques, comme pour les autres fixtures.
    prospect: base({
      id: "jacquet-0005",
      company_name: "JACQUET METAL SERVICE",
      siren: "306159762",
      website: "https://www.jacquetmetalservice.com",
      sector: "Commerce de gros de minerais et métaux",
      size_range: "100 à 199 salariés",
      city: "Saint-Priest",
      key_figures: {
        naf_code: "46.72Z",
        revenue_eur: 214_600_000,
        revenue_year: 2024,
        founded_year: 1962,
        parent_company: "JACQUET METALS",
      },
      signals: [
        {
          type: "recrutement",
          label: "Recrutement en cours",
          quote:
            "Jacquet Metal Service recrute un technicien méthodes / ordonnancement pour son site de Saint-Priest (CDI)",
          url: "https://www.jacquetmetalservice.com/carrieres",
          date: new Date(Date.now() - 18 * 86_400_000).toISOString().slice(0, 10),
          confidence: 0.85,
        },
      ],
    }),
    contact: null,
    site: `Jacquet Metal Service, distributeur de toles et produits en acier inoxydable et aluminium. Stock permanent, decoupe a la demande (sciage, oxycoupage, jet d'eau), livraison sous 24 a 48 heures depuis un reseau d'agences. Devis a la piece, bulletins de matiere et certificats 3.1 fournis avec chaque commande. Filiale du groupe Jacquet Metals.`,
  },
  {
    // Cas d'homonymie réel : l'éval a écrit « Jacquet Metal Service » dans un
    // mail pour JACQUET PARIS (SIREN distinct). Le signal ci-dessous nomme
    // l'autre entité : il doit être écarté, et son nom interdit dans le mail.
    // SIREN fictif.
    prospect: base({
      id: "jacquet-paris-0006",
      company_name: "JACQUET PARIS",
      siren: "123456789",
      sector: "Commerce de détail d'habillement en magasin spécialisé",
      size_range: "10 à 19 salariés",
      city: "Paris",
      key_figures: { naf_code: "47.71Z", revenue_eur: 2_300_000, revenue_year: 2024, founded_year: 1987 },
      signals: [
        {
          type: "recrutement",
          label: "Recrutement en cours",
          quote: "Jacquet Metal Service recrute un technicien méthodes / ordonnancement (CDI)",
          url: "https://www.jacquetmetalservice.com/carrieres",
          date: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10),
          confidence: 0.8,
        },
      ],
    }),
    contact: null,
  },
];


/** Le texte de site devient le résumé structuré, comme après enrichissement. */
export const FIXTURES: Fixture[] = RAW_FIXTURES.map((fixture) => ({
  ...fixture,
  prospect: fixture.site
    ? {
        ...fixture.prospect,
        key_figures: { ...fixture.prospect.key_figures, site_offer: fixture.site, site_status: "lu" },
      }
    : fixture.prospect,
}));

/** Mails écrits à la main comme cible de qualité. Jamais dans un prompt. */
export const REFERENCE_SECTION: string[] = [
  "## Référence de niveau attendu",
  "",
  "Ces deux mails ont été écrits à la main comme cible de qualité. Ils ne sont",
  "PAS dans le prompt : ils servent uniquement de point de comparaison ici.",
  "",
  "**RAS — Objet : contrats de mission et relevés d'heures**",
  "",
  "```",
  "Bonjour,",
  "",
  "41 M€ de chiffre d'affaires piloté par un siège de moins de 50 personnes : dans l'intérim, ça veut dire beaucoup de contrats de mission et de relevés d'heures qui passent par très peu de mains.",
  "",
  "Je suis Axel Remillat, j'automatise ce type de flux avec de l'IA : lecture des relevés, pré-remplissage des contrats, relances automatiques côté intérimaires et côté clients.",
  "",
  "C'est un sujet chez vous en ce moment, ou c'est déjà bien outillé ?",
  "",
  "Axel",
  "```",
  "",
  "**Blue EnerFreeze — Objet : alertes, interventions et pièces**",
  "",
  "```",
  "Bonjour Benjamin,",
  "",
  "Si je lis bien votre site, Blue EnerFreeze vend de l'énergie frigorifique plutôt que des machines. Du coup, une intervention qui traîne coûte chez vous, pas chez le client.",
  "",
  "Je construis des automatisations IA, et un cas typique chez un exploitant comme vous, c'est de relier les alertes de supervision à la commande de pièces, pour que le bon composant soit déjà en route quand le technicien part.",
  "",
  "Aujourd'hui, ça se fait encore à la main chez vous ?",
  "",
  "Bonne journée,",
  "Axel",
  "```",
  "",
];
