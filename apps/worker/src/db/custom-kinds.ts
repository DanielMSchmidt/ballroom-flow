// US-043 — account-wide custom attribute kinds (server-mediated D1, like family
// notes). PK (userId, kind) makes upsert + per-user list cheap and indexed.
import type { RegistryKindDto } from "@ballroom/contract";

/** Upsert a custom kind for the given user. `now` is a unix-ms timestamp supplied
 *  by the caller (worker route code may use `Date.now()`; domain code may not). */
export async function upsertAccountKind(
  db: D1Database,
  userId: string,
  k: RegistryKindDto,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO account_custom_kind (userId, kind, label, color, cardinality, valueType, valuesJson, freeText, appliesToDancesJson, description, valueDefsJson, roleAware, required, updatedAt, deletedAt)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,NULL)
       ON CONFLICT(userId, kind) DO UPDATE SET
         label=?3, color=?4, cardinality=?5, valueType=?6, valuesJson=?7, freeText=?8, appliesToDancesJson=?9, description=?10, valueDefsJson=?11, roleAware=?12, required=?13, updatedAt=?14, deletedAt=NULL`,
    )
    .bind(
      userId,
      k.kind,
      k.label,
      k.color,
      k.cardinality,
      k.valueType,
      k.values ? JSON.stringify(k.values) : null,
      k.freeText == null ? null : k.freeText ? 1 : 0,
      k.appliesToDances ? JSON.stringify(k.appliesToDances) : null,
      k.description ?? null,
      k.valueDefs ? JSON.stringify(k.valueDefs) : null,
      k.roleAware == null ? null : k.roleAware ? 1 : 0,
      k.required == null ? null : k.required ? 1 : 0,
      now,
    )
    .run();
}

/** List all non-deleted custom kinds for the given user (newest first). */
export async function listAccountKinds(db: D1Database, userId: string): Promise<RegistryKindDto[]> {
  const rows = await db
    .prepare(
      `SELECT kind, label, color, cardinality, valueType, valuesJson, freeText, appliesToDancesJson, description, valueDefsJson, roleAware, required
       FROM account_custom_kind WHERE userId = ?1 AND deletedAt IS NULL ORDER BY updatedAt DESC`,
    )
    .bind(userId)
    .all<{
      kind: string;
      label: string;
      color: string;
      cardinality: string;
      valueType: string;
      valuesJson: string | null;
      freeText: number | null;
      appliesToDancesJson: string | null;
      description: string | null;
      valueDefsJson: string | null;
      roleAware: number | null;
      required: number | null;
    }>();
  return rows.results.map((r) => ({
    kind: r.kind,
    label: r.label,
    color: r.color,
    cardinality: r.cardinality as "single" | "multi",
    valueType: r.valueType,
    values: r.valuesJson ? (JSON.parse(r.valuesJson) as string[]) : undefined,
    freeText: r.freeText == null ? undefined : r.freeText === 1,
    appliesToDances: r.appliesToDancesJson
      ? (JSON.parse(r.appliesToDancesJson) as RegistryKindDto["appliesToDances"])
      : undefined,
    description: r.description ?? undefined,
    valueDefs: r.valueDefsJson
      ? (JSON.parse(r.valueDefsJson) as Record<string, string>)
      : undefined,
    roleAware: r.roleAware == null ? undefined : r.roleAware === 1,
    required: r.required == null ? undefined : r.required === 1,
    builtin: false,
  }));
}
