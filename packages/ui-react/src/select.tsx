import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
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
 * `8UjCXw8yemgljmbkWGrSfE`. Shares the `.zr-select` surface with the Lit atom.
 *
 * Agent-first contract (mirrors `<zl-select>`): the operable, accessible,
 * form-associated, and automatable control is a real native `<select>` carrying
 * `data-testid="zitadel-select-${name}"`. The Figma-styled trigger + popup are a
 * pointer-only visual layer (`aria-hidden`, never in the tab order), so they
 * don't duplicate the native control in the accessibility tree. Mouse users see
 * the styled popup; keyboard, screen-reader, and automation users drive the
 * native `<select>` and its native popup. Both paths converge on `value` and
 * `onChange`.
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
  /** Inline validation message shown under the control (empty = none). */
  error?: ReactNode;
  /** Force the invalid (red-edge) treatment without an `error` string. */
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  onChange?: (value: string) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    value,
    defaultValue,
    defaultOpen = false,
    placeholder = "Select…",
    name,
    required = false,
    error,
    invalid = false,
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
  const errorId = `${baseId}-error`;
  const showError = Boolean(error);
  const rootRef = useRef<HTMLDivElement>(null);
  const internalNativeRef = useRef<HTMLSelectElement | null>(null);

  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = isControlled ? value : internalValue;

  const [open, setOpen] = useState(defaultOpen);

  // Leading empty row (labelled with the placeholder) so the user can return to
  // "no selection"; for a required field it's the prompt that keeps native
  // validation blocking submit until a real choice is made. Any empty-valued
  // member the caller passed is dropped first, so a schema enum that lists ""
  // doesn't render a second, duplicate empty option (and duplicate React key).
  const listOptions: SelectOption[] = [
    { value: "", label: placeholder },
    ...options.filter((option) => option.value !== ""),
  ];
  // Empty value is "no selection", so the trigger stays on the placeholder even
  // if the caller's options include an empty member.
  const selected =
    currentValue === "" ? undefined : options.find((option) => option.value === currentValue);

  const setNativeRef = useCallback(
    (node: HTMLSelectElement | null) => {
      internalNativeRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const commitValue = useCallback(
    (next: string) => {
      if (next === currentValue) return;
      if (!isControlled) setInternalValue(next);
      onChange?.(next);
    },
    [currentValue, isControlled, onChange],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Escape closes the styled popup; stop propagation so it doesn't also
    // dismiss an enclosing dialog.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        internalNativeRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cx(
        "zr-select",
        open && "zr-select--open",
        (invalid || showError) && "zr-select--invalid",
        disabled && "zr-select--disabled",
        className,
      )}
    >
      {label !== undefined && (
        <label
          className="zr-select__label"
          id={labelId}
          onClick={() => !disabled && internalNativeRef.current?.focus()}
        >
          <span>{label}</span>
          {required && (
            <span className="zr-select__required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="zr-select__field">
        <select
          ref={setNativeRef}
          className="zr-select__native"
          id={`${baseId}-native`}
          value={currentValue}
          name={name}
          aria-labelledby={label !== undefined ? labelId : undefined}
          aria-label={label !== undefined ? undefined : ariaLabel}
          aria-invalid={invalid || showError ? "true" : "false"}
          aria-describedby={showError ? errorId : undefined}
          data-testid={name ? `zitadel-select-${name}` : testId ? `${testId}-native` : undefined}
          disabled={disabled}
          required={required}
          onChange={(event) => {
            setOpen(false);
            commitValue(event.target.value);
          }}
        >
          {listOptions.map((option) => (
            <option key={option.value || "__empty"} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <div
          className="zr-select__trigger"
          aria-hidden="true"
          onClick={() => !disabled && setOpen((current) => !current)}
        >
          <span
            className={cx("zr-select__value", !selected && "zr-select__value--placeholder")}
          >
            {selected ? selected.label : placeholder}
          </span>
          <Icon className="zr-select__icon" name="chevron-down" size="16" decorative />
        </div>
        <ul className="zr-select__listbox" aria-hidden="true" hidden={!open}>
          {listOptions.map((option) => (
            <li
              key={option.value || "__empty"}
              className="zr-select__option"
              data-value={option.value}
              data-selected={option.value === currentValue || undefined}
              data-disabled={option.disabled || undefined}
              onClick={() => {
                if (option.disabled) return;
                setOpen(false);
                commitValue(option.value);
                internalNativeRef.current?.focus();
              }}
            >
              <span className="zr-select__option-label">{option.label}</span>
              <Icon className="zr-select__option-check" name="check" size="16" decorative />
            </li>
          ))}
        </ul>
      </div>
      <div className="zr-select__error" id={errorId} role="alert" hidden={!showError}>
        {error}
      </div>
    </div>
  );
});
