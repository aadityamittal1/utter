import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PillState } from "../lib/types";
import { PillView } from "./Pill";

function html(state: PillState): string {
  return renderToStaticMarkup(<PillView state={state} levelsRef={{ current: [] }} />);
}

const err: PillState = { state: "error", mode: "dictate", elapsedMs: 0, message: "Transcription failed" };

describe("pill Retry chip", () => {
  it("is shown when the error is retryable", () => {
    expect(html({ ...err, retryable: true })).toContain("Retry");
  });
  it("is hidden when retryable is false or absent", () => {
    expect(html({ ...err, retryable: false })).not.toContain("Retry");
    expect(html(err)).not.toContain("Retry");
  });
  it("still shows the error message", () => {
    expect(html(err)).toContain("Transcription failed");
  });
});
