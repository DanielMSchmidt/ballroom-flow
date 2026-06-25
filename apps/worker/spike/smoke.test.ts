// De-risk #1: does Automerge (WASM) even load + run inside workerd?
import * as A from "@automerge/automerge";
import { expect, it } from "vitest";

it("Automerge loads and runs inside workerd", () => {
  let doc = A.init<{ items: string[] }>();
  doc = A.change(doc, (d) => {
    d.items = ["feather"];
  });
  doc = A.change(doc, (d) => {
    d.items.push("three-step");
  });
  const bytes = A.save(doc);
  expect(bytes).toBeInstanceOf(Uint8Array);
  const reloaded = A.load<{ items: string[] }>(bytes);
  expect(reloaded.items).toEqual(["feather", "three-step"]);
});
