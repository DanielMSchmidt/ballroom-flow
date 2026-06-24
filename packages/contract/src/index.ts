// @ballroom/contract — Zod request/response schemas + Hono RPC types.
// The real route contract (AppType) is added alongside the Worker in Milestone 2.
import { z } from "zod";

export const zPlaceholder = z.object({});
export type Placeholder = z.infer<typeof zPlaceholder>;
