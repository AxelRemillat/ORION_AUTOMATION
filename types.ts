/**
 * PROSPECT — contrat de types partagé.
 *
 * Source de vérité côté TypeScript pour les 4 tables Supabase.
 * Tout le monde importe d'ici : `import type { Prospect } from "@/types"`.
 * Toute évolution doit rester alignée sur supabase/migrations/*.sql.
 */

// ---------------------------------------------------------------------------
// Énumérations (les tableaux `as const` servent aussi à générer les UI :
// listes déroulantes, filtres, colonnes de kanban…)
// ---------------------------------------------------------------------------

export const PROSPECT_STATUSES = [
  "nouveau",
  "a_contacter",
  "contacte",
  "relance_1",
  "relance_2",
  "repondu",
  "en_discussion",
  "gagne",
  "perdu",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const PROSPECT_SOURCES = ["auto", "import"] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

export const MESSAGE_TYPES = ["intro", "relance_1", "relance_2", "note", "reponse"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = ["draft", "sent"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Cycle d'envoi d'un message, à côté de `status` (draft | sent). */
/** `blocked` : refusé par le contrôle avant envoi au moment de partir (migration 20260928084920). */
export const SEND_STATUSES = ["draft", "scheduled", "sending", "sent", "failed", "cancelled", "blocked"] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

/** Cache du verdict « objet cohérent avec le corps » (LLM), par empreinte. */
export type MailSubjectCheck = {
  user_id: string;
  hash: string;
  coherent: boolean;
  reason: string;
  created_at: string;
};

export const DEAL_STATUSES = ["ouvert", "gagne", "perdu"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Catégories attribuées par le classifieur n8n à un email entrant. */
export const INBOUND_CATEGORIES = ["reponse", "question", "relance", "refus", "autre"] as const;
export type InboundCategory = (typeof INBOUND_CATEGORIES)[number];

/** Notifications téléphone (ntfy) : un interrupteur par type (lib/notify). */
export type NotificationPrefsRow = {
  user_id: string;
  reply: boolean;
  antispam: boolean;
  send_failed: boolean;
  updated_at: string;
};

/** Anti-doublon des notifications : une ligne par message notifié. */
export type NotificationLogRow = {
  key: string;
  user_id: string;
  kind: string;
  created_at: string;
};

/** Fournisseurs d'API dont la consommation est mesuree. */
export const API_SERVICES = ["openai", "pappers", "linkup", "hunter"] as const;
export type ApiService = (typeof API_SERVICES)[number];

// ---------------------------------------------------------------------------
// Colonnes JSONB — volontairement souples : le contenu vient d'APIs externes
// (Pappers, Linkup…) et n'est pas contraint par la base.
// ---------------------------------------------------------------------------

/**
 * Signal d'actualité détecté sur l'entreprise (levée, recrutement, presse…).
 *
 * Un signal issu du web n'est émis que si une source le PROUVE : `quote` porte
 * la phrase exacte qui l'atteste et `url` permet de la vérifier. Les signaux
 * déduits des données structurelles (INSEE, NAF) n'ont ni `quote` ni `url` et
 * ne doivent jamais être présentés comme une actualité.
 */
export interface ProspectSignal {
  type?: string;
  label: string;
  url?: string;
  /**
   * Force commerciale de la preuve.
   *
   * « faible » quand la preuve tient mais que sa source est un agrégateur, ou
   * qu'elle n'est pas datée, ou que le fait n'engage personne (un changement de
   * dénomination). Un signal faible reste AFFICHÉ, classé plus bas : l'écarter
   * faisait perdre 45 % des résultats du scan.
   *
   * « fort » est réservé à un fait engageant et daté — nouveau dirigeant,
   * mouvement de capital, reprise de fonds, offre d'emploi publiée.
   */
  strength?: "fort" | "moyen" | "faible";
  /** Date ISO du signal, telle que fournie par la source. */
  date?: string;
  source?: string;
  /** Phrase exacte de la source qui atteste le signal. */
  quote?: string;
  /** Confiance dans la preuve, de 0 à 1. Absente = non prouvé. */
  confidence?: number;
  /**
   * Nature du poste pour un signal de recrutement : automation, data, it, ops,
   * sales, other. Renseignée par l'extraction structurée uniquement.
   */
  category?: string;
  /** D'où vient `date` : "source", "texte" ou "url". Absente = non daté. */
  dateBasis?: string;
  /** `true` pour un signal issu de l'extraction structurée (citation vérifiée). */
  structured?: boolean;
  /**
   * « groupe » quand le signal nomme une entité voisine liée au prospect par
   * un lien capitalistique prouvé : il décrit le groupe, pas le prospect.
   */
  scope?: "groupe";
  /** Entité réellement nommée par un signal de groupe. */
  entity?: string;
  /**
   * Contact nominatif retenu par la derniere generation.
   *
   * Note sur la fiche pour qu'elle en garde la trace : l'ecran l'affichait
   * depuis la reponse de generation, et il disparaissait au rechargement.
   */
  contact_email?: string;
  contact_name?: string;
  contact_position?: string;
  contact_confidence?: number;
  [key: string]: unknown;
}

/** Chiffres clés issus des données légales / financières. */
export interface ProspectKeyFigures {
  /**
   * SEGMENT (agent3) — marché dont la fiche relève, qualifié par lib/segments.
   * Absent = aucun segment reconnu. Se recalcule à chaque ré-enrichissement.
   */
  segment?: string;
  /** Ce qui a qualifié : signaux lus sur le site officiel. */
  segment_signals?: string[];
  /**
   * L'entreprise vend déjà la prestation : concurrent, donc partenaire
   * possible. Porte le motif. Aucun mail n'est préparé (cf. off-target).
   */
  segment_competitor?: string;
  revenue_eur?: number;
  headcount?: number;
  founded_year?: number;
  legal_form?: string;
  naf_code?: string;
  /**
   * Groupe détecté, et par quelle voie. Deux indices indépendants coexistent :
   * `parent_company` vient du registre (dirigeant personne morale),
   * `parent_group` de l'extraction web. On garde les deux : ils se confirment
   * ou se contredisent, et l'écran affiche ce qu'il en est.
   */
  parent_company?: string;
  parent_group?: string;
  parent_group_quote?: string;
  parent_group_url?: string;
  /** Vrai quand un indice sérieux rattache l'entreprise à un grand groupe. */
  is_large_group_subsidiary?: boolean;
  /**
   * Dirigeant personne morale SANS SIREN : une société étrangère la contrôle
   * (HÖRMANN FRANCE, filiale d'Hörmann KG). Hors cible : la décision est ailleurs.
   */
  parent_foreign?: boolean;
  /** Téléphone lu sur le site (module contact) : sans email, la fiche est « à appeler ». */
  phone?: string;
  /** Adresse gardée hors du domaine du site, sur la seule foi de Hunter « valid ». */
  email_doubtful?: boolean;
  /** Pappers a répondu lors de l'enrichissement (opposition, groupe, effectif lus). */
  pappers_read?: boolean;
  /**
   * Registre lu à l'enrichissement : Pappers, ou le repli gratuit (finances de
   * l'API Recherche d'entreprises, opposition de l'API RNE de l'INPI).
   */
  registry_source?: "pappers" | "gratuit";
  /**
   * Opposition à la prospection vérifiée par une source. `false` EXPLICITE :
   * aucune source n'a pu répondre — badge « opposition non vérifiée » et
   * programmation bloquée. Absent (fiches antérieures) : rien ne change.
   */
  opposition_checked?: boolean;
  /** Qui a vérifié l'opposition : Pappers, l'INPI, ou l'utilisateur. */
  opposition_source?: "pappers" | "inpi" | "manuel";
  /** Ce qui a déclenché le drapeau ci-dessus, en clair. */
  group_evidence?: string[];
  /** Dirigeant personne physique retrouvé derrière une holding. */
  leader_via?: string;
  /** Ce que le site officiel dit du métier (extraction structurée). */
  site_offer?: string;
  site_customers?: string;
  site_vocabulary?: string[];
  /** État de la couverture du site : trouvé, lu, ou explicitement absent. */
  site_status?: "lu" | "trouvé" | "non trouvé";
  /** Entités homonymes écartées : leur nom ne doit jamais sortir dans un mail. */
  foreign_entities?: string[];
  /**
   * FAITS DU SIGNAL qui a fait remonter la fiche.
   *
   * Stockés à plat et en clair, parce qu'ils sont relus bien plus tard —
   * la fiche vit des semaines après la recherche qui l'a trouvée, et le signal
   * d'origine n'est alors plus recalculable : une annonce BODACC sort de la
   * fenêtre de 60 jours, une offre d'emploi est dépubliée.
   */
  signal_source?: "bodacc" | "france-travail";
  signal_type?: string;
  signal_strength?: "fort" | "moyen" | "faible";
  /** Date ISO du signal principal. */
  signal_date?: string;
  /** Formulation lisible du fait, telle qu'affichée sur la carte. */
  signal_label?: string;
  /** Nombre d'annonces retenues pour cette entreprise sur la fenêtre. */
  signal_count?: number;
  /** Dirigeant entrant nommé par l'annonce : prénom puis nom. */
  new_leader_name?: string;
  /** Fonction prise (« gérant », « président », « directeur général »). */
  new_leader_role?: string;
  /** Offre d'emploi : intitulé publié et date de publication. */
  job_title?: string;
  job_posted_at?: string;
  /**
   * Capital déclaré APRÈS l'opération. Le précédent n'est pas publié par
   * BODACC : le sens du mouvement n'est donc pas connu depuis cette valeur
   * seule, et rien ici ne doit laisser croire à une augmentation.
   */
  capital_after_eur?: number;
  /** Capitaux propres du dernier exercice publié (Pappers). */
  equity_eur?: number;
  /**
   * L'entreprise s'oppose à l'usage commercial de ses données (registre Sirene,
   * via Pappers). À ne pas confondre avec `statut_diffusion` de l'annuaire, qui
   * ne dit que la diffusion de la fiche.
   */
  refuses_prospecting?: boolean;
  /** Aucun salarié déclaré (Pappers) — distinct d'un effectif inconnu. */
  no_staff?: boolean;
  /**
   * Date de nomination du dirigeant en poste, telle que Pappers la publie.
   *
   * C'est elle qui distingue un dirigeant ENTRANT d'un dirigeant installé. Une
   * nomination de moins de douze mois est le meilleur moment de prospection
   * qui existe : les outils et les process se remettent à plat pendant les
   * premiers mois, pas trois ans après.
   */
  leader_since?: string;
  /**
   * Ouvertures d'établissements de moins d'un an : ville et date.
   *
   * Vient de la liste complète des établissements Pappers, qui porte une
   * `date_de_creation` par site. Un fait daté, vérifiable, et qui se raconte
   * sans citer aucun registre : « vous avez ouvert une agence à Périgueux ».
   */
  /**
   * `siret` est conservé pour que le RATTACHEMENT soit vérifiable : un
   * établissement appartient au prospect si et seulement si son SIRET commence
   * par son SIREN. Sans lui, le lien était implicite — vrai par construction,
   * mais impossible à contrôler à la relecture d'une fiche.
   */
  recent_openings?: { city: string; date: string; siret?: string | null; sign?: string | null }[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tables
//
// Déclarées en `type` et non en `interface` : postgrest-js exige que chaque
// ligne soit assignable à `Record<string, unknown>`, ce que seules les alias
// de type obtiennent (signature d'index implicite). Avec une interface, le
// client typé retombe silencieusement sur `never`.
// ---------------------------------------------------------------------------

export type Prospect = {
  id: string;
  user_id: string;
  company_name: string;
  siren: string | null;
  website: string | null;
  /** Contact trouvé par l'enrichissement (Pappers/Hunter) ou saisi à la main. */
  email: string | null;
  /**
   * Provenance de l'adresse, posée par lib/contact-finder (migration
   * 20260927210701). Absentes tant que la migration n'est pas appliquée.
   */
  email_type?: "nominatif" | "generique" | null;
  email_source_url?: string | null;
  contact_confidence?: number | null;
  contact_found_by?: string | null;
  contact_search?: Record<string, unknown> | null;
  contact_checked_at?: string | null;
  /**
   * Personne réellement contactée (migration 20261006145446) : « Prénom Nom »,
   * poste, et d'où vient l'adresse (« hunter:domain-search »…). NULL = adresse
   * générique ou d'avant.
   */
  contact_name?: string | null;
  contact_role?: string | null;
  contact_source?: string | null;
  sector: string | null;
  size_range: string | null;
  city: string | null;
  source: ProspectSource;
  /** Toujours un tableau côté app (défaut SQL `'[]'::jsonb`). */
  signals: ProspectSignal[];
  /** Toujours un objet côté app (défaut SQL `'{}'::jsonb`). */
  key_figures: ProspectKeyFigures;
  pain_point: string | null;
  /**
   * Dernier BRIEF du stratège (lib/emails/strategist.ts). Colonne ajoutée par
   * la migration 20260925100000 : absente tant qu'elle n'est pas appliquée.
   */
  brief?: Record<string, unknown> | null;
  /**
   * Mise à la corbeille : le prospect est masqué partout tant que ce champ est
   * renseigné (lib/trash/scope.ts), puis purgé 14 jours plus tard.
   * Colonnes ajoutées par la migration 20260925124235.
   */
  deleted_at?: string | null;
  /** Statut au moment de la mise à la corbeille, rendu à la restauration. */
  status_before_delete?: string | null;
  /** Ne plus jamais écrire à ce prospect : tout envoi est refusé côté serveur. */
  do_not_contact?: boolean;
  /** Statut avant « ne plus contacter », rendu quand on lève le blocage. */
  status_before_dnc?: string | null;
  /**
   * Profil métier lu sur le site (lib/emails/business-profile.ts), migration
   * 20260927210139. Le stratège choisit le pain depuis ce profil.
   */
  business_profile?: Record<string, unknown> | null;
  business_profile_at?: string | null;
  status: ProspectStatus;
  created_at: string;
  updated_at: string;
}

export type Message = {
  id: string;
  prospect_id: string;
  user_id: string;
  type: MessageType;
  subject: string | null;
  body: string;
  status: MessageStatus;
  sent_at: string | null;
  /** Fil Gmail : permet de répondre dans la conversation d'origine. */
  thread_id: string | null;
  created_at: string;
  /**
   * Corbeille et envoi programmé (migration 20260927124154). Optionnels : une
   * base pas encore migrée ne les renvoie pas.
   */
  deleted_at?: string | null;
  scheduled_at?: string | null;
  /** Destinataire confirmé à la programmation. */
  scheduled_to?: string | null;
  send_status?: SendStatus;
  /** Raison lisible du dernier échec d'envoi. */
  send_error?: string | null;
  send_attempts?: number;
  send_started_at?: string | null;
  /** Notification « parti / échoué » déjà vue. */
  send_seen_at?: string | null;
  gmail_message_id?: string | null;
  /**
   * Validé dans « Aujourd'hui », en attente de la programmation groupée.
   * Un brouillon validé n'est jamais envoyé sans cette programmation.
   */
  validated_at?: string | null;
  /** Réponse à un mail reçu (migration 20260927131230) : même fil Gmail. */
  reply_to_inbound_id?: string | null;
  reply_to_gmail_message_id?: string | null;
  /** Destinataire réel d'un mail parti. */
  sent_to?: string | null;
  /**
   * Brouillon écrit hors application (migration 20261002192831) : `eval`
   * (eval:mails) ou `script`. Jamais dans « Aujourd'hui », jamais réécrit par
   * une génération normale. NULL = application.
   */
  origin?: MessageOrigin | null;
  /** Note /10 du juge qualité (migration 20261003151548). NULL = brouillon d'avant. */
  quality_score?: number | null;
  /** Pourquoi le brouillon est « À revoir ». NULL = envoyable. */
  quality_reason?: string | null;
  /** Retouché par Axel : plus jamais régénéré automatiquement. */
  edited_by_hand?: boolean;
  /**
   * Brouillon à régénérer (migration 20261006145446) : le contact a changé
   * après la rédaction (adresse nominative trouvée). NULL = rien à refaire.
   */
  regenerate_reason?: string | null;
  regenerate_requested_at?: string | null;
}

export type MessageOrigin = "eval" | "script";

/** Version remplacée d'un brouillon (régénération) : rien n'est écrasé pour de bon. */
export type MessageVersion = {
  id: string;
  user_id: string;
  message_id: string | null;
  subject: string | null;
  body: string;
  quality_score: number | null;
  reason: string;
  created_at: string;
};

/**
 * Email entrant, déjà trié par n8n comme lié à la prospection.
 *
 * Table séparée de `messages` : `prospect_id` est nullable ici, un expéditeur
 * inconnu devant rester visible plutôt que d'être jeté.
 */
export type InboundMessage = {
  id: string;
  user_id: string;
  prospect_id: string | null;
  from_email: string;
  subject: string | null;
  body: string;
  category: InboundCategory;
  thread_id: string | null;
  received_at: string;
  /** Vrai dès qu'une réponse est partie depuis le Cockpit. */
  handled: boolean;
  created_at: string;
  /** Corbeille (migration 20260927131230) : masqué partout, purgé à J+14. */
  deleted_at?: string | null;
  /** Identifiant Gmail du mail reçu, transmis par n8n. */
  gmail_message_id?: string | null;
}

export type Deal = {
  id: string;
  prospect_id: string;
  user_id: string;
  amount_eur: number | null;
  status: DealStatus;
  signed_at: string | null;
  created_at: string;
}

export type Reminder = {
  id: string;
  prospect_id: string;
  user_id: string;
  due_at: string;
  done: boolean;
  created_at: string;
}

/**
 * Entreprise deja enrichie, mise de cote pour plus tard.
 *
 * `company` est l'instantane complet de l'enrichissement (au format
 * `EnrichedCompany` de lib/enrichment) : le rejouer cree un prospect sans
 * aucun appel externe, donc sans consommer de credit.
 */
export type Favorite = {
  id: string;
  user_id: string;
  company_name: string;
  siren: string | null;
  website: string | null;
  sector: string | null;
  city: string | null;
  company: Record<string, unknown>;
  created_at: string;
}

/**
 * Decision prise sur une action de la file du Cockpit.
 *
 * La file elle-meme n'est jamais stockee : elle se recalcule depuis les tables
 * metier. Seules deux intentions n'y sont portees par rien — « traite
 * autrement » et « pas aujourd'hui » — et c'est tout l'objet de cette table.
 */
export type ActionState = {
  id: string;
  user_id: string;
  /** Identifiant stable de l'action, calcule par _lib/queue.ts. */
  action_id: string;
  state: "done" | "snoozed";
  /** Renseigne uniquement pour `snoozed` : l'action revient apres cette date. */
  snooze_until: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Un appel facture a une API tierce.
 *
 * `units` est toujours dans l'unite NATIVE du fournisseur (tokens, credits,
 * recherches) et est exacte. `cost` est en euros ; pour les services factures
 * en dollars il resulte d'une conversion approximative, que l'ecran signale.
 */
export type ApiUsage = {
  id: string;
  user_id: string;
  service: ApiService;
  /** Ce qui a ete fait : "chat.completions", "entreprise", "search"... */
  operation: string;
  units: number;
  unit_cost: number;
  cost: number;
  prospect_id: string | null;
  /** Qui a consommé : agent1…agent4, prod, cron (USAGE_SOURCE, migration 20261007132518). NULL = d'avant. */
  source?: string | null;
  created_at: string;
}

/**
 * SIREN à ne plus proposer dans la recherche (après une suppression
 * définitive). Clé primaire (user_id, siren).
 */
export type ExcludedCompany = {
  user_id: string;
  siren: string;
  reason: string | null;
  created_at: string;
};

export type ExcludedCompanyInsert = {
  user_id?: string;
  siren: string;
  reason?: string | null;
  created_at?: string;
};

export type ExcludedCompanyUpdate = Partial<ExcludedCompanyInsert>;

/**
 * Cache partagé des appels payants (fiches de registre).
 *
 * Pas de `user_id` : la donnée mise en cache est publique, et la mutualiser
 * évite qu'un utilisateur repaie un crédit déjà dépensé par un autre.
 */
/**
 * Memoire des entreprises deja scannees : evite de rescanner (et de repayer)
 * les memes SIREN d'une recherche a l'autre.
 */
/** Type d'offre d'entree : la demande la plus legere qu'on puisse faire. */
export type EntryOfferType = "demo" | "appel" | "audit" | "pilote";

export const ENTRY_OFFER_LABELS: Record<EntryOfferType, string> = {
  demo: "Démo",
  appel: "Appel découverte",
  audit: "Audit",
  pilote: "Pilote",
};

/**
 * Une preuve publique : ce qu'Axel peut citer dans un mail.
 *
 * `publicOk` a false = la preuve existe mais ne sort jamais. Elle remplace
 * `PERSONA.proofs`, qui vivait en dur dans le code.
 */
export type OfferProof = {
  id: string;
  title: string;
  /** Phrase d'UNE ligne, reprise telle quelle dans le mail. */
  sentence: string;
  tags: string[];
  url?: string | null;
  publicOk: boolean;
};

/** Ce qu'Axel vend, et comment il signe. Une ligne par utilisateur. */
export type UserOffer = {
  user_id: string;
  full_name: string | null;
  title: string | null;
  portfolio_url: string | null;
  phone: string | null;
  show_phone: boolean;
  entry_type: EntryOfferType | null;
  entry_duration: string | null;
  entry_pitch: string | null;
  entry_url: string | null;
  lead_time: string | null;
  no_tool_change: boolean;
  human_validation: boolean;
  proofs: OfferProof[];
  created_at: string;
  updated_at: string;
};

/**
 * `updated_at` reste ecrivable : la route le pose a chaque sauvegarde pour que
 * l'ordre des modifications soit lisible sans trigger.
 */
export type UserOfferInsert = Partial<UserOffer>;
export type UserOfferUpdate = UserOfferInsert;

export type ScanHistory = {
  id: string;
  user_id: string;
  siren: string;
  company_name: string | null;
  had_signal: boolean;
  scanned_at: string;
};

export type ScanHistoryInsert = {
  siren: string;
  company_name?: string | null;
  had_signal?: boolean;
  scanned_at?: string;
  user_id?: string;
};

export type ScanHistoryUpdate = Partial<ScanHistoryInsert>;

export type EnrichmentCache = {
  key: string;
  payload: unknown;
  expires_at: string;
  created_at: string;
};

export type EnrichmentCacheInsert = {
  key: string;
  payload: unknown;
  expires_at: string;
  created_at?: string;
};

export type EnrichmentCacheUpdate = Partial<EnrichmentCacheInsert>;

// ---------------------------------------------------------------------------
// Helpers d'écriture
//
// `user_id` est renseigné automatiquement par un DEFAULT SQL (auth.uid()),
// et les id/dates par la base : on ne les envoie pas depuis le client.
// ---------------------------------------------------------------------------

type Generated = "id" | "user_id" | "created_at" | "updated_at";

/**
 * Payload d'insertion : on retire les colonnes remplies par la base
 * (id, user_id via `default auth.uid()`, dates) et on rend optionnelles
 * celles qui ont un DEFAULT SQL ou qui sont nullables.
 */
export type Insert<T, Optional extends keyof T = never> = Omit<T, Generated | Optional> &
  Partial<Pick<T, Extract<Generated | Optional, keyof T>>>;

export type Update<T> = Partial<Omit<T, Generated>>;

export type ProspectInsert = Insert<
  Prospect,
  | "siren"
  | "website"
  | "email"
  | "sector"
  | "size_range"
  | "city"
  | "source"
  | "signals"
  | "key_figures"
  | "pain_point"
  | "brief"
  | "deleted_at"
  | "status_before_delete"
  | "status"
>;
export type ProspectUpdate = Update<Prospect>;

export type MessageInsert = Insert<Message, "subject" | "status" | "sent_at" | "thread_id">;
export type MessageUpdate = Update<Message>;

export type DealInsert = Insert<Deal, "amount_eur" | "status" | "signed_at">;
export type DealUpdate = Update<Deal>;

export type ReminderInsert = Insert<Reminder, "done">;
export type ReminderUpdate = Update<Reminder>;

export type ActionStateInsert = Insert<ActionState, "snooze_until">;
export type ActionStateUpdate = Update<ActionState>;

export type FavoriteInsert = Insert<Favorite, "siren" | "website" | "sector" | "city">;
export type FavoriteUpdate = Update<Favorite>;

export type InboundMessageInsert = Insert<
  InboundMessage,
  "prospect_id" | "subject" | "category" | "thread_id" | "received_at" | "handled"
> & { user_id: string };
export type InboundMessageUpdate = Update<InboundMessage>;

/** Etat d'un scan suivi en direct. */
export const SEARCH_RUN_STATUSES = ["running", "done", "stopped", "error"] as const;
export type SearchRunStatus = (typeof SEARCH_RUN_STATUSES)[number];

/**
 * Un lancement de recherche, observable pendant qu'il tourne.
 *
 * `results` reste en jsonb : ce sont des entreprises enrichies, pas encore des
 * prospects. Les normaliser obligerait à les détruire au scan suivant.
 */
export type SearchRun = {
  id: string;
  user_id: string;
  criteria: Record<string, unknown>;
  status: SearchRunStatus;
  progress: Record<string, unknown>;
  results: unknown[];
  warnings: unknown[];
  error: string | null;
  /** Passe à vrai quand l'utilisateur clique « Arrêter » ; le scan le relit. */
  stop_requested: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Un signal de l'entonnoir « signaux d'abord » (lib/funnel), avec son statut
 * dans les 4 étages et son motif de rejet.
 */
export type SignalCandidateRow = {
  id: string;
  user_id: string;
  run_id: string | null;
  source: string;
  date_signal: string | null;
  texte_brut: string;
  url_source: string | null;
  siren: string | null;
  company_name: string | null;
  hash: string;
  statut: "brut" | "filtré" | "rejeté" | "retenu" | "creusé";
  motif_rejet: string | null;
  facts: Record<string, unknown>;
  identity: Record<string, unknown> | null;
  weight: number | null;
  badges: string[];
  triage: Record<string, unknown> | null;
  score: number | null;
  contact: Record<string, unknown> | null;
  prospect_id: string | null;
  publication: "pret" | "a_completer" | null;
  created_at: string;
  updated_at: string;
};

export type SignalCandidateInsert = Partial<
  Omit<SignalCandidateRow, "source" | "texte_brut" | "hash">
> &
  Pick<SignalCandidateRow, "source" | "texte_brut" | "hash">;
export type SignalCandidateUpdate = Partial<SignalCandidateRow>;

/** Réglages de l'entonnoir : zones, secteurs, run quotidien. */
export type FunnelSettings = {
  user_id: string;
  departements: string[];
  preferred_sectors: string[];
  excluded_sectors: string[];
  days: number;
  dig_limit: number;
  daily: boolean;
  /** Heure (Paris) du run automatique, 0 à 23. */
  auto_hour?: number;
  /** Fiches prêtes visées par jour (« Aujourd'hui »). */
  daily_target?: number;
  /** Jour (AAAA-MM-JJ) du dernier run automatique : un seul par jour. */
  last_auto_run_on?: string | null;
  created_at: string;
  updated_at: string;
};

/** Motifs d'écart proposés dans « Aujourd'hui ». */
export const DISCARD_REASONS = ["hors_cible", "trop_grande", "oppose", "pas_de_besoin", "mauvais_contact"] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

export const DISCARD_REASON_LABELS: Record<DiscardReason, string> = {
  hors_cible: "Hors cible",
  trop_grande: "Trop grande structure",
  oppose: "Opposé",
  pas_de_besoin: "Pas de vrai besoin",
  mauvais_contact: "Mauvais contact",
};

/** Groupes de « Aujourd'hui », dans l'ordre d'affichage. */
export const TODAY_KINDS = ["reponse", "relance", "nouveau", "a_completer"] as const;
export type TodayKind = (typeof TODAY_KINDS)[number];

/**
 * Un écart saisi dans « Aujourd'hui ». Rien n'est supprimé : la ligne sort
 * l'élément de la file et nourrit les statistiques. « Annuler » renseigne
 * `undone_at`.
 */
export type ProspectDiscard = {
  id: string;
  user_id: string;
  prospect_id: string | null;
  message_id: string | null;
  inbound_id: string | null;
  candidate_id: string | null;
  kind: TodayKind;
  reason: DiscardReason;
  created_at: string;
  undone_at: string | null;
};

export type ProspectDiscardInsert = Partial<ProspectDiscard> & Pick<ProspectDiscard, "kind" | "reason">;
export type ProspectDiscardUpdate = Partial<ProspectDiscard>;
export type MessageVersionInsert = Partial<MessageVersion> & Pick<MessageVersion, "body" | "reason">;

export type FunnelSettingsInsert = Partial<FunnelSettings>;
export type FunnelSettingsUpdate = Partial<FunnelSettings>;

/**
 * Réglages de recherche d'un utilisateur.
 *
 * `excluded_sectors` contient des PRÉFIXES NAF, pas des codes complets :
 * « 8553Z » vise les auto-écoles, « 85 » viserait tout l'enseignement.
 */
export type SearchSettings = {
  user_id: string;
  excluded_sectors: string[];
  created_at: string;
  updated_at: string;
};

export type SearchSettingsInsert = Insert<SearchSettings, "excluded_sectors">;
export type SearchSettingsUpdate = Update<SearchSettings>;

export type SearchRunInsert = Insert<
  SearchRun,
  "criteria" | "status" | "progress" | "results" | "warnings" | "error" | "stop_requested"
>;
export type SearchRunUpdate = Update<SearchRun>;

export type ApiUsageInsert = Insert<ApiUsage, "units" | "unit_cost" | "cost" | "prospect_id">;
export type ApiUsageUpdate = Update<ApiUsage>;

// ---------------------------------------------------------------------------
// Vues composées fréquemment utilisées par les écrans
// ---------------------------------------------------------------------------

/** Prospect enrichi de ses relations (jointures Supabase). */
export type ProspectWithRelations = Prospect & {
  messages?: Message[];
  deals?: Deal[];
  reminders?: Reminder[];
};

// ---------------------------------------------------------------------------
// Schéma consommé par le client Supabase typé (`createClient<Database>()`)
// ---------------------------------------------------------------------------

/**
 * `Relationships: []` est requis par postgrest-js pour reconnaître le schéma :
 * sans lui, le client retombe sur `never` et toutes les requêtes typées cassent.
 * On n'y déclare pas les FK — les jointures restent typées à la main via
 * `ProspectWithRelations`.
 */
export type Database = {
  public: {
    Tables: {
      prospects: {
        Row: Prospect;
        Insert: ProspectInsert;
        Update: ProspectUpdate;
        Relationships: [];
      };
      messages: {
        Row: Message;
        Insert: MessageInsert;
        Update: MessageUpdate;
        Relationships: [];
      };
      deals: {
        Row: Deal;
        Insert: DealInsert;
        Update: DealUpdate;
        Relationships: [];
      };
      reminders: {
        Row: Reminder;
        Insert: ReminderInsert;
        Update: ReminderUpdate;
        Relationships: [];
      };
      action_states: {
        Row: ActionState;
        Insert: ActionStateInsert;
        Update: ActionStateUpdate;
        Relationships: [];
      };
      favorites: {
        Row: Favorite;
        Insert: FavoriteInsert;
        Update: FavoriteUpdate;
        Relationships: [];
      };
      mail_subject_checks: {
        Row: MailSubjectCheck;
        Insert: Omit<MailSubjectCheck, "user_id" | "created_at"> & Partial<Pick<MailSubjectCheck, "user_id" | "created_at">>;
        Update: Partial<MailSubjectCheck>;
        Relationships: [];
      };
      inbound_messages: {
        Row: InboundMessage;
        Insert: InboundMessageInsert;
        Update: InboundMessageUpdate;
        Relationships: [];
      };
      search_settings: {
        Row: SearchSettings;
        Insert: SearchSettingsInsert;
        Update: SearchSettingsUpdate;
        Relationships: [];
      };
      signal_candidates: {
        Row: SignalCandidateRow;
        Insert: SignalCandidateInsert;
        Update: SignalCandidateUpdate;
        Relationships: [];
      };
      funnel_settings: {
        Row: FunnelSettings;
        Insert: FunnelSettingsInsert;
        Update: FunnelSettingsUpdate;
        Relationships: [];
      };
      message_versions: {
        Row: MessageVersion;
        Insert: MessageVersionInsert;
        Update: Partial<MessageVersion>;
        Relationships: [];
      };
      prospect_discards: {
        Row: ProspectDiscard;
        Insert: ProspectDiscardInsert;
        Update: ProspectDiscardUpdate;
        Relationships: [];
      };
      search_runs: {
        Row: SearchRun;
        Insert: SearchRunInsert;
        Update: SearchRunUpdate;
        Relationships: [];
      };
      api_usage: {
        Row: ApiUsage;
        Insert: ApiUsageInsert;
        Update: ApiUsageUpdate;
        Relationships: [];
      };
      enrichment_cache: {
        Row: EnrichmentCache;
        Insert: EnrichmentCacheInsert;
        Update: EnrichmentCacheUpdate;
        Relationships: [];
      };
      excluded_companies: {
        Row: ExcludedCompany;
        Insert: ExcludedCompanyInsert;
        Update: ExcludedCompanyUpdate;
        Relationships: [];
      };
      scan_history: {
        Row: ScanHistory;
        Insert: ScanHistoryInsert;
        Update: ScanHistoryUpdate;
        Relationships: [];
      };
      user_offer: {
        Row: UserOffer;
        Insert: UserOfferInsert;
        Update: UserOfferUpdate;
        Relationships: [];
      };
      notification_prefs: {
        Row: NotificationPrefsRow;
        Insert: Partial<NotificationPrefsRow>;
        Update: Partial<NotificationPrefsRow>;
        Relationships: [];
      };
      notification_log: {
        Row: NotificationLogRow;
        Insert: Pick<NotificationLogRow, "key" | "kind"> & Partial<NotificationLogRow>;
        Update: Partial<NotificationLogRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      prospect_status: ProspectStatus;
      prospect_source: ProspectSource;
      message_type: MessageType;
      inbound_category: InboundCategory;
      message_status: MessageStatus;
      deal_status: DealStatus;
      api_service: ApiService;
    };
    CompositeTypes: Record<string, never>;
  };
}
