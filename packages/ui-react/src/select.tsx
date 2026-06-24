import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Icon } from "./icon.js";
import { cx } from "./utils.js";

/** A single choice in a `<Select>` listbox. */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Paired React implementation of `<zl-select>`.
 * Visual spec: Figma Dropdown `4397:4816` / Items `4397:4098` in
 * `8UjCXw8yemgljmbkWGrSfE`. Follows the WAI-ARIA select-only combobox pattern:
 * focus stays on the trigger and `aria-activedescendant` tracks the active
 * option. Shares the `.zr-select` surface with the Lit atom.
 */
export interface SelectProps {
  /** Visible label; when omitted, pass `aria-label` for an accessible name. */
  label?: ReactNode;
  options: SelectOption[];
  /** Controlled selected value. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  /** Initial open state when uncontrolled (e.g. a story preview of the menu). */
  defaultOpen?: boolean;
  placeholder?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  onChange?: (value: string) => void;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    label,
    options,
    value,
    defaultValue,
    defaultOpen = false,
    placeholder = "Select…",
    name,
    required = false,
    disabled = false,
    className,
    "aria-label": ariaLabel,
    "data-testid": testId,
    onChange,
  },
  ref,
) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listboxId = `${baseId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);

  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = isControlled ? value : internalValue;

  const [open, setOpen] = useState(defaultOpen);
  // No active cursor until the user navigates — matches the Lit atom's forced-open
  // preview, so a pre-selected row shows its solid "selected" fill rather than the
  // keyboard-active wash.
  const [activeIndex, setActiveIndex] = useState(-1);

  const selected = options.find((option) => option.value === currentValue);
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      internalTriggerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const firstEnabledIndex = useCallback(
    () => options.findIndex((option) => !option.disabled),
    [options],
  );

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    internalTriggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    if (options.length === 0) return;
    setOpen(true);
    const selectedIndex = options.findIndex((option) => option.value === currentValue);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex());
  }, [options, currentValue, firstEnabledIndex]);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      if (option.value !== currentValue) {
        if (!isControlled) setInternalValue(option.value);
        onChange?.(option.value);
      }
      setOpen(false);
      setActiveIndex(-1);
      internalTriggerRef.current?.focus();
    },
    [options, currentValue, isControlled, onChange],
  );

  const moveActive = useCallback(
    (delta: number) => {
      const count = options.length;
      if (count === 0) return;
      setActiveIndex((current) => {
        let next = current;
        for (let step = 0; step < count; step += 1) {
          next = (next + delta + count) % count;
          if (!options[next]?.disabled) return next;
        }
        return current;
      });
    },
    [options],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open) openMenu();
        else moveActive(event.key === "ArrowDown" ? 1 : -1);
        break;
      case "Home":
        if (open) {
          event.preventDefault();
          setActiveIndex(firstEnabledIndex());
        }
        break;
      case "End":
        if (open) {
          event.preventDefault();
          for (let index = options.length - 1; index >= 0; index -= 1) {
            if (!options[index]?.disabled) {
              setActiveIndex(index);
              break;
            }
          }
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) commit(activeIndex);
        else openMenu();
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          close();
        }
        break;
      case "Tab":
        if (open) {
          setOpen(false);
          setActiveIndex(-1);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className={cx(
        "zr-select",
        open && "zr-select--open",
        disabled && "zr-select--disabled",
        className,
      )}
    >
      {label !== undefined && (
        <label
          className="zr-select__label"
          id={labelId}
          onClick={() => !disabled && internalTriggerRef.current?.focus()}
        >
          <span>{label}</span>
          {required && (
            <span className="zr-select__required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {name !== undefined && currentValue !== "" && (
        <input type="hidden" name={name} value={currentValue} />
      )}
      <div className="zr-select__field">
        <button
          ref={setTriggerRef}
          type="button"
          className="zr-select__trigger"
          id={`${baseId}-trigger`}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={label !== undefined ? labelId : undefined}
          aria-label={label !== undefined ? undefined : ariaLabel}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          data-testid={name ? `zitadel-select-${name}` : testId ? `${testId}-trigger` : undefined}
          disabled={disabled}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={handleKeyDown}
        >
          <span
            className={cx("zr-select__value", !selected && "zr-select__value--placeholder")}
          >
            {selected ? selected.label : placeholder}
          </span>
          <Icon className="zr-select__icon" name="chevron-down" size="16" decorative />
        </button>
        <ul
          className="zr-select__listbox"
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={label !== undefined ? labelId : undefined}
          hidden={!open}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              className="zr-select__option"
              id={optionId(index)}
              role="option"
              aria-selected={option.value === currentValue}
              aria-disabled={option.disabled || undefined}
              data-active={open && index === activeIndex ? "true" : undefined}
              data-value={option.value}
              onClick={() => commit(index)}
              onPointerMove={() => {
                if (!option.disabled && index !== activeIndex) setActiveIndex(index);
              }}
            >
              <span className="zr-select__option-label">{option.label}</span>
              <Icon className="zr-select__option-check" name="check" size="16" decorative />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});
