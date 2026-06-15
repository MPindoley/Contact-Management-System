import { describe, expect, it } from "vitest";
import {
  annualRequired,
  buildClientTasks,
  clientScore,
  computeClientDueDates,
  dashboardBuckets,
  modelFor,
  monthlyProgress,
  nextDueDate,
  rebuildAllTasks,
  rollupScore,
  scoreColor,
  settleTasks,
  taskPriority,
} from "./serviceEngine";
import { addDays, diffDays, dueLabel } from "../lib/dates";
import type { Client, ContactEvent, ServiceModel, Task } from "../types";

const TODAY = "2026-06-11";

const MODELS: ServiceModel[] = [
  { tier: "A", meetingIntervalDays: 90, callIntervalDays: 30 },
  { tier: "B", meetingIntervalDays: 365, callIntervalDays: 90 },
  { tier: "C", meetingIntervalDays: 365, callIntervalDays: 180 },
];

let seq = 0;
function mkClient(overrides: Partial<Client> = {}): Client {
  seq += 1;
  return {
    id: `client-${seq}`,
    householdName: `Household ${seq}`,
    assignedAdvisor: "matt",
    tier: "A",
    active: true,
    phone: null,
    redtailId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mkEvent(clientId: string, overrides: Partial<ContactEvent> = {}): ContactEvent {
  seq += 1;
  return {
    id: `event-${seq}`,
    clientId,
    advisor: "matt",
    type: "call",
    eventDate: TODAY,
    durationMinutes: 20,
    notes: null,
    createdAt: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  };
}

describe("date helpers", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-01", 90)).toBe("2026-04-01");
    expect(addDays("2025-12-15", 30)).toBe("2026-01-14");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });

  it("diffs days symmetrically", () => {
    expect(diffDays("2026-06-01", "2026-06-11")).toBe(10);
    expect(diffDays("2026-06-11", "2026-06-01")).toBe(-10);
  });

  it("phrases due labels", () => {
    expect(dueLabel(TODAY, TODAY)).toBe("due today");
    expect(dueLabel("2026-06-10", TODAY)).toBe("1 day overdue");
    expect(dueLabel("2026-06-01", TODAY)).toBe("10 days overdue");
    expect(dueLabel("2026-06-12", TODAY)).toBe("due tomorrow");
    expect(dueLabel("2026-06-20", TODAY)).toBe("due in 9 days");
  });
});

describe("next due date (last contact + tier interval)", () => {
  it("applies each tier's rules", () => {
    expect(nextDueDate("2026-01-01", "meeting", modelFor(MODELS, "A"))).toBe("2026-04-01");
    expect(nextDueDate("2026-01-01", "call", modelFor(MODELS, "A"))).toBe("2026-01-31");
    expect(nextDueDate("2026-01-01", "meeting", modelFor(MODELS, "B"))).toBe("2027-01-01");
    expect(nextDueDate("2026-01-01", "call", modelFor(MODELS, "B"))).toBe("2026-04-01");
    expect(nextDueDate("2026-01-01", "call", modelFor(MODELS, "C"))).toBe("2026-06-30");
  });
});

