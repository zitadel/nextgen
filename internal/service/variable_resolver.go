package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
)

// VariableResolver reads the variables one owner entered with their secrets in
// clear.
//
// It must never back an API response: no endpoint returns a secret in clear.
// It exists for server-side consumers that use the value itself, such as the
// SSO flow presenting a client secret to a provider. The API handler holds a
// [VariableService] and is deliberately never given a resolver, so a decrypted
// value cannot reach a response by construction.
type VariableResolver interface {
	// GetDecryptedVariables is [VariableService.GetVariables] with every secret
	// decrypted and still marked as one, so a caller can redact what it must
	// not print.
	GetDecryptedVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, names ...string) ([]*domain.Variable, error)
	ReplaceVariablesInPlace(ctx context.Context, owner domain.VariableOwner, doc map[string]any) error
}

type variableResolver struct {
	v2Pool *DB
	keys   KeyService
}

func NewVariableResolver(
	v2Pool *DB,
	keys KeyService,
) VariableResolver {
	return &variableResolver{
		v2Pool: v2Pool,
		keys:   keys,
	}
}

func (r *variableResolver) GetDecryptedVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, names ...string) ([]*domain.Variable, error) {
	variables, err := getVariablesOfKinds(ctx, r.v2Pool.Statements(), owner, kind, names...)
	if err != nil {
		return nil, err
	}

	// Built once and shared, so several secrets under one key cost one lookup;
	// built lazily, so a read holding no secret never reaches the key service.
	var decrypter crypto.Decrypter

	decrypted := make([]*domain.Variable, 0, len(variables))
	for _, variable := range variables {
		if !variable.IsSecret {
			decrypted = append(decrypted, variable)
			continue
		}
		if decrypter == nil {
			decrypter = decrypterOfWritingKey(ctx, r.keys)
		}
		value, err := variable.GetDecryptedValue(decrypter)
		if err != nil {
			return nil, domain.ErrFailedToDecryptVariable(err).WithDetails(map[string]any{"name": variable.Name})
		}
		decrypted = append(decrypted, &domain.Variable{
			Name:     variable.Name,
			Owner:    variable.Owner,
			Kind:     variable.Kind,
			Value:    value,
			IsSecret: true,
		})
	}
	return decrypted, nil
}

func (r *variableResolver) ReplaceVariablesInPlace(ctx context.Context, owner domain.VariableOwner, doc map[string]any) error {
	placeholders, err := domain.ScanDocumentForVariables(doc)
	if err != nil {
		return err
	}
	if len(placeholders) == 0 {
		return nil
	}

	// One name per query term, however many placeholders reference it.
	variableNames := make([]string, 0, len(placeholders))
	seen := make(map[string]bool, len(placeholders))
	for _, placeholder := range placeholders {
		if seen[placeholder.VariableName] {
			continue
		}
		seen[placeholder.VariableName] = true
		variableNames = append(variableNames, placeholder.VariableName)
	}

	// Resolved against the primary rows: which kind a document resolves
	// against is the deployment's, and resolving from the set a deployment
	// froze is still to come. Until then the primary values are the ones a
	// document sees.
	varList, err := r.v2Pool.Statements().GetVariables(ctx, owner, domain.DeploymentOriginKindPrimary, variableNames...)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to get variables from database")
	}
	varMap := domain.VariableListToMap(varList)

	if err := domain.ValidateSecretPlaceholders(placeholders, varMap); err != nil {
		return err
	}

	var containsSecrets bool
	for _, v := range varMap {
		if v.IsSecret {
			containsSecrets = true
			break
		}
	}

	if containsSecrets {
		varMap, err = domain.Variables(varMap).DecryptAll(decrypterOfWritingKey(ctx, r.keys))
		if err != nil {
			return err
		}
	}

	if err := domain.ReplaceVariables(placeholders, varMap); err != nil {
		return err
	}

	return nil
}
