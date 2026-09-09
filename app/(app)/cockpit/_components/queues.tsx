import Link from "next/link";
import { BellRing, Inbox, type LucideIcon } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { DueReminder, PendingReply } from "../_lib/types";

/**
 * Files d'attente du Cockpit : relances dues et réponses à traiter.
 * Les deux listes viennent intégralement de Supabase (tables `reminders` et
 * `prospects`) — rien n'y est simulé.
 */
function ListCard({
  icon: Icon,
  title,
  count,
  empty,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="shadow-mist rounded-xl border"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div className="flex items-center gap-2 px-5 pb-3 pt-5">
        <Icon className="h-4 w-4" aria-hidden style={{ color: "var(--primary)" }} />
        <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--text)" }}>
          {title}
        </h2>
        {count > 0 && (
          <span
            className="font-data ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary-ink"
          >
            {count}
          </span>
        )}
      </div>

      {count === 0 ? (
        <p className="px-5 pb-5 text-[13px]" style={{ color: "var(--faint)" }}>
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col">{children}</ul>
      )}
    </section>
  );
}

function Row({
  href,
  primary,
  secondary,
  accent,
}: {
  href: string;
  primary: string;
  secondary: string;
  accent?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-baseline justify-between gap-3 border-t px-5 py-3 motion-safe:transition-colors"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <span className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
          {primary}
        </span>
        <span
          className="shrink-0 text-[12px]"
          style={{ color: accent ?? "var(--muted)" }}
        >
          {secondary}
        </span>
      </Link>
    </li>
  );
}

export function DueRemindersCard({ reminders }: { reminders: DueReminder[] }) {
  return (
    <ListCard
      icon={BellRing}
      title="Relances dues"
      count={reminders.length}
      empty="Aucune relance à faire aujourd'hui."
    >
      {reminders.map((reminder) => {
        const late = -reminder.daysLeft;
        return (
          <Row
            key={reminder.id}
            href={`/suivi/${reminder.prospectId}`}
            primary={reminder.companyName}
            secondary={late > 0 ? `en retard de ${late} j` : "aujourd'hui"}
            accent={late > 0 ? "var(--warn)" : undefined}
          />
        );
      })}
    </ListCard>
  );
}

export function RepliesCard({ replies }: { replies: PendingReply[] }) {
  return (
    <ListCard
      icon={Inbox}
      title="Réponses à traiter"
      count={replies.length}
      empty="Aucune réponse en attente."
    >
      {replies.map((reply) => (
        <Row
          key={reply.id}
          href={`/suivi/${reply.id}`}
          primary={reply.companyName}
          secondary={formatDate(reply.updatedAt)}
        />
      ))}
    </ListCard>
  );
}