describe("computeClientDueDates", () => {
  it("derives one due date per touch type from the latest event", () => {
    const client = mkClient({ tier: "A" });
    const events = [
      mkEvent(client.id, { type: "meeting", eventDate: "2026-03-01" }),
      mkEvent(client.id, { type: "meeting", eventDate: "2026-05-01" }),
      mkEvent(client.id, { type: "call", eventDate: "2026-06-01" }),
    ];

    const due = computeClientDueDates(client, events, MODELS);
    const meeting = due.find((d) => d.type === "meeting")!;
    const call = due.find((d) => d.type === "call")!;

    expect(meeting.dueDate).toBe("2026-07-30"); // 2026-05-01 + 90
    expect(call.dueDate).toBe("2026-07-01"); // 2026-06-01 + 30
  });

  it("ignores admin touches and backdated entries older than the latest", () => {
    const client = mkClient({ tier: "B" });
    const events = [
      mkEvent(client.id, { type: "call", eventDate: "2026-05-20" }),
      mkEvent(client.id, { type: "call", eventDate: "2026-02-01" }), // backdated, logged later
      mkEvent(client.id, { type: "admin", eventDate: "2026-06-10" }),
    ];

    const due = computeClientDueDates(client, events, MODELS);
    expect(due).toHaveLength(1);
    expect(due[0].type).toBe("call");
    expect(due[0].dueDate).toBe("2026-08-18"); // 2026-05-20 + 90, not the admin date
  });

  it("tracks meeting and call clocks independently", () => {
    const client = mkClient({ tier: "A" });
    const due = computeClientDueDates(
      client,
      [mkEvent(client.id, { type: "meeting", eventDate: "2026-06-01" })],
      MODELS,
    );
    // A meeting does not produce or reset a call due date.
    expect(due).toHaveLength(1);
    expect(due[0].type).toBe("meeting");
  });

  it("returns nothing for a client with no qualifying history", () => {
    const client = mkClient();
    expect(computeClientDueDates(client, [], MODELS)).toHaveLength(0);
  });
});

describe("tasks", () => {
  it("escalates priority: overdue → high, today → medium, upcoming → low", () => {
    expect(taskPriority("2026-06-01", TODAY)).toBe("high");
    expect(taskPriority(TODAY, TODAY)).toBe("medium");
    expect(taskPriority("2026-06-20", TODAY)).toBe("low");
  });

  it("surfaces tasks within the 14-day horizon and ages overdue ones", () => {
    const client = mkClient({ tier: "A" });
    const events = [
      mkEvent(client.id, { type: "call", eventDate: "2026-05-01" }), // due 2026-05-31 → 11 days overdue
      mkEvent(client.id, { type: "meeting", eventDate: "2026-05-15" }), // due 2026-08-13 → beyond horizon
    ];
    const due = computeClientDueDates(client, events, MODELS);
    const tasks = buildClientTasks(client, due, TODAY);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe("call");
    expect(tasks[0].daysOverdue).toBe(11);
    expect(tasks[0].priority).toBe("high");
  });

  it("suppresses a snoozed touch until the snooze date passes", () => {
    const client = mkClient({ tier: "A" });
    const due = computeClientDueDates(
      client,
      [mkEvent(client.id, { type: "call", eventDate: "2026-05-01" })], // due 2026-05-31, overdue
      MODELS,
    );
    expect(buildClientTasks(client, due, TODAY)).toHaveLength(1);

    // Snooze a few days into the future — drops off the queue entirely.
    const snoozed = due.map((d) => ({ ...d, snoozedUntil: "2026-06-14" }));
    expect(buildClientTasks(client, snoozed, TODAY)).toHaveLength(0);

    // On the snooze date it returns, still aged from the real due date.
    const back = buildClientTasks(client, snoozed, "2026-06-14");
    expect(back).toHaveLength(1);
    expect(back[0].daysOverdue).toBe(14); // 2026-05-31 → 2026-06-14
    expect(back[0].priority).toBe("high");
  });

  it("generates nothing for inactive clients", () => {
    const client = mkClient({ active: false });
    const due = computeClientDueDates(
      client,
      [mkEvent(client.id, { type: "call", eventDate: "2026-01-01" })],
      MODELS,
    );
    expect(buildClientTasks(client, due, TODAY)).toHaveLength(0);
  });

  it("rebuild keeps done history and regenerates open tasks", () => {
    const client = mkClient({ tier: "A" });
    const events = [mkEvent(client.id, { type: "call", eventDate: "2026-06-04" })]; // due 2026-07-04
    const due = computeClientDueDates(client, events, MODELS);

    const doneTask: Task = {
      id: "old-done",
      clientId: client.id,
      type: "call",
      dueDate: "2026-06-04",
      daysOverdue: 0,
      priority: "medium",
      status: "done",
      createdAt: "2026-06-04T00:00:00.000Z",
    };
    const staleOpen: Task = { ...doneTask, id: "stale-open", status: "open" };

    const rebuilt = rebuildAllTasks([client], due, [doneTask, staleOpen], "2026-07-06");
    const open = rebuilt.filter((t) => t.status === "open");

    expect(rebuilt.filter((t) => t.status === "done")).toHaveLength(1);
    expect(open).toHaveLength(1);
    expect(open[0].dueDate).toBe("2026-07-04");
    expect(open[0].daysOverdue).toBe(2); // re-aged by the nightly rebuild
    expect(open[0].priority).toBe("high");
  });

  it("settles only the matching open task", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        clientId: "c1",
        type: "call",
        dueDate: TODAY,
        daysOverdue: 0,
        priority: "medium",
        status: "open",
        createdAt: "",
      },
      {
        id: "t2",
        clientId: "c1",
        type: "meeting",
        dueDate: TODAY,
        daysOverdue: 0,
        priority: "medium",
        status: "open",
        createdAt: "",
      },
    ];
    const settled = settleTasks(tasks, "c1", "call");
    expect(settled.find((t) => t.id === "t1")!.status).toBe("done");
    expect(settled.find((t) => t.id === "t2")!.status).toBe("open");
  });

  it("buckets the dashboard and sorts overdue by severity", () => {
    const base = { clientId: "c", daysOverdue: 0, priority: "low" as const, status: "open" as const, createdAt: "" };
    const tasks: Task[] = [
      { ...base, id: "a", type: "call", dueDate: TODAY, priority: "medium" },
      { ...base, id: "b", type: "meeting", dueDate: TODAY, priority: "medium" },
      { ...base, id: "c", type: "call", dueDate: "2026-06-01", daysOverdue: 10, priority: "high" },
      { ...base, id: "d", type: "meeting", dueDate: "2026-05-22", daysOverdue: 20, priority: "high" },
      { ...base, id: "e", type: "call", dueDate: "2026-06-18" },
      { ...base, id: "f", type: "call", dueDate: TODAY, priority: "medium", status: "done" },
    ];

    const buckets = dashboardBuckets(tasks, TODAY);
    expect(buckets.callsToday.map((t) => t.id)).toEqual(["a"]);
    expect(buckets.meetingsToday.map((t) => t.id)).toEqual(["b"]);
    expect(buckets.overdue.map((t) => t.id)).toEqual(["d", "c"]); // worst first
    expect(buckets.upcoming.map((t) => t.id)).toEqual(["e"]);
  });
});

