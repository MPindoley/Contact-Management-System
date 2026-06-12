import { describe, expect, it } from "vitest";
import { buildDigests, type DigestClient, type DigestTask, type DigestUser } from "./digest";

const TODAY = "2026-06-12";
const APP = "https://hub.example.com";

const USERS: DigestUser[] = [
  { name: "Matt", email: "matt@firm.com", role: "advisor", advisor_key: "matt" },
  { name: "Beau", email: "beau@firm.com", role: "advisor", advisor_key: "advisor_b" },
  { name: "Assistant", email: "assistant@firm.com", role: "assistant", advisor_key: null },
  { name: "Ghost", email: null, role: "advisor", advisor_key: "matt" },
];

const CLIENTS: DigestClient[] = [
  { id: "c1", household_name: "Whitfield, Daniel & Mara", assigned_advisor: "matt", tier: "A", active: true },
  { id: "c2", household_name: "Okafor, Samuel & Adaeze", assigned_advisor: "advisor_b", tier: "A", active: true },
  { id: "c3", household_name: "Hale-Brennan Household", assigned_advisor: "joint", tier: "B", active: true },
  { id: "c4", household_name: "Gone Household", assigned_advisor: "matt", tier: "C", active: false },
];

const TASKS: DigestTask[] = [
  { client_id: "c1", type: "call", due_date: TODAY, status: "open" },
  { client_id: "c2", type: "meeting", due_date: "2026-05-31", status: "open" }, // 12 days overdue
  { client_id: "c3", type: "call", due_date: "2026-06-10", status: "open" }, // 2 days overdue, joint
  { client_id: "c4", type: "call", due_date: "2026-06-01", status: "open" }, // inactive → excluded
  { client_id: "c1", type: "meeting", due_date: "2026-07-01", status: "open" }, // future → excluded
  { client_id: "c2", type: "call", due_date: TODAY, status: "done" }, // done → excluded
];

function build(overrides: Partial<Parameters<typeof buildDigests>[0]> = {}) {
  return buildDigests({ users: USERS, clients: CLIENTS, tasks: TASKS, today: TODAY, appUrl: APP, ...overrides });
}

describe("buildDigests", () => {
  it("scopes advisors to their book + joint, assistant to the firm", () => {
    const emails = build();
    const matt = emails.find((e) => e.to === "matt@firm.com")!;
    const beau = emails.find((e) => e.to === "beau@firm.com")!;
    const assistant = emails.find((e) => e.to === "assistant@firm.com")!;

    expect(matt.text).toContain("Whitfield");
    expect(matt.text).toContain("Hale-Brennan"); // joint
    expect(matt.text).not.toContain("Okafor"); // Beau's client

    expect(beau.text).toContain("Okafor");
    expect(beau.text).toContain("Hale-Brennan");
    expect(beau.text).not.toContain("Whitfield");

    expect(assistant.text).toContain("Whitfield");
    expect(assistant.text).toContain("Okafor");
    expect(assistant.subject).toContain("2 overdue · 1 due today");
  });

  it("counts overdue vs due-today in the subject and sorts worst-first", () => {
    const beau = build().find((e) => e.to === "beau@firm.com")!;
    expect(beau.subject).toBe("Your morning queue: 2 overdue · 0 due today");
    // 12-days-overdue Okafor before 2-days-overdue joint household
    expect(beau.text.indexOf("Okafor")).toBeLessThan(beau.text.indexOf("Hale-Brennan"));
    expect(beau.text).toContain("12 days overdue");
  });

  it("excludes inactive clients, future tasks, done tasks, and users without email", () => {
    const emails = build();
    expect(emails).toHaveLength(3);
    for (const e of emails) {
      expect(e.text).not.toContain("Gone Household");
    }
  });

  it("skips quiet days unless alwaysSend", () => {
    const quiet = build({ tasks: [] });
    expect(quiet).toHaveLength(0);

    const always = build({ tasks: [], alwaysSend: true });
    expect(always).toHaveLength(3);
    expect(always[0].subject).toContain("All clear");
  });

  it("renders branded HTML with deep links and the advisor's display name", () => {
    const matt = build().find((e) => e.to === "matt@firm.com")!;
    expect(matt.html).toContain(`${APP}/clients/c1`);
    expect(matt.html).toContain("Good morning, Matt.");
    expect(matt.html).toContain("Joint"); // shared household labeled as such
    expect(matt.html).toContain("Open your dashboard");
    const beau = build().find((e) => e.to === "beau@firm.com")!;
    expect(beau.html).toContain("Beau"); // renamed advisor label in play
    // No unescaped ampersands from household names
    expect(matt.html).toContain("Whitfield, Daniel &amp; Mara");
  });
});
