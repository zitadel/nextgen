---
"@zitadel/sdk-react": minor
---

The package is now marked `"use client"`, so a Next.js App Router server component can render the
widgets. `ZitadelLogout` accepts `children` in its types (for the logout `<template>`), and props are forwarded as given, so clearing one restores the widget's default.
