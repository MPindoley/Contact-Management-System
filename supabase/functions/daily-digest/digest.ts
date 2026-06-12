// Daily digest builder — pure logic, no Deno APIs, so it can be unit-tested
// from the app's test runner. index.ts (the edge function) feeds it data and
// hands the results to the email provider.
//
// Self-contained on purpose: `supabase functions deploy` bundles only this
// directory, so nothing here may import from src/.

export interface DigestUser {
  name: string;
  email: string | null;
  role: "advisor" | "assistant";
  advisor_key: "matt" | "advisor_b" | null;
}

export interface DigestClient {
  id: string;
  household_name: string;
  assigned_advisor: "matt" | "advisor_b" | "joint";
  tier: "A" | "B" | "C";
  active: boolean;
}

export interface DigestTask {
  client_id: string;
  type: "meeting" | "call";
  due_date: string; // YYYY-MM-DD
  status: "open" | "done";
}

export interface DigestEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface DigestOptions {
  users: DigestUser[];
  clients: DigestClient[];
  tasks: DigestTask[];
  today: string;
  /** Where "Open your dashboard" points, e.g. https://hub.vercel.app */
  appUrl: string;
  /** Send a "nothing due" note instead of skipping quiet days. */
  alwaysSend?: boolean;
}

const ADVISOR_LABELS: Record<string, string> = {
  matt: "Matt",
  advisor_b: "Beau",
  joint: "Joint",
};

const TIER_COLORS: Record<string, { bg: string; fg: string }> = {
  A: { bg: "#f5ecce", fg: "#6f481f" },
  B: { bg: "#e0f2fe", fg: "#075985" },
  C: { bg: "#f5f5f4", fg: "#57534e" },
};

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Item {
  client: DigestClient;
  type: "meeting" | "call";
  daysOverdue: number;
}

const TIER_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

export function buildDigests(options: DigestOptions): DigestEmail[] {
  const { users, clients, tasks, today, appUrl } = options;
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  // Everything actionable today: open, due on or before today, active client.
  const actionable: Item[] = tasks
    .filter((t) => t.status === "open" && t.due_date <= today)
    .flatMap((t) => {
      const client = clientsById.get(t.client_id);
      if (!client || !client.active) return [];
      return [{ client, type: t.type, daysOverdue: Math.max(0, diffDays(t.due_date, today)) }];
    });

  const emails: DigestEmail[] = [];

  for (const user of users) {
    if (!user.email) continue;

    const scope =
      user.role === "assistant" || !user.advisor_key
        ? null // firm-wide
        : new Set([user.advisor_key, "joint"]);

    const mine = actionable
      .filter((i) => !scope || scope.has(i.client.assigned_advisor))
      .sort(
        (a, b) =>
          b.daysOverdue - a.daysOverdue ||
          TIER_ORDER[a.client.tier] - TIER_ORDER[b.client.tier] ||
          a.client.household_name.localeCompare(b.client.household_name),
      );

    const overdue = mine.filter((i) => i.daysOverdue > 0);
    const dueToday = mine.filter((i) => i.daysOverdue === 0);

    if (mine.length === 0 && !options.alwaysSend) continue;

    const subject =
      mine.length === 0
        ? "All clear today — Relationship Hub"
        : `Your morning queue: ${overdue.length} overdue · ${dueToday.length} due today`;

    emails.push({
      to: user.email,
      subject,
      html: renderHtml(user, overdue, dueToday, today, appUrl, scope === null),
      text: renderText(user, overdue, dueToday, today, appUrl),
    });
  }

  return emails;
}

function itemLabel(item: Item): string {
  const what = item.type === "meeting" ? "Meeting" : "Call";
  const when =
    item.daysOverdue === 0
      ? "due today"
      : `${item.daysOverdue} ${item.daysOverdue === 1 ? "day" : "days"} overdue`;
  return `${what} · ${when}`;
}

function renderText(
  user: DigestUser,
  overdue: Item[],
  dueToday: Item[],
  today: string,
  appUrl: string,
): string {
  const lines: string[] = [`Good morning, ${user.name}.`, ""];
  if (overdue.length === 0 && dueToday.length === 0) {
    lines.push("Nothing due today. Enjoy the quiet.");
  }
  if (overdue.length > 0) {
    lines.push("OVERDUE");
    for (const i of overdue) {
      lines.push(
        `  [${i.client.tier}] ${i.client.household_name} — ${itemLabel(i)} (${ADVISOR_LABELS[i.client.assigned_advisor]})`,
      );
    }
    lines.push("");
  }
  if (dueToday.length > 0) {
    lines.push("DUE TODAY");
    for (const i of dueToday) {
      lines.push(
        `  [${i.client.tier}] ${i.client.household_name} — ${itemLabel(i)} (${ADVISOR_LABELS[i.client.assigned_advisor]})`,
      );
    }
    lines.push("");
  }
  lines.push(`Open your dashboard: ${appUrl}`, "", `Relationship Hub · ${today}`);
  return lines.join("\n");
}

function renderRows(items: Item[], appUrl: string): string {
  return items
    .map((i) => {
      const tier = TIER_COLORS[i.client.tier];
      const overdueStyle = i.daysOverdue > 0 ? "color:#9c3a10;font-weight:600;" : "color:#28543f;font-weight:600;";
      return `<tr>
  <td style="padding:10px 0;border-bottom:1px solid #eceae5;">
    <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;font-size:12px;font-weight:700;background:${tier.bg};color:${tier.fg};">${i.client.tier}</span>
  </td>
  <td style="padding:10px 12px;border-bottom:1px solid #eceae5;">
    <a href="${appUrl}/clients/${i.client.id}" style="color:#211d19;font-weight:600;text-decoration:none;">${escapeHtml(i.client.household_name)}</a>
    <span style="color:#8a847b;font-size:13px;"> · ${ADVISOR_LABELS[i.client.assigned_advisor]}</span>
  </td>
  <td align="right" style="padding:10px 0;border-bottom:1px solid #eceae5;font-size:13px;white-space:nowrap;${overdueStyle}">${itemLabel(i)}</td>
</tr>`;
    })
    .join("\n");
}

function renderHtml(
  user: DigestUser,
  overdue: Item[],
  dueToday: Item[],
  today: string,
  appUrl: string,
  firmWide: boolean,
): string {
  const total = overdue.length + dueToday.length;
  const summary =
    total === 0
      ? "Nothing is waiting on you. Enjoy the quiet."
      : `${total} ${total === 1 ? "household needs" : "households need"} attention${firmWide ? " across the firm" : ""} — ${overdue.length} overdue, ${dueToday.length} due today.`;

  const section = (title: string, color: string, items: Item[]) =>
    items.length === 0
      ? ""
      : `<p style="margin:24px 0 4px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:${color};">${title}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderRows(items, appUrl)}</table>`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f4ef;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="padding:0 4px 14px;">
    <span style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;color:#211d19;">Relationship Hub</span>
    <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a847b;"> &nbsp;·&nbsp; ${today}</span>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid #e7e4dd;border-radius:14px;padding:28px;font-family:Arial,Helvetica,sans-serif;">
    <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#211d19;">Good morning, ${escapeHtml(user.name)}.</h1>
    <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#5c554c;">${summary}</p>
    ${section("Overdue", "#9c3a10", overdue)}
    ${section("Due today", "#28543f", dueToday)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;"><tr>
      <td style="background:#28543f;border-radius:8px;">
        <a href="${appUrl}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Open your dashboard</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:14px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#a8a29a;">
    Your queue is rebuilt every morning at six. Log a touch and the next due date moves automatically.
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
