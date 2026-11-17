import { describe, expect, it } from "vitest";
import { JobCallError, JobQueue, type JobBoss } from "../../src/jobs/job-queue.service.js";

/** A fake pg-boss: jobs complete after `completeAfterPolls` reads, with the given output. */
function fakeBoss(script: { state: string; output?: unknown; completeAfterPolls?: number }) {
  const sent: { queue: string; data: object; options: unknown }[] = [];
  const created: string[] = [];
  const cancelled: string[] = [];
  let polls = 0;
  const boss: JobBoss = {
    createQueue: async (name) => void created.push(name),
    send: async (queue, data, options) => {
      sent.push({ queue, data, options });
      return `job-${sent.length}`;
    },
    getJobById: async () => {
      polls += 1;
      return polls > (script.completeAfterPolls ?? 0)
        ? { state: script.state, output: script.output }
        : { state: "active" };
    },
    cancel: async (_queue, id) => void cancelled.push(id),
  };
  return { boss, sent, created, cancelled };
}

/** A clock that advances only when the queue sleeps. */
function fakeTime() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("JobQueue (T027)", () => {
  it("creates each queue once and sends jobs with their options", async () => {
    const { boss, sent, created } = fakeBoss({ state: "completed" });
    const queue = new JobQueue(boss);
    await queue.send("calendar.refresh", { feedId: "f1" }, { priority: 10, singletonKey: "f1" });
    await queue.send("calendar.refresh", { feedId: "f2" });
    expect(created).toEqual(["calendar.refresh"]);
    expect(sent[0]).toEqual({
      queue: "calendar.refresh",
      data: { feedId: "f1" },
      options: { priority: 10, singletonKey: "f1" },
    });
  });

  it("returns the worker's output from call", async () => {
    const time = fakeTime();
    const { boss, sent } = fakeBoss({
      state: "completed",
      output: { listings: [{ externalId: "1:2" }] },
      completeAfterPolls: 3,
    });
    const queue = new JobQueue(boss, time.sleep, time.now);
    const output = await queue.call("pms.listings", { connectionId: "c1" }, 15_000);
    expect(output).toEqual({ listings: [{ externalId: "1:2" }] });
    expect(sent[0]?.options).toEqual({ retryLimit: 0, expireInSeconds: 15 });
  });

  it("cancels the job and fails with a timeout after the wait", async () => {
    const time = fakeTime();
    const { boss, cancelled } = fakeBoss({ state: "completed", completeAfterPolls: 1_000_000 });
    const queue = new JobQueue(boss, time.sleep, time.now);
    const error = await queue
      .call<never>("pms.revoke", { connectionId: "c1" }, 15_000)
      .catch((e: unknown) => e as JobCallError);
    expect(error).toBeInstanceOf(JobCallError);
    expect(error.reason).toBe("timeout");
    expect(cancelled).toEqual(["job-1"]);
    expect(time.now()).toBe(15_000);
  });

  it("fails when the worker's job fails, without the job's data in the error", async () => {
    const { boss } = fakeBoss({ state: "failed", output: { message: "secret-token" } });
    const queue = new JobQueue(boss, async () => undefined);
    const error = await queue
      .call<never>("pms.revoke", { credential: "secret-token" }, 15_000)
      .catch((e: unknown) => e as JobCallError);
    expect(error).toBeInstanceOf(JobCallError);
    expect(error.reason).toBe("failed");
    expect(String(error.message)).not.toContain("secret-token");
  });
});
