package service

import (
	"context"
	"errors"
	"strings"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// AddOrigin validates and stores one origin pattern on the project.
// Adding the same {pattern, kind} again is idempotent. The same pattern with a
// different kind is rejected with origin.kind_conflict.
func (s *projectService) AddOrigin(ctx context.Context, projectID string, origin domain.Origin) (_ *domain.Origin, err error) {
	ctx, end := startSpan(ctx, "ProjectService.AddOrigin")
	defer end(&err)

	if projectID == "" {
		return nil, domain.ErrProjectMissingID()
	}
	origin.Pattern = strings.TrimSpace(origin.Pattern)
	if err := s.originValidator.Validate(origin); err != nil {
		return nil, err
	}

	var stored domain.Origin
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		inserted, err := tx.Statements().InsertOrigin(ctx, projectID, origin)
		if err != nil {
			if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
				return domain.ErrProjectNotFound().WithParent(err)
			}
			// Spanner aborts the txn on a lost insert race; bubble UniqueError so
			// we can classify outside this transaction (see below).
			if _, ok := errors.AsType[*database.UniqueError](err); ok {
				return err
			}
			return domain.ErrInternal(err).WithMessage("failed to insert origin")
		}
		if inserted {
			stored = origin
			return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
				Type:       domain.EventTypeOriginAdded,
				Category:   domain.EventCategoryEntity,
				ProjectID:  projectID,
				EntityType: "origin",
				EntityID:   origin.Pattern,
				Payload: domain.OriginPayload{
					Pattern: origin.Pattern,
					Kind:    origin.Kind,
				},
			})
		}

		existing, err := tx.Statements().GetOrigin(ctx, database.And(
			database.Equal(database.Col(domain.OriginFieldProjectID), projectID),
			database.Equal(database.Col(domain.OriginFieldPattern), origin.Pattern),
		))
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to look up origin after conflict")
		}
		if existing.Kind != origin.Kind {
			return domain.ErrOriginKindConflict()
		}
		stored = domain.Origin{Pattern: existing.Pattern, Kind: existing.Kind}
		return nil
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return s.originAfterUniqueConflict(ctx, projectID, origin, err)
		}
		return nil, err
	}
	return &stored, nil
}

// originAfterUniqueConflict resolves an insert that lost a uniqueness race
// after the write transaction aborted (Spanner DML AlreadyExists).
func (s *projectService) originAfterUniqueConflict(ctx context.Context, projectID string, origin domain.Origin, cause error) (*domain.Origin, error) {
	existing, err := s.v2Pool.Statements().GetOrigin(ctx, database.And(
		database.Equal(database.Col(domain.OriginFieldProjectID), projectID),
		database.Equal(database.Col(domain.OriginFieldPattern), origin.Pattern),
	))
	if err != nil {
		return nil, domain.ErrInternal(cause).WithMessage("failed to look up origin after conflict")
	}
	if existing.Kind != origin.Kind {
		return nil, domain.ErrOriginKindConflict().WithParent(cause)
	}
	return &domain.Origin{Pattern: existing.Pattern, Kind: existing.Kind}, nil
}

// RemoveOrigin deletes one origin pattern. Removing a missing pattern is
// idempotent (no error). Project existence is gated by authz on the HTTP path.
func (s *projectService) RemoveOrigin(ctx context.Context, projectID, pattern string) (err error) {
	ctx, end := startSpan(ctx, "ProjectService.RemoveOrigin")
	defer end(&err)

	if projectID == "" {
		return domain.ErrProjectMissingID()
	}
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return domain.ErrOriginInvalid()
	}

	return s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		deleted, removed, err := tx.Statements().DeleteOriginByPattern(ctx, projectID, pattern)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to delete origin")
		}
		if !deleted {
			return nil
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeOriginRemoved,
			Category:   domain.EventCategoryEntity,
			ProjectID:  projectID,
			EntityType: "origin",
			EntityID:   pattern,
			Payload: domain.OriginPayload{
				Pattern: removed.Pattern,
				Kind:    removed.Kind,
			},
		})
	})
}
