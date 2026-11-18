// The due-date rules live twice: computeClientDueDates() in TypeScript (the
// demo adapter runs it) and fn_recompute_client_due_dates() in Postgres (the
// live app runs it). This drives both with the same random history (inserts,
// deletes, re-dated and re-typed touches, snoozes, tier changes and Tiers-screen
// edits) and fails on the first stored row where they disagree.
//
// Run through ./supabase/tests/parity_test.sh, which builds the database.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { callCover, computeClientDueDates } from "../../src/engine/serviceEngine";
import { addDays } from "../../src/lib/dates";
import type { Client, ContactEvent, ContactType, DueDate, ServiceModel, Tier } from "../../src/types";

const DB = process.env.PARITY_DB;
const SEEDS = (process.env.PARITY_SEEDS ?? "1,2,3,4").split(",").map(Number);
const ROUNDS = Number(process.env.PARITY_ROUNDS ?? 15);
const OPS_PER_ROUND = 25;
// Few households, many operations each: the interesting cases need several
// touches in a row on the same household.
const CLIENTS = 12;
const BASE = "2026-11-18";
const TIERS: Tier[] = ["S", "A", "B", "C"];

function psql(sql: string): string {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-qAt", "-d", DB!], {
    input: sql,
    encoding: "utf8",
  });
}

