# Cloud provider fit, 2026-10-10: Fly, Render, Railway and GCP

> **Status:** research of 2026-10-10, prices as read that day.
>
> **Outcome:** not followed. We stayed on Vercel ([C30](decisions.md#c30))
> and run the servers as container functions ([C31](decisions.md#c31)).
> Vercel is moving toward what we need (services, container functions,
> bindings, queues), and since it will not offer always-on servers,
> background work gets a triggered mode instead. The cloud as it runs: the
> [README](README.md). "Today" below means today's Zitadel Cloud, which
> runs on GCP, not nextgen.

Question from the dedicated-customer discussion: the server runs better as a
long-lived container than as a function, so where should the regional
servers run, could the whole stack live with one provider, with PlanetScale
as the database provider, and what is the current sentiment about Fly.io,
Render and Railway. Today Zitadel runs its API, databases and cloud service
on GCP and its frontends on Vercel. Research done 2026-10-10 against the
providers' own docs and pricing pages and recent third-party write-ups; the
sources are at the end. Figures move, so the pricing ones are "as read on
that day".

## 1. What has to fit

The model of [systems.md](systems.md),
as requirements on a provider:

1. **Always-on Go containers per placement**, two or three replicas, next
   to a PlanetScale database (Frankfurt `eu-central-1` and Ohio `us-east-2`
   today), with stable pools and background jobs taking leases.
2. **A routable ingress**: host and/or path → placement, with a request
   header set per customer, changeable by API without a deployment.
3. **Customer domains at scale** for hosted logins, with automatic
   certificates, wildcards included.
4. **Previews per pull request**, each with its own schema.
5. **Static frontends** on a CDN: console, docs, website, storybook.
6. **A control plane service and jobs** (cron, queues, leases).
7. **Private networking and static egress IPs** for database allowlists.
8. **Compliance**: SOC 2, a DPA, EU residency, an SLA someone will sign.
9. **Cost at our shape**: four small always-on replicas plus previews.

## 2. Fly.io

| Requirement | Fit |
|---|---|
| Containers per placement | Yes. Firecracker Machines, per-second billing, 17 regions including `fra` (Frankfurt), `iad`, `ewr`, `ord`; Machines and volumes are bound to their region. |
| Routable ingress | **Best of the three.** Anycast IPv6 and shared IPv4 on every app; `fly-replay` lets an app answer with `region=`, `app=` or `instance=` and Fly Proxy replays the request there, within the organisation; the JSON form adds `transform.set_headers`, so the router can set the sealed `x-nextgen-system` header on the replayed request, and `state` travels in `fly-replay-src`. Replay caching (`fly-replay-cache`, TTL of at least 10 s, or `replay_cache` in `fly.toml` keyed on a cookie or header) keeps the router out of the path after the first request. Bodies over 1 MB cannot be replayed; our API bodies are JSON and far below it. `fly-prefer-region` and `fly-force-region` request headers exist for clients and tests. A tiny router app that reads the directory and replays to the slot is the whole contract in our own code. |
| Customer domains | `fly certs add`, wildcard with DNS-01, certificates API; no documented cap on hostnames, Let's Encrypt's 50 per registered domain per week is the practical limit; certificate pricing is not on the pricing page (community posts cite a free allowance and a small monthly fee beyond it, verify). |
| Previews per PR | No product. A GitHub Action that creates an app per PR; schemas from our launcher as today. |
| Static frontends | No product. A static file server Machine or object storage without a CDN; in practice Vercel stays for them. |
| Control plane, jobs | Machines with schedules; no managed cron or queue product for our shape. |
| Private networking, static egress | 6PN WireGuard mesh across regions, gateway regions for operator VPN; dedicated IPv4 $2/month; egress IPs are not static by default. |
| Compliance | SOC 2 Type II, DPA, BAA; HIPAA package $99/month; **99.9 % SLA only with Enterprise support from $2,500/month** (Standard $29, Premium $199, no SLA). |
| Cost | `shared-cpu-1x` 256 MB $2.19/month, `performance-1x` 2 GB $33/month in Ashburn, Frankfurt a few percent more, RAM $6/GB; egress $0.02/GB in NA and EU, no free allowance; no spending cap by default. Four performance replicas plus a router: on the order of $150/month before egress. |

**Sentiment.** Mixed, and the record is the issue. 2026 status trackers show
frequent incidents (one counts 14 in the 30 days before early October,
another 72 between July and October with about 40 % rated major); a
four-incident day on 2026-09-23 spanning DFW IPv6, Frankfurt, the private
mesh and Sprites; a March 2026 Consul outage hitting unmanaged Postgres and
LiteFS; a May 2026 billing bug that blocked deploys. Reviewers agree it is
far better than 2023, when the CEO published "Reliability is not great",
and describe it as mid-tier PaaS reliability, with the advice that
payment-grade workloads buy the enterprise SLA or go elsewhere. The
technology is admired; the operations are the risk.

## 3. Render

| Requirement | Fit |
|---|---|
| Containers per placement | Yes. Web and private services from a Dockerfile, one region per service, five regions: Oregon, Ohio, Virginia, Frankfurt, Singapore. Ohio and Frankfurt sit in the metros of our two databases. Manual scaling to 100 instances per service, autoscaling on Pro. |
| Routable ingress | **Weakest.** No rules engine and no request-header rewriting; routing is "which service a domain is attached to". The sealed header cannot be set by the platform, so the runtime would look the system up from the host in the directory instead. Per-customer routing is still API-driven (attach a domain), but path aliases need our own router service. |
| Customer domains | Automatic certificates, wildcards count as one domain and need the root pointed at Render; **15 domains included on Pro, 25 on Scale, $0.25/month each beyond**. |
| Previews per PR | **Yes, a product.** Blueprint-based preview environments on Pro, a fresh copy of every service per PR, billed per second, `previewValue` for variables, expiry configurable. Schemas from our launcher. |
| Static frontends | **Yes.** Static sites on a global CDN, free, custom domains with TLS. |
| Control plane, jobs | Web services, private services, background workers, cron jobs, a workflow product. |
| Private networking, static egress | Private network per region; cross-region traffic goes over the public internet; static outbound IPs on paid plans. |
| Compliance | SOC 2 and ISO reports on Pro; HIPAA on Scale ($499/month) at 20 % of compute; support "for every user across every plan"; no published uptime SLA below Enterprise. |
| Cost | Pro workspace $25/month flat, unlimited members, 25 GB bandwidth then **$0.15/GB**; instances Starter $7 (0.5 CPU, 512 MB), Standard $25 (1 CPU, 2 GB), Pro $85 (2 CPU, 4 GB), Pro Plus $175 (4 CPU, 8 GB), up to 8 CPU, 64 GB and beyond. Four Standard replicas plus the workspace: about $125/month before bandwidth, which at $0.15/GB is the line to watch. |

**Sentiment.** Reliability is the thing reviewers praise ("rock solid",
"sensible defaults"); the 2026 story is pricing churn: the April 2026
plans dropped seat fees and cut included bandwidth (Pro from 500 GB to
25 GB, Hobby from 100 GB to 5 GB) with per-GB billing, legacy workspaces
were migrated on 2026-08-01, and two further price-point changes followed
in August. Indie developers called the bandwidth change a price hike;
teams liked the flat workspace. The steady, slightly boring Heroku
successor.

## 4. Railway

| Requirement | Fit |
|---|---|
| Containers per placement | Yes. Replicas per region, up to 42 on Pro, vertical to 48 vCPU / 48 GB, Railway Metal (own hardware). **Four regions: US West, US East (Virginia), Europe West (Amsterdam), Southeast Asia.** Amsterdam and Virginia are ten-odd milliseconds from Frankfurt and Ohio, not in the metro. |
| Routable ingress | Partial. Edge points of presence route public traffic to the nearest region a service is deployed in, then randomly to a replica; no rules, no header rewriting, the private mesh is not locality-aware. Per-customer routing is again our own router. |
| Customer domains | Automatic certificates, wildcards count as one; **20 domains per service on Pro**, raised on request to the low tens; for hundreds, staff recommend fronting with Cloudflare. A real limit for hosted logins. |
| Previews per PR | Yes, PR environments, a copy of the environment per pull request. |
| Static frontends | No CDN product; a container serving files. |
| Control plane, jobs | Services with cron schedules; volumes; object storage. |
| Private networking, static egress | WireGuard mesh per environment, cross-region allowed; static outbound IPs on Pro. |
| Compliance | SOC 2 claimed; HIPAA BAA under Enterprise only; SLA, SSO and RBAC with committed spend. |
| Cost | Pro $20/month per workspace, unlimited seats, usage on top: about $20 per vCPU-month, $10 per GB-month, egress $0.05/GB, volumes $0.15/GB. Four replicas at 1 vCPU / 2 GB: about $160/month plus the fee. |

**Sentiment.** The best developer experience of the three by most
accounts, and the most eventful year. The move to Railway Metal brought
praise for uptime from some and slower Postgres reports from others. On
2026-05-19 Google suspended Railway's production GCP account without
warning; the edge proxies depended on a GCP-hosted routing control plane,
so once cached routes expired every workload went dark for about eight
hours, Metal included. Railway published a postmortem; a competitor counts
five major incidents with postmortems between November 2025 and May 2026.
Fast-moving, candid, and with a control plane that was the single point of
failure.

## 5. The GCP we already run

Not asked for, but it is the honest "one provider" candidate, because it
is the one in use:

- **Cloud Run** runs containers with minimum instances (always-on),
  request concurrency, and regions in both metros: `europe-west3`
  (Frankfurt) and `us-east5` (Columbus, Ohio).
- **The global external Application Load Balancer** is a programmable
  ingress: one anycast IP, URL maps by host and path to a serverless
  network endpoint group per region, request-header actions and URL
  rewrites per route, Cloud Armor for WAF and rate limits, Certificate
  Manager for customer domains at scale including wildcards. Changed by
  API or Terraform without a deployment. This is layer 2 of the routing
  contract as a managed product.
- **PlanetScale** has GCP regions too (Virginia, Iowa, Belgium,
  Netherlands), so same-cloud is possible, or AWS Frankfurt and Ohio from
  the same metros as today.
- The costs are operations, not money: no previews product (a Cloud Run
  service per PR from CI), no static hosting product worth leaving Vercel
  for, IAM and networking to own. Cloud Run minimum instances price like a
  small PaaS; the load balancer is around $20/month plus traffic.

## 6. Can the whole stack live with one provider?

Only two candidates cover everything in §1 at all:

- **Render** is the only PaaS of the three that hosts static frontends on
  a CDN, previews, cron and always-on services together. What it lacks is
  the programmable ingress: per-customer routing becomes "attach the
  domain to the regional service", path aliases need our own router, and
  the sealed header is replaced by a directory lookup in the runtime. It
  fits the product, not the routing design.
- **GCP** covers all of it with the strongest routing of any option, at the
  price of building previews ourselves and running what a PaaS runs for
  us.

Fly and Railway do not host frontends or, for Fly, previews; both would
be the data-plane half of a pair with Vercel. Forcing one provider
therefore means choosing between Render's plain routing and GCP's
operations. The pair, Vercel for frontends and previews plus one of the
others for the always-on servers, is what every candidate's shape points
at, and it is also the shape of today's Zitadel Cloud.

## 7. Verdict

| | Routing fit | Regions for our DBs | Reliability record | Whole stack |
|---|---|---|---|---|
| Fly | best (anycast + replay) | Frankfurt, Chicago/Ashburn | weakest, improving | no |
| Render | weakest (domains only) | Frankfurt, Ohio | strongest | yes |
| Railway | nearest-region only | Amsterdam, Virginia | one platform-wide outage in 2026 | no |
| GCP (Zitadel Cloud today) | strongest (managed LB) | Frankfurt, Columbus | hyperscaler | yes, with ops |

Recommendation:

1. **Keep Vercel for frontends and previews.** Nothing researched here does
   that part better, and it is already built.
2. **Run the always-on regional servers on one of two**: Fly if the
   routing contract in our own code and the region list matter most, GCP
   Cloud Run if the managed load balancer, compliance posture and the
   existing estate matter most. Render is the safe third if neither
   routing nor regions beyond its five are a concern. Railway is a fine
   place for the control plane and for POCs, not for the data plane until
   it has a Frankfurt region and domain limits that fit hosted logins.
3. **Decide by experiment, not by reading**: the current `server_eu` as two
   always-on replicas next to the Frankfurt database on Fly `fra` and on
   Cloud Run `europe-west3`, against the Vercel function: p95 at 50 to 200
   concurrent requests, PgBouncer connections, cost at that baseline, and
   whether retention, shipper and the job poll run once and keep running.
   Half a day each. Not run: C30 kept Vercel without it.

The routing contract of the [systems concept](systems.md) would not change
with the answer: a slot is reached through the rules by rewrite, with the
sealed header, wherever it runs.

## Sources

- Fly: [regions](https://docs.fly.io/reference/regions), [dynamic request routing / fly-replay](https://docs.fly.io/networking/dynamic-request-routing), [granular routing](https://fly.io/granular-routing), [pricing](https://fly.io/pricing), [custom domains](https://docs.fly.io/networking/custom-domain), [custom domain limits (community)](https://community.fly.io/t/is-there-a-limit-on-the-number-of-custom-domains-an-app-can-have/25869), [reliability 2026 (Kuberns)](https://kuberns.com/blogs/is-fly-io-good-for-production/), [incident day 2026-09-23 (bex.co)](https://bex.co/blog/2026/09/24/fly-io-four-incident-september-networking-day), [status tracker](https://statusgator.com/services/flyio)
- Render: [regions](https://render.com/docs/regions), [preview environments](https://render.com/docs/preview-environments), [scaling](https://render.com/docs/scaling), [custom domains](https://render.com/docs/custom-domains), [pricing blog 2026-04-23](https://render.com/blog/better-pricing-for-fast-growing-teams), [pricing](https://render.com/pricing), [price changes analysis (bex.co)](https://bex.co/blog/2026/09/04/render-price-changes-cost-sheet)
- Railway: [pricing](https://railway.com/pricing), [scaling and regions](https://docs.railway.com/deployments/scaling), [multi-region routing](https://docs.railway.com/guides/multi-region-api-failover), [private networking](https://docs.railway.com/private-networking), [custom domains](https://docs.railway.com/networking/domains/working-with-domains), [Railway Metal](https://docs.railway.com/railway-metal), [2026-05-19 outage (postmortem library)](https://www.ilert.com/postmortems/railway-gcp-account-suspension-control-plane-outage-may-2026), [Railway community update](https://station.railway.com/community/what-we-know-so-far-may-19th-2026-86354cdd), [TechRadar](https://www.techradar.com/pro/we-are-livid-and-still-trying-to-get-all-the-details-google-cloud-accused-of-suspending-major-customer-without-any-warning-leading-to-major-outage)
- GCP: [Cloud Run locations](https://docs.cloud.google.com/run/docs/locations), [global external ALB with Cloud Run](https://docs.cloud.google.com/run/docs/integrate/custom-domain-load-balancer), [cross-regional failover](https://docs.cloud.google.com/run/docs/tutorials/configure-service-health)
- PlanetScale: [regions](https://planetscale.com/docs/plans/regions)
