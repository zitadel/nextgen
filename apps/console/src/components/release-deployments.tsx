import { Fragment } from "react";

import { DeploymentStatusBadge } from "@/components/deployment-status-badge";
import { DetailRow, DetailSection } from "@/components/detail-page";
import { TargetLink } from "@/components/origin-link";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/date";
import { type Deployment, KIND_LABEL, targetName } from "@/lib/deployment";

/**
 * The card under a release's pointers: every deployment of the release, newest
 * first. A row names where it went (the project's primary origins, or preview
 * URLs), whether any origin still serves it, each origin as a link, and when
 * it was deployed. A line in place of the rows says when the release has
 * none.
 */
export function ReleaseDeployments({ deployments }: { deployments: Deployment[] }) {
  return (
    <DetailSection title="Deployment of this release">
      {deployments.length === 0 ? (
        <p className="text-sm text-muted-foreground">This release has not been deployed.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {deployments.map((deployment, index) => (
            <Fragment key={deployment.id}>
              {index > 0 && <Separator />}
              <DeploymentRow deployment={deployment} />
            </Fragment>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  return (
    <DetailRow
      label={
        <>
          <span>{KIND_LABEL[deployment.kind]}</span>
          <DeploymentStatusBadge status={deployment.status} />
        </>
      }
    >
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {deployment.targets.map((target) => (
          <li key={targetName(target)} className="flex min-w-0">
            {/* Foreground, not the link colour: the design draws it as text
                with a glyph, flush with the column. */}
            <TargetLink
              target={target}
              className="text-sm font-normal text-foreground"
              iconClassName="text-muted-foreground"
            />
          </li>
        ))}
      </ul>
      <time
        dateTime={deployment.deployed_at}
        className="shrink-0 text-sm leading-5 font-medium whitespace-nowrap text-muted-foreground"
      >
        {formatDateTime(deployment.deployed_at)}
      </time>
    </DetailRow>
  );
}