function rng(seed: number) {
  // mulberry32: small, seedable, and exact in 32-bit integer math.
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (a: number, b: number) => a + Math.floor(next() * (b - a + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join("");
  const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
  return { next, int, pick, uuid };
}

const row = (r: Pick<DueDate, "clientId" | "type" | "dueDate" | "computedFromEventId" | "snoozedUntil">) =>
  [r.clientId, r.type, r.dueDate, r.computedFromEventId ?? "-", r.snoozedUntil ?? "-"].join("|");

describe.skipIf(!DB)("due dates: TypeScript and Postgres agree", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const r = rng(seed);
    // Alternate the database's time zone: Supabase runs in UTC, but the rule
    // must not depend on it (created_at is read back with an offset).
    psql(`alter database ${DB} set timezone = '${seed % 2 ? "America/Chicago" : "UTC"}';`);
    psql("delete from clients; update service_models set meetings_cover_calls = 2;");

    const models: ServiceModel[] = psql(
      "select tier, meeting_interval_days, call_interval_days, coalesce(meetings_cover_calls::text, '') from service_models order by tier",
    )
      .trim()
      .split("\n")
      .map((l) => {
        const [tier, mi, ci, n] = l.split("|");
        return {
          tier: tier as Tier,
          meetingIntervalDays: Number(mi),
          callIntervalDays: Number(ci),
          minRevenue: null,
          description: null,
          meetingsCoverCalls: n === "" ? null : Number(n),
        };
      });

    const clients: (Client & { dates: string[] })[] = [];
    let sql = "";
    for (let i = 0; i < CLIENTS; i++) {
      const id = r.uuid();
      const tier = r.pick(TIERS);
      // A few dates per household, so same-day doubles happen often, plus
      // dates a cover's length minus a call interval apart, so a cover's end
      // and a call's due date land on the same day (the tie) often too.
      const anchor = addDays(BASE, r.int(-700, -100));
      const dates = [
        anchor,
        ...Array.from({ length: r.int(1, 3) }, () => addDays(anchor, r.pick([185, 275, 335, 358, 365, 0]))),
        ...Array.from({ length: r.int(1, 3) }, () => addDays(BASE, r.int(-800, 20))),
      ];
      clients.push({ id, tier, active: true, dates } as unknown as Client & { dates: string[] });
      sql += `insert into clients (id, household_name, tier) values ('${id}', 'H${i}', '${tier}');\n`;
    }
    psql(sql);

    let events: ContactEvent[] = [];
    let rows: DueDate[] = [];
    const recompute = (clientId: string) => {
      const client = clients.find((c) => c.id === clientId)!;
      const previous = rows.filter((d) => d.clientId === clientId);
      const fresh = computeClientDueDates(client, events, models, `${BASE}T12:00:00.000Z`, previous);
      rows = [...rows.filter((d) => d.clientId !== clientId), ...fresh];
    };

    let ops = 0;
    let coveredSeen = 0;
    let tiesSeen = 0;
    for (let round = 0; round < ROUNDS; round++) {
      for (let k = 0; k < OPS_PER_ROUND; k++) {
        ops++;
        const c = r.pick(clients);
        const mine = events.filter((e) => e.clientId === c.id);
        const roll = r.next();
        const insert = (type: ContactType, date: string, logged: string) => {
          const id = r.uuid();
          const time = `${String(r.int(0, 23)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}:00${r.pick(["", ".5", ".25", ".123456"])}`;
          const createdAt = psql(
            `insert into contact_events (id, client_id, advisor, type, event_date, created_at)
             values ('${id}', '${c.id}', 'matt', '${type}', '${date}', '${logged} ${time}+00')
             returning to_json(created_at) #>> '{}';`,
          ).trim();
          events.push({ id, clientId: c.id, advisor: "matt", type, eventDate: date, createdAt } as ContactEvent);
          recompute(c.id);
        };
        if (roll < 0.4 || mine.length === 0) {
          const type: ContactType = r.pick(["meeting", "meeting", "call", "call", "voicemail", "admin"] as const);
          const date = r.pick(c.dates);
          // Usually logged within a day of when it happened (so the
          // "dated after it was logged" check sits on its UTC-midnight edge),
          // otherwise anywhere from a month before (a future-dated typo) to a
          // year after, at an arbitrary time of day.
          insert(type, date, addDays(date, r.next() < 0.5 ? r.pick([-1, 0, 0, 1]) : r.int(-30, 400)));
        } else if (roll < 0.47) {
          // Two recent meetings and a call that comes due around the cover's
          // end: before it (covered), on the day (the tie, which goes to the
          // call) or after it (the call wins).
          const ci = models.find((m) => m.tier === c.tier)!.callIntervalDays;
          const latest = [...events.filter((e) => e.clientId === c.id).map((e) => e.eventDate), addDays(BASE, -400)].sort().pop()!;
          const first = addDays(latest, r.int(1, 30));
          const second = addDays(first, r.int(1, 200));
          const call = addDays(first, 365 - ci + r.pick([-90, -1, 0, 0, 1]));
          insert("meeting", first, addDays(second, 1));
          insert("meeting", second, addDays(second, 1));
          insert("call", call, addDays(call, r.int(0, 3)));
        } else if (roll < 0.57) {
          const e = r.pick(mine);
          psql(`delete from contact_events where id = '${e.id}';`);
          events = events.filter((x) => x.id !== e.id);
          recompute(c.id);
        } else if (roll < 0.67) {
          const e = r.pick(mine);
          const date = r.pick(c.dates);
          psql(`update contact_events set event_date = '${date}' where id = '${e.id}';`);
          e.eventDate = date;
          recompute(c.id);
        } else if (roll < 0.73) {
          const e = r.pick(mine);
          const type: ContactType = r.pick(["meeting", "call", "voicemail"] as const);
          psql(`update contact_events set type = '${type}' where id = '${e.id}';`);
          e.type = type;
          recompute(c.id);
        } else if (roll < 0.78) {
          // An edit that changes nothing the engine reads still recomputes.
          const e = r.pick(mine);
          psql(`update contact_events set notes = 'edit ${ops}' where id = '${e.id}';`);
          recompute(c.id);
        } else if (roll < 0.9) {
          const type = r.pick(["meeting", "call", "call"] as const);
          const until = addDays(BASE, r.int(-5, 40));
          psql(`select snooze_touch('${c.id}', '${type}', '${until}');`);
          const d = rows.find((x) => x.clientId === c.id && x.type === type);
          if (d) d.snoozedUntil = until;
        } else if (roll < 0.96) {
          const tier = r.pick(TIERS);
          psql(`update clients set tier = '${tier}' where id = '${c.id}';`);
          c.tier = tier;
          recompute(c.id);
        } else {
          const m = r.pick(models);
          const n = r.pick([null, 2, 2, 2, 3, 4] as const);
          const mi = r.pick([30, 90, 180, 365]);
          const ci = r.pick([7, 30, 90, 180]);
          psql(
            `update service_models set meetings_cover_calls = ${n ?? "null"}, meeting_interval_days = ${mi}, call_interval_days = ${ci} where tier = '${m.tier}';`,
          );
          Object.assign(m, { meetingsCoverCalls: n, meetingIntervalDays: mi, callIntervalDays: ci });
          for (const cc of clients) recompute(cc.id);
        }
      }

      const fromSql = psql(
        `select client_id, type, due_date, coalesce(computed_from_event_id::text, '-'), coalesce(snoozed_until::text, '-')
           from due_dates;`,
      )
        .trim()
        .split("\n")
        .filter(Boolean)
        .sort()
        // Known, older difference: deleting a household's only touch leaves
        // the database a sourceless row (the foreign key nulls its source and
        // it then reads as a first-outreach placeholder). The engine never
        // sees placeholders, so leave those out.
        .filter((l) => {
          const [clientId, , , source] = l.split("|");
          return source !== "-" || events.some((e) => e.clientId === clientId && (e.type === "meeting" || e.type === "call"));
        });
      const fromTs = rows.map(row).sort();
      expect(fromSql, `seed ${seed}, round ${round}, after ${ops} operations`).toEqual(fromTs);
      coveredSeen += rows.filter(
        (d) => d.type === "call" && events.find((e) => e.id === d.computedFromEventId)?.type === "meeting",
      ).length;
      for (const c of clients) {
        const m = models.find((x) => x.tier === c.tier)!;
        const cover = callCover(c.id, events, m);
        const calls = events.filter((e) => e.clientId === c.id && e.type === "call").map((e) => e.eventDate).sort();
        if (cover && calls.length && cover.endsOn === addDays(calls[calls.length - 1], m.callIntervalDays)) tiesSeen++;
      }
    }

    // The rule has to have actually been exercised.
    console.log(`seed ${seed}: ${ops} operations, ${coveredSeen} covered calls and ${tiesSeen} exact ties checked`);
    expect(coveredSeen, "some calls were covered by meetings along the way").toBeGreaterThan(0);
  });
});
