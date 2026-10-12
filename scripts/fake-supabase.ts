/**
 * Faux client Supabase en mémoire, pour tester le code de requêtes réel
 * (lib/trash) sans base ni réseau.
 *
 * Couvre ce que la corbeille utilise : select (colonnes simples, count/head),
 * eq, neq, is, not(col, "is", null), in, lt/lte/gt/gte, order, limit,
 * single/maybeSingle, insert, update, delete, upsert (onConflict,
 * ignoreDuplicates). La suppression d'un prospect cascade comme en base :
 * messages, deals, relances supprimés ; emails reçus détachés.
 */

type Row = Record<string, unknown>;

let generated = 0;
type Filter = (row: Row) => boolean;

const CASCADE: Record<string, { delete: string[]; nullify: string[] }> = {
  prospects: { delete: ["messages", "deals", "reminders"], nullify: ["inbound_messages"] },
};

export class FakeDb {
  /**
   * `strictTables` : une table ou une vue absente rend une ERREUR, comme
   * PostgREST (« Could not find the table … in the schema cache »). À utiliser
   * dès qu'un code a un repli quand une vue manque — sinon le test prend le
   * chemin rapide avec zéro ligne et ne prouve rien.
   */
  constructor(
    public tables: Record<string, Row[]> = {},
    private options: { strictTables?: boolean } = {},
  ) {}

  has(table: string): boolean {
    return !this.options.strictTables || table in this.tables;
  }

  from(table: string) {
    // L'ordre compte : `??=` crée la table, donc on relève son existence avant.
    const known = this.has(table);
    this.tables[table] ??= [];
    return new FakeQuery(this, table, known);
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }
}

/** Ce que rend une requête : `error` est renseignée pour une table inconnue (mode strict). */
type FakeResult = { data: unknown; error: { message: string } | null; count: number | null };

