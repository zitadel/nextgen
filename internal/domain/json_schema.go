package domain

import (
	"net/url"
)

const SchemaRootUrl = "https://zitadel.com/schemas/"
const UserMetaSchemaRootUrl = SchemaRootUrl + "user/"

func CreateSchemaUrlFromId(id string) (*url.URL, error) {
	return url.Parse(SchemaRootUrl + id + ".json")
}
