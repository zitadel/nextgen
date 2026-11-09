---
title: Set every property of a user schema in the console
summary: The console's Add user and user edit forms now build their controls from the whole user schema, nested objects, arrays, nullable types and enums included.
date: 2026-11-04T13:55Z
cloud: true
pulls: [2686]
---

The console's Add user and user edit forms now build their controls from the whole user schema, including nested objects, arrays, nullable types and enums, so you can create and edit a user whatever their schema holds.

- The schema's rules show as help on the field they apply to, and an error shows on the field it concerns.
- The identifier is marked, each label names its API property on hover, and objects can be collapsed.
- A property no control can write points you to the CLI or the API.
