/**
 * Type tests for the witnesses of `describeStandardAttributes`: the package's
 * `typecheck` checks this file and nothing runs it. Each `@ts-expect-error`
 * marks a call an SDK must not get past the compiler; one that compiles fails
 * the typecheck, so widening a witness to `boolean` cannot pass unseen.
 */
import type { describeStandardAttributes, StandardAttributeGlue } from "./standard-attributes.js";

import { expectTypeOf } from "vitest";

type Forwarded = { id: string; title: string };
type Accepts = { id?: string; title?: string };
type Widgets<Login, Other = Accepts> = { login: Login; logout: Other; session: Other };

/** Props that accept both attributes and take nothing unforwarded. */
type Right = Widgets<Accepts>;
/** The login widget's props take `dir`, which no wrapper forwards. */
type TakesDir = Widgets<Accepts & { dir?: string }>;
/** The login widget's props have no `title`. */
type LacksTitle = Widgets<{ id?: string }>;

declare const run: typeof describeStandardAttributes;
declare const mountWidget: StandardAttributeGlue<Forwarded, Right>["mountWidget"];

run<Forwarded, Right>({ mountWidget, staleOnRemoval: [], accepted: true, rejected: true });

// @ts-expect-error without type arguments both witnesses are `never`
run({ mountWidget, staleOnRemoval: [], accepted: true, rejected: true });

// @ts-expect-error the login widget's props take `dir`
const takesDir: StandardAttributeGlue<Forwarded, TakesDir>["rejected"] = true;

// @ts-expect-error the login widget's props do not accept `title`
const lacksTitle: StandardAttributeGlue<Forwarded, LacksTitle>["accepted"] = true;

// The witness names the widget and the key, so the SDK's error does too.
expectTypeOf(takesDir).toEqualTypeOf<{ readonly login: "dir" }>();
expectTypeOf(lacksTitle).toEqualTypeOf<{ readonly login: "title" }>();
