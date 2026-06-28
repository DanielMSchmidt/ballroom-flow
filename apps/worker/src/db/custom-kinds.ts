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
      `INSERT INTO account_custom_kind (userId, kind, label, color, cardinality, valueType, valuesJson, freeText, appliesToDancesJson, updatedAt, deletedAt)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL)
       ON CONFLICT(userId, kind) DO UPDATE SET
         label=?3, color=?4, cardinality=?5, valueType=?6, valuesJson=?7, freeText=?8, appliesToDancesJson=?9, updatedAt=?10, deletedAt=NULL`,
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
      now,
    )
    .run();
}

/** List all non-deleted custom kinds for the given user (newest first). */
export async function listAccountKinds(db: D1Database, userId: string): Promise<RegistryKindDto[]> {
  const rows = await db
    .prepare(
      `SELECT kind, label, color, cardinality, valueType, valuesJson, freeText, appliesToDancesJson
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
    builtin: false,
  }));
}
