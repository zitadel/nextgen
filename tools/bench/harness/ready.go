package harness

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// CheckReady proves the prerequisite every command has: a server at base
// that answers /healthz. The harness never starts or stops a server — the
// provisioning tool of the lane does — so a missing one is reported here,
// once and plainly, rather than as a transport error inside the first
// provisioning call or as a wall of failed iterations.
func CheckReady(ctx context.Context, base string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/healthz", nil)
	if err != nil {
		return err
	}
	//egress:allow benchmark harness probing the server it is pointed at
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("no healthy server at %s: %w", base, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("no healthy server at %s: /healthz answered %s", base, resp.Status)
	}
	return nil
}