describe("service score", () => {
  it("derives annual requirements from the editable intervals", () => {
    expect(annualRequired(modelFor(MODELS, "A"))).toEqual({ meetings: 4, calls: 12, total: 16 });
    expect(annualRequired(modelFor(MODELS, "B"))).toEqual({ meetings: 1, calls: 4, total: 5 });
    expect(annualRequired(modelFor(MODELS, "C"))).toEqual({ meetings: 1, calls: 2, total: 3 });
  });

  it("scores a perfectly served Tier A client at 100", () => {
    const client = mkClient({ tier: "A", createdAt: "2024-01-01T00:00:00.000Z" });
    const events: ContactEvent[] = [];
    for (let i = 0; i < 12; i++) {
      events.push(mkEvent(client.id, { type: "call", eventDate: addDays(TODAY, -(i * 30 + 1)) }));
    }
    for (let i = 0; i < 4; i++) {
      events.push(mkEvent(client.id, { type: "meeting", eventDate: addDays(TODAY, -(i * 90 + 1)) }));
    }

    const s = clientScore(client, events, MODELS, TODAY);
    expect(s.requiredMeetings).toBe(4);
    expect(s.requiredCalls).toBe(12);
    expect(s.score).toBe(100);
  });

  it("surfaces a Tier A client getting Tier C treatment", () => {
    const client = mkClient({ tier: "A", createdAt: "2024-01-01T00:00:00.000Z" });
    const events = [
      mkEvent(client.id, { type: "meeting", eventDate: addDays(TODAY, -200) }),
      mkEvent(client.id, { type: "call", eventDate: addDays(TODAY, -150) }),
      mkEvent(client.id, { type: "call", eventDate: addDays(TODAY, -300) }),
    ];

    const s = clientScore(client, events, MODELS, TODAY);
    expect(s.score).toBe(Math.round((1 + 2) / 16 * 100)); // 19 — deep red
    expect(scoreColor(s.score)).toBe("red");
  });

  it("prorates requirements for recently added households", () => {
    const client = mkClient({ tier: "A", createdAt: "2026-05-12T00:00:00.000Z" }); // ~30 days
    const events = [
      mkEvent(client.id, { type: "meeting", eventDate: "2026-05-12" }),
      mkEvent(client.id, { type: "call", eventDate: "2026-06-05" }),
    ];

    const s = clientScore(client, events, MODELS, TODAY);
    expect(s.requiredMeetings).toBe(1);
    expect(s.requiredCalls).toBe(1);
    expect(s.score).toBe(100);
  });

  it("never rewards overshooting one channel to cover the other", () => {
    const client = mkClient({ tier: "B", createdAt: "2024-01-01T00:00:00.000Z" });
    // 8 calls (required 4) but no meeting at all.
    const events = Array.from({ length: 8 }, (_, i) =>
      mkEvent(client.id, { type: "call", eventDate: addDays(TODAY, -(i * 40 + 1)) }),
    );

    const s = clientScore(client, events, MODELS, TODAY);
    expect(s.score).toBe(80); // capped at 4/4 calls + 0/1 meetings = 4/5
  });

  it("rolls up weighted by required contacts and handles empty sets", () => {
    const a = mkClient({ tier: "A", createdAt: "2024-01-01T00:00:00.000Z" }); // neglected: 0/16
    const c = mkClient({ tier: "C", createdAt: "2024-01-01T00:00:00.000Z" }); // perfect: 3/3
    const events = [
      mkEvent(c.id, { type: "meeting", eventDate: addDays(TODAY, -100) }),
      mkEvent(c.id, { type: "call", eventDate: addDays(TODAY, -60) }),
      mkEvent(c.id, { type: "call", eventDate: addDays(TODAY, -240) }),
    ];

    const rolled = rollupScore([a, c], events, MODELS, TODAY)!;
    expect(rolled.score).toBe(Math.round(3 / 19 * 100)); // 16 — the A book drags it down
    expect(rollupScore([], events, MODELS, TODAY)).toBeNull();

    const inactiveOnly = mkClient({ active: false });
    expect(rollupScore([inactiveOnly], events, MODELS, TODAY)).toBeNull();
  });

  it("maps scores to green / yellow / red", () => {
    expect(scoreColor(95)).toBe("green");
    expect(scoreColor(90)).toBe("green");
    expect(scoreColor(89)).toBe("yellow");
    expect(scoreColor(70)).toBe("yellow");
    expect(scoreColor(69)).toBe("red");
  });

  it("computes monthly pace from the book composition", () => {
    const clients = [
      mkClient({ tier: "A" }),
      mkClient({ tier: "A" }),
      mkClient({ tier: "B" }),
      mkClient({ tier: "B" }),
      mkClient({ tier: "B" }),
      mkClient({ tier: "C" }),
      mkClient({ tier: "C", active: false }), // inactive books don't set pace
    ];
    const events = [
      mkEvent(clients[0].id, { type: "call", eventDate: "2026-06-02" }),
      mkEvent(clients[2].id, { type: "meeting", eventDate: "2026-06-05" }),
      mkEvent(clients[2].id, { type: "admin", eventDate: "2026-06-06" }), // admin never counts
      mkEvent(clients[3].id, { type: "call", eventDate: "2026-05-28" }), // last month
    ];

    const p = monthlyProgress(clients, MODELS, events, TODAY);
    expect(p.target).toBe(Math.round((16 * 2 + 5 * 3 + 3) / 12)); // 4
    expect(p.completed).toBe(2);
  });
});
