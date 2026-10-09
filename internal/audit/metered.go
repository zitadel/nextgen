package audit

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// NewMeteredBatchInserter times every flush of the request buffer and counts
// the events a successful flush wrote, by type. The events Path B writes inside
// their own transactions are measured in [Insert].
//
// A wrapper rather than a change to [RequestBuffer], so the buffer's retry loop
// is measured as the caller sees it: one measurement per attempt.
func NewMeteredBatchInserter(next EventBatchInserter) EventBatchInserter {
	return meteredBatchInserter{next: next}
}

type meteredBatchInserter struct{ next EventBatchInserter }

// InsertEvents implements [EventBatchInserter].
func (m meteredBatchInserter) InsertEvents(ctx context.Context, events []*domain.Event) error {
	start := time.Now()
	err := m.next.InsertEvents(ctx, events)

	app := metrics.Default()
	app.RecordAuditInsert(ctx, metrics.AuditRequest, time.Since(start))
	if err == nil && app.Enabled() {
		counts := map[domain.EventType]int{}
		for _, ev := range events {
			counts[ev.EventType]++
		}
		for typ, n := range counts {
			app.RecordAuditEvents(ctx, string(typ), n)
		}
	}
	return err
}
