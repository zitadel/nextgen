package service

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// UsageGranularity is the span one usage bucket covers.
type UsageGranularity string

const (
	UsageByDay  UsageGranularity = "day"
	UsageByHour UsageGranularity = "hour"
)

// maxUsageRange bounds one read: a month of days, or of hours, per meter.
const maxUsageRange = 31 * 24 * time.Hour

// GetUsageRequest is the input for reading a project's usage (ADR 085).
type GetUsageRequest struct {
	ProjectID   string
	From, To    time.Time
	Granularity UsageGranularity
	// Meters narrows the read; empty reads every meter.
	Meters []string
}

// UsageBucket is what one meter counted in one day or hour.
type UsageBucket struct {
	Meter string
	Start time.Time
	Value int64
}

// GetUsageResponse is a project's usage in the requested range.
type GetUsageResponse struct {
	Buckets []UsageBucket
	// SealedThrough is the start of the first hour not sealed yet; nil until
	// the projector has counted the project.
	SealedThrough *time.Time
	// TeamID is the team that claimed the project; nil while unclaimed.
	TeamID *string
}

// UsageService reads the usage rollups the projector keeps (ADR 085).
type UsageService struct {
	v2Pool *DB
	// counts is usage.enabled: without the projector the rollups say nothing.
	counts bool
}

func NewUsageService(v2Pool *DB, counts bool) *UsageService {
	return &UsageService{v2Pool: v2Pool, counts: counts}
}

// Get returns the project's buckets in [From, To), ordered by meter, then
// start. Unlike its events, a project nobody has claimed answers its usage
// too: the counts carry no event content, and a standalone deployment never
// claims its projects. Only TeamID tells the two apart.
func (s *UsageService) Get(ctx context.Context, req GetUsageRequest) (_ *GetUsageResponse, err error) {
	ctx, end := startSpan(ctx, "UsageService.Get")
	defer end(&err)

	if !s.counts {
		return nil, domain.ErrUsageDisabled()
	}
	meters, err := validateUsageRequest(req)
	if err != nil {
		return nil, err
	}

	stmts := s.v2Pool.Statements()
	if _, err := stmts.GetProjectByID(ctx, req.ProjectID); err != nil {
		if isNoRowFound(err) {
			return nil, domain.ErrUsageNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to load project for usage")
	}
	var teamID *string
	grant, err := stmts.GetActiveOwningTeamGrant(ctx, req.ProjectID)
	switch {
	case err == nil:
		teamID = &grant.PrincipalID
	case !isNoRowFound(err):
		return nil, domain.ErrInternal(err).WithMessage("failed to load claim grant for usage")
	}

	hours, err := stmts.ReadUsageHours(ctx, req.ProjectID, meters, req.From, req.To)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read usage")
	}
	cursor, err := stmts.GetUsageCursor(ctx, req.ProjectID)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read the usage cursor")
	}

	resp := &GetUsageResponse{Buckets: usageBuckets(hours, req.Granularity), TeamID: teamID}
	if cursor != nil {
		sealed := domain.UsageHourOf(cursor.CountedBefore)
		resp.SealedThrough = &sealed
	}
	return resp, nil
}

// validateUsageRequest checks the range against its granularity and returns
// the meters to read.
func validateUsageRequest(req GetUsageRequest) ([]string, error) {
	step := time.Hour
	if req.Granularity == UsageByDay {
		step = 24 * time.Hour
	}
	from, to := req.From.UTC(), req.To.UTC()
	switch {
	case req.Granularity != UsageByDay && req.Granularity != UsageByHour:
		return nil, domain.ErrUsageInvalid("granularity must be day or hour")
	case !from.Truncate(step).Equal(from) || !to.Truncate(step).Equal(to):
		return nil, domain.ErrUsageInvalid("from and to must start a UTC " + string(req.Granularity))
	case !to.After(from):
		return nil, domain.ErrUsageInvalid("to must be after from")
	case to.Sub(from) > maxUsageRange:
		return nil, domain.ErrUsageInvalid("from and to may be at most 31 days apart")
	}
	if len(req.Meters) == 0 {
		meters := make([]string, len(domain.UsageMeters))
		for i, meter := range domain.UsageMeters {
			meters[i] = meter.Name
		}
		return meters, nil
	}
	for _, name := range req.Meters {
		if _, ok := domain.UsageMeterByName(name); !ok {
			return nil, domain.ErrUsageInvalid("unknown meter " + name)
		}
	}
	return req.Meters, nil
}

// usageBuckets turns hour rows, ordered by meter and hour, into buckets of
// the granularity, summing a UTC day's hours.
func usageBuckets(hours []domain.UsageHour, granularity UsageGranularity) []UsageBucket {
	buckets := make([]UsageBucket, 0, len(hours))
	for _, hour := range hours {
		start := hour.Hour.UTC()
		if granularity == UsageByDay {
			start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
		}
		if n := len(buckets); n > 0 && buckets[n-1].Meter == hour.Meter && buckets[n-1].Start.Equal(start) {
			buckets[n-1].Value += hour.Value
			continue
		}
		buckets = append(buckets, UsageBucket{Meter: hour.Meter, Start: start, Value: hour.Value})
	}
	return buckets
}
