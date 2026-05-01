import { describe, expect, it } from "vitest";

import { HTTPClient } from "../src/index";
import type { UserRef } from "../src/types";

describe("HTTPClient", () => {
  it("encodes metadata bodies as base64 and decodes scan responses", async () => {
    const owner: UserRef = { nodeId: "4096", userId: "1025" };
    const key = "prefs.theme";
    const expiresAt = "2026-05-01T00:00:00Z";

    const client = new HTTPClient("http://turntf.test", {
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(request?.url ?? String(input));
        const method = init?.method ?? request?.method ?? "GET";
        const headers = new Headers(init?.headers ?? request?.headers);

        expect(headers.get("Authorization")).toBe("Bearer admin-token");

        if (url.pathname === "/nodes/4096/users/1025/metadata" && method === "GET") {
          expect(url.searchParams.get("prefix")).toBe("prefs.");
          expect(url.searchParams.get("after")).toBe(key);
          expect(url.searchParams.get("limit")).toBe("2");
          return Response.json({
            items: [
              {
                owner,
                key: "prefs.alpha",
                value: Buffer.from([0xff, 0x00]).toString("base64"),
                updated_at: "hlc-scan-1",
                deleted_at: "",
                expires_at: "",
                origin_node_id: "4096"
              },
              {
                owner,
                key: "prefs.beta",
                value: Buffer.from("next").toString("base64"),
                updated_at: "hlc-scan-2",
                deleted_at: "",
                expires_at: expiresAt,
                origin_node_id: "4096"
              }
            ],
            count: 2,
            next_after: "prefs.beta"
          });
        }

        if (url.pathname === `/nodes/4096/users/1025/metadata/${key}` && method === "GET") {
          return Response.json({
            owner,
            key,
            value: Buffer.from([0xaa, 0xbb]).toString("base64"),
            updated_at: "hlc-get",
            deleted_at: "",
            expires_at: expiresAt,
            origin_node_id: "4096"
          });
        }

        if (url.pathname === `/nodes/4096/users/1025/metadata/${key}` && method === "PUT") {
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
          expect(body.value).toBe("");
          expect(body.expires_at).toBe(expiresAt);
          return Response.json(
            {
              owner,
              key,
              value: "",
              updated_at: "hlc-upsert",
              deleted_at: "",
              expires_at: expiresAt,
              origin_node_id: "4096"
            },
            { status: 201 }
          );
        }

        if (url.pathname === `/nodes/4096/users/1025/metadata/${key}` && method === "DELETE") {
          return Response.json({
            owner,
            key,
            value: Buffer.from("gone").toString("base64"),
            updated_at: "hlc-upsert",
            deleted_at: "hlc-deleted",
            expires_at: expiresAt,
            origin_node_id: "4096"
          });
        }

        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      }
    });

    const metadata = await client.getUserMetadata("admin-token", owner, key);
    expect(metadata.key).toBe(key);
    expect(Array.from(metadata.value)).toEqual([0xaa, 0xbb]);
    expect(metadata.expiresAt).toBe(expiresAt);

    const upserted = await client.upsertUserMetadata("admin-token", owner, key, {
      value: new Uint8Array(),
      expiresAt
    });
    expect(upserted.updatedAt).toBe("hlc-upsert");
    expect(upserted.value).toHaveLength(0);

    const page = await client.scanUserMetadata("admin-token", owner, {
      prefix: "prefs.",
      after: key,
      limit: 2
    });
    expect(page.count).toBe(2);
    expect(page.nextAfter).toBe("prefs.beta");
    expect(Array.from(page.items[0]!.value)).toEqual([0xff, 0x00]);

    const deleted = await client.deleteUserMetadata("admin-token", owner, key);
    expect(deleted.deletedAt).toBe("hlc-deleted");
    expect(Array.from(deleted.value)).toEqual(Array.from(Buffer.from("gone")));
  });
});
