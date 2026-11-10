package crypto

// InverseCrypter is an implementation of Crypter which can be used for testing
// purposes. The encrypted value is the bitwise inverse of the original.
type InverseCrypter struct {
}

func (*InverseCrypter) xor(s string) string {
	bs := []byte(s)
	for i := range bs {
		bs[i] ^= 0xFF
	}
	return string(bs)
}

func (c *InverseCrypter) Encrypt(s string) (string, error) {
	return c.xor(s), nil
}

func (c *InverseCrypter) Decrypt(s string) (string, error) {
	return c.xor(s), nil
}
