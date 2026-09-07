package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectHasherResolver hands out the hasher a project's new passwords are
// written with: the project's own choice when it made one, the deployment
// default otherwise (ADR 029 §Hashing).
//
// It is deliberately a hashing surface only. Verification keeps going through
// the deployment-wide [crypto.HashVerifier], which carries every configured
// verifier, so a password written under one project's policy stays verifiable
// after that policy changes, and existing hashes keep working when a project
// sets its first one.
type ProjectHasherResolver interface {
	// HasherForProject resolves the effective hasher at hash time, which is the
	// only moment a policy can be read honestly: a hasher held from earlier
	// would keep writing with a method the project has since changed.
	HasherForProject(ctx context.Context, projectID string) (crypto.Hasher, error)
}

// FixedProjectHasherResolver answers every project with the same hasher. It is
// the resolution for a caller that already holds the hasher it means to use and
// where no project may override it -- a bootstrap path, or a test that is about
// what gets hashed rather than about which method hashes it.
type FixedProjectHasherResolver struct {
	Hasher crypto.Hasher
}

func (r FixedProjectHasherResolver) HasherForProject(context.Context, string) (crypto.Hasher, error) {
	return r.Hasher, nil
}

type projectHasherResolver struct {
	pool    StatementPool
	factory *crypto.HasherFactory
}

// NewProjectHasherResolver resolves each project's hasher against pool, falling
// back to the deployment hasher factory's default.
//
// Nothing is cached. A resolve is one primary-key read next to a password hash
// that costs tens of milliseconds by design, so caching would buy a percent or
// two of a rare operation in exchange for a window where a project keeps
// hashing with the method its admin just replaced.
func NewProjectHasherResolver(pool StatementPool, factory *crypto.HasherFactory) ProjectHasherResolver {
	return &projectHasherResolver{pool: pool, factory: factory}
}

func (r *projectHasherResolver) HasherForProject(ctx context.Context, projectID string) (crypto.Hasher, error) {
	if projectID == "" {
		return r.factory.Default(), nil
	}

	project, err := r.pool.Statements().GetProjectByID(ctx, projectID)
	if err != nil {
		// A project that is not there cannot have chosen a policy, and the write
		// this hash is for is about to fail on its own foreign key with an error
		// that names the real problem. Answering with the default keeps that
		// error the one the caller sees.
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return r.factory.Default(), nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the project's password hashing method")
	}
	if project.PasswordHashPolicy == nil {
		return r.factory.Default(), nil
	}

	hasher, err := r.factory.New(project.PasswordHashPolicy.HasherConfig())
	if err != nil {
		// The policy was accepted when it was written, so reaching here means the
		// deployment changed under it -- an algorithm dropped from the build, a
		// verifier set narrowed. Refusing is the safe half of that: hashing with
		// the default instead would quietly write a method the project rejected.
		return nil, domain.ErrInternal(err).
			WithMessage("the project's password hashing method is no longer available on this deployment")
	}
	return hasher, nil
}
