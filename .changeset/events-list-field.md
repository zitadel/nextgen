---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /events` names its list `events`, as every other list names its
resource: the page is `{ events: […], next_page_token }`
([API reference](https://preview.zitadel.com/docs/reference/api/events/listEvents)).

**Breaking:** the events of a page were under `data`. Read them from `events`
instead. In `@zitadel/api` the item type is `ListEvents200EventsItem`, and in
the Go client the field is `ListEventsResponse.Events`. `zitadel events list`
and the console read the new field, so use a CLI of this version or later
against a server that has it.
