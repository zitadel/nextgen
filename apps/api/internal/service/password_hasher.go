package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectHasherResolver hands out the hasher a project's passwords are written
// with: the project's own choice when it made one, the deployment default
// otherwise (ADR 029 §Hashing).
//
// Every hasher it hands out carries every configured verifier, so a password
// written under one project's policy stays verifiable after that policy
// changes, and existing hashes keep working when a project sets its first one.
// Verifying with the project's hasher is what moves an outdated hash to the
// project's method rather than the deployment default.
type ProjectHasherResolver interface {
	// HasherForProject resolves the effective hasher at use time, which is the
	// only moment a policy can be read honestly: a hasher held from earlier
	// would keep writing with a method the project has since changed.
	HasherForProject(ctx context.Context, projectID string) (crypto.PasswordHasher, error)
}

// FixedProjectHasherResolver answers every project with the same hasher. It is
// the resolution for a caller that already holds the hasher it means to use and
// where no project may override it -- a bootstrap path, or a test that is about
// what gets hashed rather than about which method hashes it.
type FixedProjectHasherResolver struct {
	Hasher crypto.PasswordHasher
}

func (r FixedProjectHasherResolver) HasherForProject(context.Context, string) (crypto.PasswordHasher, error) {
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
// that costs tens of milliseconds by design, so caching would save a percent or
// two of each sign-in or password write, in exchange for a window where a
// project keeps hashing with the method its admin just replaced.
func NewProjectHasherResolver(pool StatementPool, factory *crypto.HasherFactory) ProjectHasherResolver {
	return &projectHasherResolver{pool: pool, factory: factory}
}

func (r *projectHasherResolver) HasherForProject(ctx context.Context, projectID string) (crypto.PasswordHasher, error) {
	if projectID == "" {
		return r.factory.Default(), nil
	}

	project, err := r.pool.Statements().GetProjectByID(ctx, projectID)
	if err != nil {
		// A project that is not there cannot have chosen a policy. A password
		// write for it fails on its own foreign key with an error that names the
		// real problem, and a sign-in reads the password first, so it fails on
		// that read. Answering with the default keeps those errors the ones the
		// caller sees.
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return r.factory.Default(), nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the project's password hashing method")
	}
	if project.PasswordHashPolicy == nil {
		return r.factory.Default(), nil
	}

	// New builds any policy that parses, so Check holds it to the verifiers and
	// limits the deployment has now.
	cfg := project.PasswordHashPolicy.HasherConfig()
	hasher, err := r.factory.New(cfg)
	if err == nil {
		err = r.factory.Check(cfg)
	}
	if err != nil {
		// The policy was accepted when it was written, so reaching here means the
		// deployment changed under it -- an algorithm dropped from the build, a
		// verifier set narrowed, limits moved. Refusing is the safe half of that:
		// hashing with the default instead would quietly write a method the
		// project rejected.
		return nil, domain.ErrInternal(err).
			WithMessage("the project's password hashing method is not allowed by this deployment's configuration")
	}
	return hasher, nil
}
