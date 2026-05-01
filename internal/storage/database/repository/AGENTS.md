# Repository Agent Instructions

These instructions apply to `internal/storage/database/repository/`.

## 1. Scope Split: Relational Repositories vs Users EAV

- Use the repository pattern in this folder for traditional relational tables.
- Do not treat users as a traditional table-shaped repository entity.
- Users use the EAV model described in `docs/adrs/008-users-eav-store.md`.
- Users operation semantics follow the SQL contract examples in
  `internal/storage/database/dialect/postgres/migration/003_users/example/`
  (`create`, `put`, `patch`, `get_by_id`, `get_by_attribute`, `list`,
  `cleanup`).

## 2. Relational Repository Structure

Repository structs should expose:
- `qualifiedTableName() string`
- `PrimaryKeyColumns() []database.Column`
- `UpdatedAtColumn() database.Column` (for updatable entities)

## 3. Relational CRUD Patterns

- **Create**: Use `client.Exec` with `database.NewStatementBuilder("INSERT ...")`.
- **Read**: Use `repository.getOne[T]` or `repository.getMany[T]`.
- **Update**: Use `repository.updateOne[T]`; do not hand-build UPDATE strings.
- **Delete**: Use `repository.deleteOne[T]`.

## 4. Conditions And Changes

- Build filters with `database.And(...)`, `database.Or(...)`, and
  `database.NewTextCondition(...)` (or typed condition helpers).
- Represent scoping values such as `instance_id` as `Condition`s.
- Avoid special-casing `instance_id` as a separate method argument when the
  repository helper already accepts conditions.
- Use `database.NewChange(column, value)` for updates.

## 5. Safety Constraints

- Ensure write operations are constrained by primary key and tenant scope.
- Use `checkPKCondition(target, condition)` inside repository methods.

## 6. Relational Example (Non-User Entity)

```go
func (r *Repository) UpdateProject(ctx context.Context, id string, changes ...database.Change) error {
	cond := database.And(
		database.NewTextCondition(r.columnID, database.TextEquals, id),
		database.NewTextCondition(r.columnInstanceID, database.TextEquals, auth.InstanceID(ctx)),
	)
	_, err := updateOne[*Project](ctx, r.client, r, cond, changes...)
	return err
}
```
