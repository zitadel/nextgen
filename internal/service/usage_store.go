package service

import (
	"cmp"
	"context"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
)

// UsageStore adapts AllStatements to the usage projector (audit.UsageStore).
type UsageStore struct {
	Pool *DB
}

func (s UsageStore) ListProjectIDs(ctx context.Context) (_ []string, err error) {
	ctx, end := startSpan(ctx, "UsageStore.ListProjectIDs")
	defer end(&err)

	return collectProjectIDs(ctx, s.Pool.Statements().ListProjects)
}

func (s UsageStore) GetUsageCursor(ctx context.Context, projectID string) (_ *domain.UsageCursor, err error) {
	ctx, end := startSpan(ctx, "UsageStore.GetUsageCursor")
	defer end(&err)

	return s.Pool.Statements().GetUsageCursor(ctx, projectID)
}

func (s UsageStore) ReadUsageEvents(ctx context.Context, projectID string, after *domain.UsageCursor, types []domain.EventType, limit uint32) (_ []*domain.Event, _ time.Time, err error) {
	ctx, end := startSpan(ctx, "UsageStore.ReadUsageEvents")
	defer end(&err)

	return s.Pool.Statements().ReadUsageEvents(ctx, projectID, after, types, limit)
}

// CountUsage implements [audit.UsageStore]. The cursor moves first, so a run
// that lost the race to another writes nothing. A batch that names no user
// only moves the cursor, without a transaction.
func (s UsageStore) CountUsage(ctx context.Context, prev *domain.UsageCursor, next domain.UsageCursor, touches []domain.UsageTouch) (_ bool, err error) {
	ctx, end := startSpan(ctx, "UsageStore.CountUsage")
	defer end(&err)

	if len(touches) == 0 {
		return s.Pool.Statements().AdvanceUsageCursor(ctx, prev, next)
	}
	var moved bool
	err = s.Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		// Assigned, never accumulated across attempts: Spanner replays an
		// aborted transaction.
		moved = false
		st := tx.Statements()
		ok, err := st.AdvanceUsageCursor(ctx, prev, next)
		if err != nil || !ok {
			return err
		}
		hours, err := countFirstTouches(ctx, st, next.ProjectID, touches)
		if err != nil {
			return err
		}
		if err := st.AddUsageHours(ctx, next.ProjectID, hours); err != nil {
			return err
		}
		moved = true
		return nil
	})
	return moved, err
}

// countFirstTouches records the touched users each meter has not counted in
// their month yet, and returns how many of them each hour adds, one entry
// per meter and hour.
func countFirstTouches(ctx context.Context, st AllStatements, projectID string, touches []domain.UsageTouch) ([]domain.UsageHour, error) {
	type group struct {
		meter string
		month time.Time
	}
	byGroup := make(map[group][]domain.UsageTouch)
	var groups []group
	for _, touch := range touches {
		g := group{meter: touch.Meter, month: touch.Month}
		if _, ok := byGroup[g]; !ok {
			groups = append(groups, g)
		}
		byGroup[g] = append(byGroup[g], touch)
	}

	type hourKey struct {
		meter string
		hour  time.Time
	}
	added := make(map[hourKey]int64)
	for _, g := range groups {
		candidates := byGroup[g]
		userIDs := make([]string, len(candidates))
		for i, touch := range candidates {
			userIDs[i] = touch.UserID
		}
		seen, err := st.SeenUsageUsers(ctx, projectID, g.meter, g.month, userIDs)
		if err != nil {
			return nil, err
		}
		var first []string
		for _, touch := range candidates {
			if slices.Contains(seen, touch.UserID) {
				continue
			}
			first = append(first, touch.UserID)
			added[hourKey{meter: g.meter, hour: touch.Hour}]++
		}
		if err := st.InsertUsageFirstSeen(ctx, projectID, g.meter, g.month, first); err != nil {
			return nil, err
		}
	}

	hours := make([]domain.UsageHour, 0, len(added))
	for k, value := range added {
		hours = append(hours, domain.UsageHour{Meter: k.meter, Hour: k.hour, Value: value})
	}
	slices.SortFunc(hours, func(a, b domain.UsageHour) int {
		return cmp.Or(cmp.Compare(a.Meter, b.Meter), a.Hour.Compare(b.Hour))
	})
	return hours, nil
}

var _ audit.UsageStore = UsageStore{}
