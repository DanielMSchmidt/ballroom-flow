import { describe, expect, it } from "vitest";
import { fromQueryState } from "./remote-data";

describe("fromQueryState", () => {
  it("is pending when there is no data and no error", () => {
    expect(fromQueryState({ data: undefined, isError: false, error: null })).toEqual({
      status: "pending",
    });
  });

  it("is success when data is present", () => {
    expect(fromQueryState({ data: 42, isError: false, error: null })).toEqual({
      status: "success",
      value: 42,
    });
  });

  it("is error when the query failed and produced no data", () => {
    const boom = new Error("boom");
    expect(fromQueryState({ data: undefined, isError: true, error: boom })).toEqual({
      status: "error",
      error: boom,
    });
  });

  it("stays success during a refetch error while previous data is retained", () => {
    // This is the keepPreviousData case: data survives the refetch, so we must
    // NOT drop to pending/error and flash downstream references as unresolved.
    const boom = new Error("refetch failed");
    expect(fromQueryState({ data: 7, isError: true, error: boom })).toEqual({
      status: "success",
      value: 7,
    });
  });
});
