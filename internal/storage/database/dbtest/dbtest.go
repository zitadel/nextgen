// Package dbtest provides shared bring-up of a database for the integration
// test suites. Each helper honors the ZITADEL_TEST_POSTGRES_URL /
// ZITADEL_TEST_SPANNER_URL override — connect to a database you manage, so no
// Docker is needed — and otherwise starts a Docker testcontainer.
//
// The bring-up functions live in build-tagged files (postgres_integration /
// spanner_integration) so testcontainers-go and the container bring-ups never
// enter non-integration or production builds. This file carries no build tag
// so the package always has at least one buildable Go file.
package dbtest
