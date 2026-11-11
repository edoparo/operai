/**
 * The text, link and channel of every activities notification, English and Italian, per host
 * (specs/028 US-6, AC-6.1..6.4; ADR-0065). notify-api has no per-user language, so the
 * service sends BOTH: `title`/`body` in English and `it: { title, body }`, and notify-ui /
 * the shell's ToastHost pick one from `<html lang>`.
 *
 * - CRM: the English copy and the hrefs are exactly what crm-api sent before the activities
 *   moved here (specs/019, E5/US-8/specs/017 US-6); only `it` is new.
 * - Projects: the same sentences with "Project: <name>." as the context, opening the project
 *   (`/projects/<id>`).
 * - Pure: no env, no I/O. A function takes the activity's own fields, the host's labels and
 *   the actor's display name, nothing else, so no other content can get into a notification.
 *
 * Adding a kind means adding it to `NOTIFY_KINDS` AND to `KINDS` below: the `Record` type
 * makes a missing one a compile error, and the parity test a failing test.
 */

export const NOTIFY_KINDS = ["task_assigned", "activity_participant_added", "task_unblocked"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export type NotifySeverity = "info" | "success" | "warning";

/** notify-api's limits on `POST /system/notifications`. */
export const MAX_TITLE = 200;
export const MAX_BODY = 2000;
/** User-entered words are clipped inside the surrounding sentence (crm-api's bounds). */
export const MAX_NAME = 100;

export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** `YYYY-MM-DD` (or a Date) as `dd.mm.yyyy`, the suite's display format. */
export function formatDueDate(value: string | Date): string {
  const iso = typeof value === "string" ? value : value.toISOString();
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** Which host the activity belongs to, with the labels its copy shows. */
export type NotifyTarget =
  | {
      readonly host: "crm";
      readonly company: { readonly id: string; readonly name: string };
      readonly deal: { readonly id: string; readonly title: string } | null;
    }
  | { readonly host: "projects"; readonly project: { readonly id: string; readonly name: string } };

export interface NotifyActivity {
  readonly id: string;
  /** `note | call | meeting | email | task`; a project only has tasks. */
  readonly type: string;
  readonly subject: string;
  readonly dueDate: string | Date | null;
}

export interface NotifyContext {
  readonly activity: NotifyActivity;
  readonly target: NotifyTarget;
}

type Lang = "en" | "it";

interface Words {
  readonly title: string;
  readonly body: string;
}

/** What a kind says, per language: `title(subject)`, `body(actor, activity, context)`. */
interface KindCopy {
  readonly title: (subject: string) => string;
  readonly body: (actor: string, activity: NotifyActivity, context: string) => string;
}

const ACTIVITY_NOUN: Record<Lang, Record<string, string>> = {
  en: { note: "note", call: "call", meeting: "meeting", email: "email", task: "task" },
  it: { note: "nota", call: "chiamata", meeting: "riunione", email: "email", task: "attività" },
};
const noun = (lang: Lang, type: string): string => ACTIVITY_NOUN[lang][type] ?? ACTIVITY_NOUN[lang]["task"]!;

const due = (lang: Lang, a: NotifyActivity): string => {
  if (!a.dueDate) return "";
  return lang === "en" ? `, due ${formatDueDate(a.dueDate)}` : `, da completare entro ${formatDueDate(a.dueDate)}`;
};

const KINDS: Record<Lang, Record<NotifyKind, KindCopy>> = {
  en: {
    task_assigned: {
      title: (s) => `New task: ${s}`,
      body: (actor, a, ctx) => `${actor} assigned you a task${due("en", a)}. ${ctx}.`,
    },
    activity_participant_added: {
      title: (s) => `You take part in: ${s}`,
      body: (actor, a, ctx) => `${actor} added you to this ${noun("en", a.type)}. ${ctx}.`,
    },
    task_unblocked: {
      title: (s) => `You can go ahead: ${s}`,
      body: (actor, _a, ctx) => `${actor} completed the last task this one was waiting on. ${ctx}.`,
    },
  },
  it: {
    task_assigned: {
      title: (s) => `Nuova attività: ${s}`,
      body: (actor, a, ctx) => `${actor} ti ha assegnato un'attività${due("it", a)}. ${ctx}.`,
    },
    activity_participant_added: {
      title: (s) => `Partecipi a: ${s}`,
      body: (actor, a, ctx) => `${actor} ti ha aggiunto a questa ${noun("it", a.type)}. ${ctx}.`,
    },
    task_unblocked: {
      title: (s) => `Puoi procedere: ${s}`,
      body: (actor, _a, ctx) => `${actor} ha completato l'ultima attività da cui questa dipendeva. ${ctx}.`,
    },
  },
};

const CONTEXT_LABEL: Record<Lang, { deal: string; company: string; project: string }> = {
  en: { deal: "Deal", company: "Company", project: "Project" },
  it: { deal: "Opportunità", company: "Azienda", project: "Progetto" },
};

function contextOf(lang: Lang, target: NotifyTarget): string {
  const label = CONTEXT_LABEL[lang];
  if (target.host === "projects") return `${label.project}: ${clip(target.project.name, MAX_NAME)}`;
  return target.deal ? `${label.deal}: ${clip(target.deal.title, MAX_NAME)}` : `${label.company}: ${clip(target.company.name, MAX_NAME)}`;
}

/** Whether the recipient is also emailed (ADR-0056: `email: true`, needs `emails.send`). */
const EMAIL: Record<NotifyKind, boolean> = {
  task_assigned: true,
  activity_participant_added: false,
  task_unblocked: true,
};

function hrefOf(kind: NotifyKind, { activity, target }: NotifyContext): string {
  if (target.host === "projects") return `/projects/${target.project.id}`;
  // CRM, as crm-api linked them: a task goes to the tasks list; a participant on anything else
  // goes to the deal, else the company.
  if (kind !== "activity_participant_added" || activity.type === "task") return "/crm/tasks";
  return target.deal ? `/crm/deals/${target.deal.id}` : `/crm/companies/${target.company.id}`;
}

export interface RenderedNotification {
  readonly originApp: "crm" | "projects";
  readonly severity: NotifySeverity;
  readonly email: boolean;
  readonly href: string;
  readonly title: string;
  readonly body: string;
  readonly it: Words;
}

/**
 * The subject, the actor's name and the host's labels are user-entered, so each is clipped
 * inside its sentence first (the fixed words survive), then the whole is clipped to
 * notify-api's limits.
 */
export function renderNotification(kind: NotifyKind, ctx: NotifyContext, actorName: string): RenderedNotification {
  const subject = clip(ctx.activity.subject, MAX_NAME);
  const actor = clip(actorName, MAX_NAME);
  const render = (lang: Lang): Words => {
    const copy = KINDS[lang][kind];
    return {
      title: clip(copy.title(subject), MAX_TITLE),
      body: clip(copy.body(actor, ctx.activity, contextOf(lang, ctx.target)), MAX_BODY),
    };
  };
  return {
    originApp: ctx.target.host,
    severity: "info",
    email: EMAIL[kind],
    href: hrefOf(kind, ctx),
    ...render("en"),
    it: render("it"),
  };
}
