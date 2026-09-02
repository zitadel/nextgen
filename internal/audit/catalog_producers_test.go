package audit_test

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// livePathBProducers maps every active Path B catalog event_type to the
// package that emits it. Update when wiring a new producer or narrowing the
// catalog. Path A (request.api) is owned by this audit package middleware.
var livePathBProducers = map[domain.EventType]string{
	domain.EventTypeProjectCreated:            "internal/service",
	domain.EventTypeProjectUpdated:            "internal/service",
	domain.EventTypeProjectDeleted:            "internal/service",
	domain.EventTypeUserCreated:               "internal/service",
	domain.EventTypeUserCreateFailed:          "internal/service",
	domain.EventTypeUserDeleted:               "internal/service",
	domain.EventTypeTeamCreated:               "internal/service",
	domain.EventTypeTeamUpdated:               "internal/service",
	domain.EventTypeTeamDeactivated:           "internal/service",
	domain.EventTypeAuthTokenIssued:           "internal/service",
	domain.EventTypeAuthTokenRevoked:          "internal/service",
	domain.EventTypeSessionEstablished:        "internal/service",
	domain.EventTypeSessionDeleted:            "internal/service",
	domain.EventTypeAuthAttemptCreated:        "internal/service",
	domain.EventTypeAuthAttemptHandedOff:      "internal/service",
	domain.EventTypeAuthCheckFailed:           "internal/service",
	domain.EventTypeAuthCheckSucceeded:        "internal/service",
	domain.EventTypeFlowdefCreated:            "internal/service",
	domain.EventTypeFlowdefUpdated:            "internal/service",
	domain.EventTypeFlowdefDeleted:            "internal/service",
	domain.EventTypeSchemaCreated:             "internal/service",
	domain.EventTypeBrandingCreated:           "internal/service",
	domain.EventTypeEnvironmentCreated:        "internal/service",
	domain.EventTypeAuthzGranted:              "internal/service",
	domain.EventTypeAuthzRevoked:              "internal/service",
	domain.EventTypeAuthFactorPasswordSet:     "internal/service",
	domain.EventTypeAuthFactorPasskeyEnrolled: "internal/service",
	domain.EventTypeRequestAPI:                "internal/audit",
}

func TestCatalogPathBTypesHaveProducers(t *testing.T) {
	t.Parallel()
	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok)
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "../.."))
	catalogPath := filepath.Join(root, "docs/design/api/events-catalog.md")
	raw, err := os.ReadFile(catalogPath)
	require.NoError(t, err)

	active := string(raw)
	if i := strings.Index(active, "## Deferred"); i >= 0 {
		active = active[:i]
	}
	// Backtick-quoted dotted names in active Path A/B sections (event_type values).
	re := regexp.MustCompile("`([a-z][a-z0-9_]*\\.[a-z0-9_.]+)`")
	catalogTypes := map[domain.EventType]struct{}{}
	for _, m := range re.FindAllStringSubmatch(active, -1) {
		catalogTypes[domain.EventType(m[1])] = struct{}{}
	}
	require.NotEmpty(t, catalogTypes)

	for et := range catalogTypes {
		_, ok := livePathBProducers[et]
		assert.Truef(t, ok, "catalog event_type %q has no livePathBProducers entry", et)
	}
	for et, pkg := range livePathBProducers {
		_, ok := catalogTypes[et]
		assert.Truef(t, ok, "producer allowlist entry %q (%s) missing from active catalog", et, pkg)
	}
}
