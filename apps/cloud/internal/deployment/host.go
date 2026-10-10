// Package deployment reads where a Vercel deployment is reached, for the
// binaries of the cloud that have to name their own host: the launcher, which
// derives the server's public base and the home's URL from it, and the cloud
// service, which calls the home and the regions on it.
package deployment

import "os"

// HostVariable names the host explicitly (an alias or a custom domain),
// outranking what Vercel reports.
const HostVariable = "CLOUD_HOST"

// Host is the host this deployment is reached at, without scheme: CLOUD_HOST
// when set, else the project's production domain in production, else the
// deployment's branch URL, else its deployment URL; empty outside Vercel.
func Host() string {
	if host := os.Getenv(HostVariable); host != "" {
		return host
	}
	if os.Getenv("VERCEL_ENV") == "production" {
		if host := os.Getenv("VERCEL_PROJECT_PRODUCTION_URL"); host != "" {
			return host
		}
	}
	if host := os.Getenv("VERCEL_BRANCH_URL"); host != "" {
		return host
	}
	return os.Getenv("VERCEL_URL")
}
