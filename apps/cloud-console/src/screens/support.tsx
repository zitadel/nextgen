import { LifeBuoy } from "lucide-react";
import { useId, useState } from "react";

import type { NewTicket, Ticket, TicketList } from "@zitadel/cloud-functions/contract";
import type { AddonScreenProps } from "@zitadel/console/addon";
import {
  Button,
  DETAIL_CARD,
  DETAIL_TITLE,
  Field,
  FieldContent,
  FieldLabel,
  FormError,
  Input,
  PAGE_TITLE_ROW,
  PANEL_BODY_CELL,
  PANEL_HEAD_CELL,
  Page,
  SettingsCard,
  SettingsColumn,
  SettingsSection,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@zitadel/console/addon/ui";

import { type Live, cloudGet, cloudSend, whenLive } from "../cloud-api";
import { screen } from "./screen";

/**
 * Settings → Support: write to us, and the requests already written (root ADR
 * 083 §7). Each is a HubSpot ticket on the person's contact and their team's
 * company; replies arrive by email, which HubSpot sends. While the functions
 * file no tickets (`cloud.not_live`), it points to Zitadel's GitHub issues.
 */
export const supportScreen = screen({
  path: "/settings/support",
  nav: { label: "Support", view: "settings", order: 3, icon: LifeBuoy },
  load: () => whenLive(cloudGet<TicketList>("/support/tickets")),
  Screen: SupportScreen,
});

/** Where help is while tickets are not live: public, so the screen says so. */
const ISSUES_URL = "https://github.com/zitadel/nextgen/issues";

const STATUS: Record<Ticket["status"], string> = {
  new: "Received",
  waiting_on_us: "With us",
  waiting_on_you: "Waiting for you",
  closed: "Closed",
};

function SupportScreen({ data, reload }: AddonScreenProps<Live<TicketList>>) {
  return (
    <Page>
      <SettingsColumn>
        <div className={PAGE_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>Support</h1>
        </div>
        {data.live ? <Tickets tickets={data.data} reload={reload} /> : <SupportPreview />}
      </SettingsColumn>
    </Page>
  );
}

/** Before HubSpot is live: where to ask today. */
function SupportPreview() {
  return (
    <SettingsSection
      title="Get help"
      description="Ask a question or report a problem in Zitadel's GitHub issues."
    >
      <SettingsCard>
        <p className="text-sm text-muted-foreground">
          Issues are public: leave out anything private, such as keys, secrets or your users&apos;
          data.
        </p>
        <div className="flex justify-end">
          <Button asChild>
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              Open GitHub issues
            </a>
          </Button>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

/** With HubSpot live: the form, and the person's own requests. */
function Tickets({ tickets: data, reload }: { tickets: TicketList; reload: () => Promise<void> }) {
  return (
    <>
      <SettingsSection
        title="Write to us"
        description="We answer by email. Say which project it concerns, and what you expected to happen."
      >
        <SettingsCard>
          <TicketForm onSent={reload} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Your requests" description="What you wrote to us, newest first.">
        <Card className={DETAIL_CARD}>
          <CardContent className="px-6 py-2">
            {data.tickets.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">You have not written to us yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={PANEL_HEAD_CELL}>Subject</TableHead>
                    <TableHead className={PANEL_HEAD_CELL}>Status</TableHead>
                    <TableHead className={PANEL_HEAD_CELL}>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell className={PANEL_BODY_CELL}>{ticket.subject}</TableCell>
                      <TableCell className={PANEL_BODY_CELL}>{STATUS[ticket.status]}</TableCell>
                      <TableCell className={PANEL_BODY_CELL}>
                        {new Date(ticket.updated_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </SettingsSection>
    </>
  );
}

function TicketForm({ onSent }: { onSent: () => Promise<void> }) {
  const subjectId = useId();
  const bodyId = useId();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  const send = async () => {
    setError(undefined);
    setSending(true);
    try {
      const ticket: NewTicket = {
        subject: subject.trim(),
        body: body.trim(),
        severity: "question",
      };
      await cloudSend("POST", "/support/tickets", ticket);
      setSubject("");
      setBody("");
      toast.success("Sent. We answer by email.");
      await onSent();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your request could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Field>
        <FieldContent>
          <FieldLabel htmlFor={subjectId}>Subject</FieldLabel>
        </FieldContent>
        <Input
          id={subjectId}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </Field>
      <Field>
        <FieldContent>
          <FieldLabel htmlFor={bodyId}>Message</FieldLabel>
        </FieldContent>
        <Textarea
          id={bodyId}
          rows={5}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <FormError message={error} />
        <div className="flex justify-end">
          <Button
            disabled={sending || subject.trim() === "" || body.trim() === ""}
            onClick={() => void send()}
          >
            Send
          </Button>
        </div>
      </div>
    </>
  );
}
