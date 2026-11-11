import { Link } from "@tanstack/react-router";

import { CliCommand, CLI_DEPLOY } from "@/components/cli-hint";
import { CARD_ACTION_BUTTON, DetailRow, DetailSection } from "@/components/detail-page";
import { IdText } from "@/components/id-text";
import { OriginLink } from "@/components/origin-link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DeploymentStatusBadge } from "@/features/deployments/components/deployment-status-badge";
import type { Deployment } from "@/features/deployments/deployment";
import { formatRecent } from "@/lib/date";

import type { CardRead } from "@/features/overview/api";

/**
 * What the project's primary origins serve now, as Vercel's Overview leads
 * with its production deployment: the release, when it went live and why, and
 * the origins serving it, each opening what it serves. The card's action is
 * Deployments, the history this is the head of.
 */
export function ProductionCard({ live }: { live: CardRead<Deployment | undefined> }) {
  return (
    <DetailSection
      title="Production"
      titleId="overview-production"
      role="region"
      aria-labelledby="overview-production"
      action={
        <Button asChild variant="secondary" size="sm" className={CARD_ACTION_BUTTON}>
          <Link to="/deployments">Deployments</Link>
        </Button>
      }
    >
      {live.error !== undefined ? (
        <p className="text-sm leading-5 text-muted-foreground">{live.error}</p>
      ) : live.value ? (
        <LiveDeployment deployment={live.value} />
      ) : (
        <p className="text-sm leading-5 text-muted-foreground">
          Nothing is live on this project&rsquo;s primary origins yet. Deploy a release from
          Deployments, or run <CliCommand>{CLI_DEPLOY}</CliCommand> in your app.
        </p>
      )}
    </DetailSection>
  );
}

function LiveDeployment({ deployment }: { deployment: Deployment }) {
  const { message } = deployment.metadata;
  const origins = deployment.targets.map((target) => target.origin);
  // The event page's rhythm: rows 12px apart with a rule between them.
  return (
    <div className="flex flex-col gap-3">
      <DetailRow align="center" label="Release">
        <span className="flex min-w-0 items-center gap-3">
          <Link
            to="/releases/$releaseId"
            params={{ releaseId: deployment.release_id }}
            className="min-w-0 text-sm text-foreground hover:underline"
          >
            <IdText id={deployment.release_id} title={deployment.release_id} />
          </Link>
          <DeploymentStatusBadge status={deployment.status} />
        </span>
      </DetailRow>
      <Separator />
      <DetailRow align="center" label="Deployed">
        <time dateTime={deployment.deployed_at} className="text-sm text-foreground">
          {formatRecent(deployment.deployed_at)}
        </time>
      </DetailRow>
      {message && (
        <>
          <Separator />
          <DetailRow label="Message">
            <p className="min-w-0 text-sm leading-5 text-foreground wrap-anywhere">{message}</p>
          </DetailRow>
        </>
      )}
      <Separator />
      <DetailRow label={origins.length === 1 ? "Origin" : "Origins"}>
        <ul className="flex min-w-0 flex-col gap-1">
          {origins.map((origin) => (
            <li key={origin} className="min-w-0">
              <OriginLink
                origin={origin}
                className="text-sm font-normal text-foreground"
                iconClassName="text-muted-foreground"
              />
            </li>
          ))}
        </ul>
      </DetailRow>
    </div>
  );
}
