// US-043 — account-wide custom attribute kinds (server-mediated D1, like family
// notes). PK (userId, kind) makes upsert + per-user list cheap and indexed.
import { type RegistryKindDto, zRegistryKind } from "@weavesteps/contract";

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
      `INSERT INTO account_custom_kind (userId, kind, label, color, cardinality, valueType, valuesJson, freeText, appliesToDancesJson, description, valueDefsJson, roleAware, required, bothWrite, couplingJson, updatedAt, deletedAt)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,NULL)
       ON CONFLICT(userId, kind) DO UPDATE SET
         label=?3, color=?4, cardinality=?5, valueType=?6, valuesJson=?7, freeText=?8, appliesToDancesJson=?9, description=?10, valueDefsJson=?11, roleAware=?12, required=?13, bothWrite=?14, couplingJson=?15, updatedAt=?16, deletedAt=NULL`,
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
      k.bothWrite ?? null,
      k.coupling ? JSON.stringify(k.coupling) : null,
      now,
    )
    .run();
}

/** List all non-deleted custom kinds for the given user (newest first). */
export async function listAccountKinds(db: D1Database, userId: string): Promise<RegistryKindDto[]> {
  const rows = await db
    .prepare(
      `SELECT kind, label, color, cardinality, valueType, valuesJson, freeText, appliesToDancesJson, description, valueDefsJson, roleAware, required, bothWrite, couplingJson
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
      bothWrite: string | null;
      couplingJson: string | null;
    }>();
  // Re-validate through the contract schema on the way OUT of D1: the write
  // path (`upsertAccountKind`) only stores zRegistryKind-parsed DTOs, so this
  // parse is the runtime proof of the enum/JSON-column claims the old casts
  // merely asserted — a corrupt row now fails loudly instead of leaking a
  // malformed kind into the merged registry.
  return rows.results.map((r) =>
    zRegistryKind.parse({
      kind: r.kind,
      label: r.label,
      color: r.color,
      cardinality: r.cardinality,
      valueType: r.valueType,
      values: r.valuesJson ? JSON.parse(r.valuesJson) : undefined,
      freeText: r.freeText == null ? undefined : r.freeText === 1,
      appliesToDances: r.appliesToDancesJson ? JSON.parse(r.appliesToDancesJson) : undefined,
      description: r.description ?? undefined,
      valueDefs: r.valueDefsJson ? JSON.parse(r.valueDefsJson) : undefined,
      roleAware: r.roleAware == null ? undefined : r.roleAware === 1,
      required: r.required == null ? undefined : r.required === 1,
      bothWrite: r.bothWrite ?? undefined,
      coupling: r.couplingJson ? JSON.parse(r.couplingJson) : undefined,
      builtin: false,
    }),
  );
}
