import { Link as LinkIcon } from "lucide-react";
import { Fragment } from "react";

import { DetailSection } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/date";
import { KIND_LABEL, type ReleaseDeployment } from "@/lib/deployment";

/**
 * The card under a release's pointers: every deployment of the release, newest
 * first. A row names where it went (the project's primary origins, or preview
 * URLs), whether any origin still serves it, each origin as a link, and when
 * it was deployed. A line in place of the rows says when the release has
 * none, or when the server does not list deployments yet.
 */
export function ReleaseDeployments({
  deployments,
}: {
  /** `undefined` while the server does not serve deployments. */
  deployments: ReleaseDeployment[] | undefined;
}) {
  return (
    <DetailSection title="Deployment of this release" titleStyle="heading">
      {deployments === undefined ? (
        <p className="text-sm text-muted-foreground">This server does not list deployments yet.</p>
      ) : deployments.length === 0 ? (
        <p className="text-sm text-muted-foreground">This release has not been deployed.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {deployments.map((entry, index) => (
            <Fragment key={entry.deployment.id}>
              {index > 0 && <Separator />}
              <DeploymentRow entry={entry} />
            </Fragment>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function DeploymentRow({ entry }: { entry: ReleaseDeployment }) {
  const { deployment, kind, status } = entry;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-6">
      {/* 216px, less the gap: the origins start on the column the pointer
          groups' lists use. */}
      <div className="flex shrink-0 items-center gap-2 sm:w-48">
        <span className="text-sm leading-5 text-muted-foreground">{KIND_LABEL[kind]}</span>
        {status === "live" ? (
          <StatusBadge status="active" />
        ) : (
          <Badge variant="secondary">Superseded</Badge>
        )}
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {deployment.targets.map((target) => (
          <li key={target.origin} className="flex min-w-0">
            {/* The origin opens what it serves. Foreground, not the link
                colour: the design draws it as text with a glyph, flush with
                the column. `px-0!`: the size's `has-[>svg]:px-1.5` is a
                variant and out-specifies a plain `px-0`. */}
            <Button
              asChild
              variant="link"
              size="xs"
              className="h-6 max-w-full px-0! text-sm font-normal text-foreground"
            >
              <a href={target.origin} target="_blank" rel="noreferrer">
                <LinkIcon aria-hidden className="text-muted-foreground" />
                <span className="truncate">{target.origin}</span>
              </a>
            </Button>
          </li>
        ))}
      </ul>
      <time
        dateTime={deployment.deployed_at}
        className="shrink-0 text-sm leading-5 font-medium whitespace-nowrap text-muted-foreground"
      >
        {formatDateTime(deployment.deployed_at)}
      </time>
    </div>
  );
}
