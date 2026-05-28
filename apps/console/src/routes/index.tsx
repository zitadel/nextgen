import { createFileRoute } from "@tanstack/react-router";

import { AtomPlayground } from "../components/atom-playground.js";

export const Route = createFileRoute("/")({ component: AtomPlayground });
