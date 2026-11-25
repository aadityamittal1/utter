import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/ipc", () => ({ on: vi.fn(async () => () => undefined) }));

import { beginDownload, getDownloads, handleProgress, markCancelled, resetDownloads } from "./downloads";

const p = (over: object) => ({ id: "m", downloaded: 1, total: 10, done: false, ...over });

describe("downloads store", () => {
  beforeEach(() => resetDownloads());

  it("tracks progress and clears on done, bumping doneTick", () => {
    handleProgress(p({}));
    expect(getDownloads().progress.m.downloaded).toBe(1);
    handleProgress(p({ done: true }));
    expect(getDownloads().progress.m).toBeUndefined();
    expect(getDownloads().doneTick).toBe(1);
  });

  it("ignores events (including errors) for a cancelled download until it restarts", () => {
    beginDownload("m");
    markCancelled("m");
    handleProgress(p({}));
    handleProgress(p({ error: "aborted" }));
    expect(getDownloads().progress.m).toBeUndefined();
    expect(getDownloads().errors.m).toBeUndefined();
    beginDownload("m");
    handleProgress(p({ downloaded: 5 }));
    expect(getDownloads().progress.m.downloaded).toBe(5);
  });

  it("records backend errors", () => {
    handleProgress(p({ error: "disk full" }));
    expect(getDownloads().errors.m).toBe("disk full");
  });
});
