# Schema validation

Schema's are validated when they are submitted through the POST endpoint. If
the body of the request is an url, the schema is fetched and validated.

Once the schema is validated, it is stored in the database. When an instance
is later created, the instance is validated against the schema stored in the
database.
