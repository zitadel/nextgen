package zotel_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

type allowAll struct{}

func (allowAll) HandleNextgenSession(ctx context.Context, _ oasapi.OperationName, _ oasapi.NextgenSession) (context.Context, error) {
	return ctx, nil
}

func (allowAll) HandleOAuth2(ctx context.Context, _ oasapi.OperationName, _ oasapi.OAuth2) (context.Context, error) {
	return ctx, nil
}

// The request instruments that serve the API are the generated server's, so
// this runs the generated server: one request per user id, which is what a
// 100k-user benchmark does to the old `http.target` attribute. The series
// count must be the number of operations, methods and statuses seen, whatever
// the number of users.
func TestMeterViews_SeriesDoNotGrowWithUsers(t *testing.T) {
	users := 100_000
	if testing.Short() {
		users = 2_000
	}

	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithView(zotel.MeterViews()...))
	server, err := oasapi.NewServer(oasapi.UnimplementedHandler{}, allowAll{}, oasapi.WithMeterProvider(provider))
	require.NoError(t, err)

	for i := range users {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/users/usr_%d", i), nil)
		req.Header.Set("Authorization", "Bearer token")
		server.ServeHTTP(httptest.NewRecorder(), req)
	}

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))

	var total int64
	seen := map[string]int{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			switch data := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, p := range data.DataPoints {
					seen[m.Name]++
					if m.Name == "ogen.server.request_count" {
						total += p.Value
					}
					for _, kv := range p.Attributes.ToSlice() {
						assert.NotContains(t, kv.Value.Emit(), "usr_", "%s carries a user id as %s", m.Name, kv.Key)
					}
				}
			case metricdata.Histogram[float64]:
				for _, p := range data.DataPoints {
					seen[m.Name]++
					for _, kv := range p.Attributes.ToSlice() {
						assert.NotContains(t, kv.Value.Emit(), "usr_", "%s carries a user id as %s", m.Name, kv.Key)
					}
				}
			}
		}
	}

	assert.EqualValues(t, users, total, "every request is counted")
	assert.Equal(t, 1, seen["ogen.server.request_count"], "one series, however many users")
	assert.Equal(t, 1, seen["ogen.server.duration"], "one series, however many users")
}
