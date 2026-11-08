import { afterEach, describe, expect, it, vi } from "vitest";

const runMaintenance = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/maintenance", () => ({ runMaintenance }));

import { GET } from "@/app/api/cron/maintenance/route";

const request = (authorization?: string) => new Request("http://pepper.test/api/cron/maintenance", {
  headers: authorization ? { authorization } : undefined,
});

describe("maintenance endpoint authorization", () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    vi.clearAllMocks();
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("reports unconfigured maintenance without running cleanup", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request(), {});
    expect(response.status).toBe(503);
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid cron credentials", async () => {
    process.env.CRON_SECRET = "expected-secret";
    expect((await GET(request(), {})).status).toBe(401);
    expect((await GET(request("Bearer wrong-secret"), {})).status).toBe(401);
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it("runs cleanup only with the configured bearer secret", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const summary = { deletedJams: 2, deletedJamRequests: 1 };
    runMaintenance.mockResolvedValue(summary);
    const response = await GET(request("Bearer expected-secret"), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(runMaintenance).toHaveBeenCalledOnce();
  });
});
