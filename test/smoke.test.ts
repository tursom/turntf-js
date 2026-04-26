import { describe, expect, it } from "vitest";

import {
  DeliveryMode,
  HTTPClient,
  MemoryCursorStore,
  hashedPassword,
  plainPasswordSync,
  proto
} from "../src/index";

describe("package entrypoint", () => {
  it("exports the main HTTP client and domain helpers", () => {
    const client = new HTTPClient("http://127.0.0.1:8080");

    expect(client.baseUrl).toBe("http://127.0.0.1:8080");
    expect(DeliveryMode.BestEffort).toBe("best_effort");
    expect(hashedPassword("abc")).toEqual({ source: "hashed", encoded: "abc" });
    expect(plainPasswordSync("secret").source).toBe("plain");
  });

  it("exports generated protobuf helpers through the proto namespace", () => {
    expect(proto.ClientEnvelope).toBeDefined();
    expect(proto.ClientDeliveryMode.BEST_EFFORT).toBeDefined();
  });

  it("keeps cursor store state isolated from callers", () => {
    const store = new MemoryCursorStore();
    const cursor = { nodeId: "1", seq: "2" };

    store.saveCursor(cursor);
    const seen = store.loadSeenMessages();
    expect(seen).toHaveLength(1);
    seen[0]!.seq = "3";

    expect(store.hasCursor(cursor)).toBe(true);
    expect(store.loadSeenMessages()).toEqual([cursor]);
  });
});
