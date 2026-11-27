import { DeploymentStatusBadge } from "./deployment-status-badge";
import { DETAIL_VALUE_EMPTY, DetailRow, DetailRows, DetailSection } from "@/components/detail-page";
import { OriginLink } from "@/components/origin-link";
import { formatDateTime } from "@/lib/date";
import { type Deployment, KIND_LABEL } from "@/features/deployments/deployment";

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
        <p className={DETAIL_VALUE_EMPTY}>This release has not been deployed.</p>
      ) : (
        <DetailRows>
          {deployments.map((deployment) => (
            <DeploymentRow key={deployment.id} deployment={deployment} />
          ))}
        </DetailRows>
      )}
    </DetailSection>
  );
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  return (
    <DetailRow
      align="control"
      label={
        <>
          <span>{KIND_LABEL[deployment.kind]}</span>
          <DeploymentStatusBadge status={deployment.status} />
        </>
      }
    >
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {deployment.targets.map((target) => (
          <li key={target.origin} className="flex min-w-0">
            {/* Foreground, not the link colour: the design draws it as text
                with a glyph, flush with the column. */}
            <OriginLink
              origin={target.origin}
              className="text-sm font-normal text-foreground"
              iconClassName="text-muted-foreground"
            />
          </li>
        ))}
      </ul>
      <time
        dateTime={deployment.deployed_at}
        // A 24px line, the origin link's, so the date sits level with it.
        className="shrink-0 text-sm leading-6 font-medium whitespace-nowrap text-muted-foreground"
      >
        {formatDateTime(deployment.deployed_at)}
      </time>
    </DetailRow>
  );
}
