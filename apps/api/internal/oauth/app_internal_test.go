package oauth

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

// The built-in app holds to the rules a stored app document does, on the
// public bases a deployment has: https, and http on a loopback host.
func TestPlatformAppIsAValidAppDocument(t *testing.T) {
	for _, base := range []string{"https://zitadel.example.com/", "http://localhost:8080"} {
		t.Run(base, func(t *testing.T) {
			app := PlatformApp(domain.PlatformProjectID, base, Config{ClientIDMetadataDocuments: true, DynamicRegistration: true})
			assert.NoError(t, app.Document.Validate(domain.AppSourceBuiltin))
		})
	}
}
