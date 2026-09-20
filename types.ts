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

export const MESSAGE_TYPES = ["intro", "relance_1", "relance_2", "note"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = ["draft", "sent"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const DEAL_STATUSES = ["ouvert", "gagne", "perdu"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

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
  /** Date ISO du signal, telle que fournie par la source. */
  date?: string;
  source?: string;
  /** Phrase exacte de la source qui atteste le signal. */
  quote?: string;
  /** Confiance dans la preuve, de 0 à 1. Absente = non prouvé. */
  confidence?: number;
  [key: string]: unknown;
}

/** Chiffres clés issus des données légales / financières. */
export interface ProspectKeyFigures {
  revenue_eur?: number;
  headcount?: number;
  founded_year?: number;
  legal_form?: string;
  naf_code?: string;
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
  sector: string | null;
  size_range: string | null;
  city: string | null;
  source: ProspectSource;
  /** Toujours un tableau côté app (défaut SQL `'[]'::jsonb`). */
  signals: ProspectSignal[];
  /** Toujours un objet côté app (défaut SQL `'{}'::jsonb`). */
  key_figures: ProspectKeyFigures;
  pain_point: string | null;
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
  created_at: string;
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
  created_at: string;
}

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
  | "status"
>;
export type ProspectUpdate = Update<Prospect>;

export type MessageInsert = Insert<Message, "subject" | "status" | "sent_at">;
export type MessageUpdate = Update<Message>;

export type DealInsert = Insert<Deal, "amount_eur" | "status" | "signed_at">;
export type DealUpdate = Update<Deal>;

export type ReminderInsert = Insert<Reminder, "done">;
export type ReminderUpdate = Update<Reminder>;

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
      api_usage: {
        Row: ApiUsage;
        Insert: ApiUsageInsert;
        Update: ApiUsageUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      prospect_status: ProspectStatus;
      prospect_source: ProspectSource;
      message_type: MessageType;
      message_status: MessageStatus;
      deal_status: DealStatus;
      api_service: ApiService;
    };
    CompositeTypes: Record<string, never>;
  };
}
