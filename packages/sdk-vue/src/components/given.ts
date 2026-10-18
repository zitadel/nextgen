import { onUpdated, type Ref } from "vue";

// Property values of a freshly created, unconfigured element, per tag.
const pristine = new Map<string, HTMLElement>();

const toProperty = (key: string): string =>
  key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/**
 * Keeps unset props out of a widget element's props so the element's own
 * defaults apply. Vue assigns `undefined` to a custom-element property that is
 * passed as such, which overwrites the default (an unset `heading` left the
 * session card with an empty title), so only the given props are passed on.
 *
 * Vue also clears a prop that stops being given (to `''` or by removing the
 * attribute), not back to the element's default, so after each update the
 * element's own value is restored for every prop that was given before and is
 * unset now.
 *
 * Call it from `setup` and pass the returned function the render's props,
 * keyed as the element expects them (a camelCase property or a kebab-case
 * attribute); it returns those that are given.
 */
export function useGivenProps(
  tag: string,
  element: Ref<HTMLElement | null>,
): (props: Record<string, unknown>) => Record<string, unknown> {
  let given = new Set<string>();
  let cleared: string[] = [];

  onUpdated(() => {
    const el = element.value;
    if (!el || cleared.length === 0) return;
    let fresh = pristine.get(tag);
    if (!fresh) {
      fresh = document.createElement(tag);
      pristine.set(tag, fresh);
    }
    for (const key of cleared) {
      const property = toProperty(key);
      (el as unknown as Record<string, unknown>)[property] = (
        fresh as unknown as Record<string, unknown>
      )[property];
    }
  });

  return (props) => {
    const next = new Set<string>();
    const passed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) {
        next.add(key);
        passed[key] = value;
      }
    }
    cleared = [...given].filter((key) => !next.has(key));
    given = next;
    return passed;
  };
}
