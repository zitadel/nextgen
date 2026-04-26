import type { FrameworkId } from "../detect/framework";
import type { FrameworkAdapter } from "./index";
import { NextAdapter } from "./next/adapter";

const adapters: Record<FrameworkId, FrameworkAdapter> = {
  next: new NextAdapter(),
};

export function getAdapter(id: FrameworkId): FrameworkAdapter {
  return adapters[id];
}
