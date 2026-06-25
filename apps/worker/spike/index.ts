// THROWAWAY SPIKE main — exports the DO so the binding resolves, plus a tiny
// fetch handler (not exercised heavily; tests drive the DO via RPC).
export { RoutineDO } from "./routine-do";

export default {
  async fetch(): Promise<Response> {
    return new Response("spike", { status: 200 });
  },
};
