package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureEventService(t *testing.T) *service.EventService {
	t.Helper()
	h.eventService.mutex.Lock()
	defer h.eventService.mutex.Unlock()

	if h.eventService.value == nil {
		h.eventService.value = service.NewEventService(
			h.EnsureServiceDB(t),
		)
	}
	return h.eventService.value
}
