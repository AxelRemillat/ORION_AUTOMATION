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
type Filter = (row: Row) => boolean;

const CASCADE: Record<string, { delete: string[]; nullify: string[] }> = {
  prospects: { delete: ["messages", "deals", "reminders"], nullify: ["inbound_messages"] },
};

export class FakeDb {
  constructor(public tables: Record<string, Row[]> = {}) {}

  from(table: string) {
    this.tables[table] ??= [];
    return new FakeQuery(this, table);
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
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
  private one: "single" | "maybe" | null = null;

  constructor(private db: FakeDb, private table: string) {}

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
  not(column: string, operator: "is", value: null) {
    return this.where((row) => (operator === "is" ? (row[column] ?? null) !== value : true));
  }
  in(column: string, values: unknown[]) { return this.where((row) => values.includes(row[column])); }
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
    const tests = [...expression.matchAll(/([\w>-]+)\.(is|eq|lt|in)\.(\([^)]*\)|[^,]+)/g)].map(
      ([, column, op, raw]) =>
        (row: Row) => {
          const value = read(row, column);
          if (op === "is") return (value ?? null) === null;
          if (op === "eq") return String(value) === raw;
          if (op === "lt") return value != null && String(value) < raw;
          return raw.slice(1, -1).split(",").includes(String(value));
        },
    );
    return this.where((row) => tests.some((test) => test(row)));
  }
  lt(column: string, value: string) { return this.where((row) => String(row[column]) < value); }
  lte(column: string, value: string) { return this.where((row) => String(row[column]) <= value); }
  gt(column: string, value: string) { return this.where((row) => String(row[column]) > value); }
  gte(column: string, value: string) { return this.where((row) => String(row[column]) >= value); }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.sort = { column, ascending: options.ascending !== false };
    return this;
  }
  limit(count: number) { this.max = count; return this; }
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

  private run(): { data: unknown; error: null; count: number | null } {
    const all = this.db.tables[this.table];
    const matches = all.filter((row) => this.filters.every((filter) => filter(row)));
    let result: Row[] = [];

    if (this.op === "select") {
      result = [...matches];
      if (this.sort) {
        const { column, ascending } = this.sort;
        result.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
      }
      if (this.max !== null) result = result.slice(0, this.max);
      if (this.head) return { data: null, error: null, count: matches.length };
      return this.finish(this.project(result), this.counted ? matches.length : null);
    }

    if (this.op === "insert") {
      result = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => ({ ...row }));
      all.push(...result);
    } else if (this.op === "upsert") {
      for (const row of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const existing = all.find((item) => this.conflict.every((key) => item[key] === row[key]));
        if (existing && this.ignoreDuplicates) continue;
        if (existing) Object.assign(existing, row);
        else all.push({ created_at: new Date().toISOString(), ...row });
        result.push(row);
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

  then<A = { data: unknown; error: null; count: number | null }, B = never>(
    resolve?: ((value: { data: unknown; error: null; count: number | null }) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(resolve, reject);
  }
}
