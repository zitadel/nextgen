"""Schemathesis hooks for the API contract lane, loaded through SCHEMATHESIS_HOOKS.

A page token is opaque: only one the server issued is valid, and Schemathesis
can only invent a string, or take the schema's illustrative `example`. The
server refuses either with 400, so a valid-looking request that carried one
would look like a wrong answer. The lane therefore never sends a page token in
a request meant to be valid: each list and query asks for its first page.
Requests meant to be invalid (the negative cases) are left as generated, and a
bad token there is refused, as it should be.

The hooks apply to any parameter or body property named `page_token`, so a new
paged operation needs nothing here.
"""

import schemathesis


def _integers(value):
    # Schemathesis writes an integer as `79.0` when it likes, which is valid JSON
    # Schema but not a number the server's decoder reads as an integer. Only a
    # float that an integer holds exactly is converted.
    if isinstance(value, float) and value.is_integer() and abs(value) < 2**53:
        return int(value)
    if isinstance(value, list):
        return [_integers(item) for item in value]
    if isinstance(value, dict):
        return {key: _integers(item) for key, item in value.items()}
    return value


def _without_page_token(case):
    if isinstance(case.query, dict):
        case.query.pop("page_token", None)
    if isinstance(case.body, dict):
        case.body.pop("page_token", None)
    return case


@schemathesis.hook
def map_case(ctx, case):
    generation = getattr(getattr(case, "meta", None), "generation", None)
    if str(getattr(generation, "mode", "")) == "negative":
        return case
    case.body = _integers(case.body)
    return _without_page_token(case)


@schemathesis.hook
def before_add_examples(ctx, examples):
    # The examples phase takes the schema's `example` values, which for a page
    # token is a made-up string, and it does not pass through `map_case`.
    for case in examples:
        _without_page_token(case)

# experiment: shards=12 noshrink=0
