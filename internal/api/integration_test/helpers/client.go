package helpers

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
)

type FakeSecuritySource struct {
	Token  string
	Scopes []string

	Username string
	Password string
	Roles    []string
}

func (f FakeSecuritySource) OAuth2(ctx context.Context, operationName api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{
		Token:  f.Token,
		Scopes: f.Scopes,
	}, nil
}

func (f FakeSecuritySource) UsernamePassword(ctx context.Context, operationName api.OperationName) (api.UsernamePassword, error) {
	return api.UsernamePassword{
		Username: f.Username,
		Password: f.Password,
		Roles:    f.Roles,
	}, nil
}

var _ api.SecuritySource = (*FakeSecuritySource)(nil)

type AnonymousSecuritySource struct {
}

func (f AnonymousSecuritySource) OAuth2(ctx context.Context, operationName api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{}, nil
}

func (f AnonymousSecuritySource) UsernamePassword(ctx context.Context, operationName api.OperationName) (api.UsernamePassword, error) {
	return api.UsernamePassword{}, nil
}

var _ api.SecuritySource = (*FakeSecuritySource)(nil)

type ApiClient struct {
	*api.Client
	securitySource *FakeSecuritySource
}

func NewApiClient(
	serverURL string,
) (*ApiClient, error) {
	securitySource := &FakeSecuritySource{}
	client, err := api.NewClient(serverURL, securitySource)
	if err != nil {
		return nil, err
	}
	return &ApiClient{
		Client:         client,
		securitySource: securitySource,
	}, nil
}

func (c *ApiClient) SetToken(token string) {
	c.securitySource.Token = token
}
func (c *ApiClient) SetScopes(scopes []string) {
	c.securitySource.Scopes = scopes
}
func (c *ApiClient) SetUsername(username string) {
	c.securitySource.Username = username
}
func (c *ApiClient) SetPassword(password string) {
	c.securitySource.Password = password
}
func (c *ApiClient) SetRoles(roles []string) {
	c.securitySource.Roles = roles
}
