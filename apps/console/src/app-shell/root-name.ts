import { Boxes, Hexagon, type LucideIcon } from "lucide-react";

/**
 * What the root is called (D44): the platform, for someone who may act on the
 * reserved platform project, whose screens it holds (D42).
 */
export const PLATFORM = "Platform";

/**
 * The root for anyone else, whose root holds only their projects, and the
 * name of Projects, the list of them, wherever the console opens it.
 */
export const ALL_PROJECTS = "All projects";

/** The root's name in the bar, and its glyph. */
export function rootName(platform: string | undefined): { label: string; Icon: LucideIcon } {
  return platform ? { label: PLATFORM, Icon: Hexagon } : { label: ALL_PROJECTS, Icon: Boxes };
}