class FakeQuery implements PromiseLike<FakeResult> {
  private op: "select" | "update" | "delete" | "insert" | "upsert" = "select";
  private filters: Filter[] = [];
  private columns = "*";
  private returning = false;
  private head = false;
  private counted = false;
  private payload: Row | Row[] = {};
  private conflict: string[] = [];
  private ignoreDuplicates = false;
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private offset = 0;
  private one: "single" | "maybe" | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
    /** `false` pour une table ou une vue inconnue en mode strict : toute lecture rend une erreur. */
    private known = true,
  ) {}

  select(columns = "*", options: { count?: string; head?: boolean } = {}) {
    if (this.op === "select") {
      this.columns = columns;
      this.counted = Boolean(options.count);
      this.head = Boolean(options.head);
    } else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }
  eq(column: string, value: unknown) { return this.where((row) => row[column] === value); }
  neq(column: string, value: unknown) { return this.where((row) => row[column] !== value); }
  is(column: string, value: null) { return this.where((row) => (row[column] ?? null) === value); }
  not(column: string, operator: "is" | "in", value: null | string) {
    if (operator === "in") {
      // PostgREST : « (a,b) ». Comme en SQL, NULL NOT IN (…) ne retient pas la ligne.
      const values = String(value).replace(/^\(|\)$/g, "").split(",").map((item) => item.trim());
      return this.where((row) => row[column] != null && !values.includes(String(row[column])));
    }
    return this.where((row) => (row[column] ?? null) !== value);
  }
  in(column: string, values: unknown[]) { return this.where((row) => values.includes(row[column])); }
  /** `like` PostgREST, motif de préfixe seulement (« texte% »). */
  like(column: string, pattern: string) { return this.where((row) => String(row[column] ?? "").startsWith(pattern.replace(/%$/, ""))); }
  /**
   * Filtre PostgREST `or` : « a.is.null,b.lt.X,c.in.(x,y),d->>k.eq.v ».
   * Juste ce que lib/jobs emploie ; un opérateur inconnu ne retient rien.
   */
  or(expression: string) {
    const read = (row: Row, column: string) => {
      const [base, key] = column.split("->>");
      const value = row[base];
      return key ? (value as Row | null | undefined)?.[key] : value;
    };
    const tests = [...expression.matchAll(/([\w>-]+)\.(is|eq|lt|in|like)\.(\([^)]*\)|[^,]+)/g)].map(
      ([, column, op, raw]) =>
        (row: Row) => {
          const value = read(row, column);
          if (op === "is") return (value ?? null) === null;
          if (op === "eq") return String(value) === raw;
          if (op === "lt") return value != null && String(value) < raw;
          if (op === "like") return value != null && String(value).startsWith(raw.replace(/%$/, ""));
          return raw.slice(1, -1).split(",").includes(String(value));
        },
    );
    return this.where((row) => tests.some((test) => test(row)));
  }
  lt(column: string, value: string) { return this.where((row) => String(row[column]) < value); }
  lte(column: string, value: string) { return this.where((row) => String(row[column]) <= value); }
  gt(column: string, value: string) { return this.where((row) => String(row[column]) > value); }
  gte(column: string, value: string) { return this.where((row) => String(row[column]) >= value); }
  /** `%` = n'importe quelle suite, insensible à la casse (comme PostgREST). */
  ilike(column: string, pattern: string) {
    const regex = new RegExp(`^${pattern.split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
    return this.where((row) => typeof row[column] === "string" && regex.test(row[column] as string));
  }
  /** Seul le PREMIER ordre compte (les suivants départagent : sans effet ici). */
  order(column: string, options: { ascending?: boolean } = {}) {
    if (!this.sort) this.sort = { column, ascending: options.ascending !== false };
    return this;
  }
  limit(count: number) { this.max = count; return this; }
  range(from: number, to: number) { this.offset = from; this.max = to - from + 1; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }

  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(rows: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = rows;
    this.conflict = (options.onConflict ?? "id").split(",").map((part) => part.trim());
    this.ignoreDuplicates = Boolean(options.ignoreDuplicates);
    return this;
  }

  private where(filter: Filter) { this.filters.push(filter); return this; }

  private project(rows: Row[]): Row[] {
    if (this.columns.trim() === "*") return rows.map((row) => ({ ...row }));
    const keys = this.columns.split(",").map((key) => key.trim());
    return rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null])));
  }

  private run(): FakeResult {
    if (!this.known) {
      return { data: null, error: { message: `Could not find the table 'public.${this.table}' in the schema cache` }, count: null };
    }
    const all = this.db.tables[this.table];
    const matches = all.filter((row) => this.filters.every((filter) => filter(row)));
    let result: Row[] = [];

    if (this.op === "select") {
      result = [...matches];
      if (this.sort) {
        const { column, ascending } = this.sort;
        result.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
      }
      if (this.max !== null) result = result.slice(this.offset, this.offset + this.max);
      if (this.head) return { data: null, error: null, count: matches.length };
      return this.finish(this.project(result), this.counted ? matches.length : null);
    }

    if (this.op === "insert") {
      // Comme en base : un `id` est attribué s'il n'est pas fourni.
      result = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => ({
        id: `gen-${++generated}`,
        ...row,
      }));
      all.push(...result);
    } else if (this.op === "upsert") {
      for (const row of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const existing = all.find((item) => this.conflict.every((key) => item[key] === row[key]));
        if (existing && this.ignoreDuplicates) continue;
        if (existing) {
          Object.assign(existing, row);
          result.push(existing);
        } else {
          // Comme pour insert : un `id` est attribué s'il n'est pas fourni.
          const created = { id: `gen-${++generated}`, created_at: new Date().toISOString(), ...row };
          all.push(created);
          result.push(created);
        }
      }
    } else if (this.op === "update") {
      for (const row of matches) Object.assign(row, this.payload);
      result = matches;
    } else if (this.op === "delete") {
      this.db.tables[this.table] = all.filter((row) => !matches.includes(row));
      this.cascade(matches);
      result = matches;
    }
    return this.finish(this.returning ? this.project(result) : null, null);
  }

  private cascade(deleted: Row[]) {
    const rule = CASCADE[this.table];
    if (!rule) return;
    const ids = new Set(deleted.map((row) => row.id));
    for (const table of rule.delete) {
      this.db.tables[table] = this.db.rows(table).filter((row) => !ids.has(row.prospect_id));
    }
    for (const table of rule.nullify) {
      for (const row of this.db.rows(table)) if (ids.has(row.prospect_id)) row.prospect_id = null;
    }
  }

  private finish(data: Row[] | null, count: number | null) {
    if (!this.one || data === null) return { data, error: null, count };
    if (this.one === "single" && data.length !== 1) throw new Error(`single() : ${data.length} ligne(s)`);
    return { data: data[0] ?? null, error: null, count };
  }

  then<A = FakeResult, B = never>(
    resolve?: ((value: FakeResult) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(resolve, reject);
  }
}
