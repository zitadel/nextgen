package domain

type UserPassword struct{}

func (u *UserPassword) Verify(password string) error {
	return nil
}
