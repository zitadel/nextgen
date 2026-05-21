import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { Icon, type IconName, type IconTone } from "./icon.js";
import { cx } from "./utils.js";

/**
 * Paired React implementation of `<zl-field>`.
 * Visual spec: Figma Text Field master `4390:1404` in `8UjCXw8yemgljmbkWGrSfE`.
 */
export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label: string;
  error?: string;
  success?: string;
  invalid?: boolean;
  forgotPasswordHref?: string;
  forgotPasswordLabel?: string;
  /** When false, hides the default trailing clear / status icon. */
  trailingIcon?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  help?: ReactNode;
}

function trailingForField(
  invalid: boolean,
  showError: boolean,
  showSuccess: boolean,
): { name: IconName; tone: IconTone; clearable: boolean } {
  if (invalid || showError) {
    return { name: "alert-circle", tone: "error", clearable: false };
  }
  if (showSuccess) {
    return { name: "check", tone: "success", clearable: false };
  }
  return { name: "cross", tone: "default", clearable: true };
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    id,
    label,
    error,
    success,
    invalid = false,
    forgotPasswordHref,
    forgotPasswordLabel = "Forgot password?",
    trailingIcon = true,
    required = false,
    prefix,
    suffix,
    help,
    className,
    disabled,
    value,
    defaultValue,
    onChange,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const successId = `${inputId}-success`;
  const helpId = `${inputId}-help`;
  const showError = Boolean(error);
  const showSuccess = Boolean(success) && !showError && !invalid;
  const isDisabled = disabled === true;
  const describedBy = [showError ? errorId : null, showSuccess ? successId : null, help ? helpId : null]
    .filter(Boolean)
    .join(" ");
  const showDefaultTrailing = trailingIcon && !suffix && !isDisabled;
  const trailing = trailingForField(invalid, showError, showSuccess);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const handleClear = (): void => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    onChange?.({ target: el, currentTarget: el } as ChangeEvent<HTMLInputElement>);
    el.focus();
  };

  return (
    <div
      className={cx(
        "zr-field",
        (invalid || showError) && "zr-field--invalid",
        showSuccess && "zr-field--success",
        isDisabled && "zr-field--disabled",
        className,
      )}
    >
      {forgotPasswordHref ? (
        <div className="zr-field__label-row">
          <label className="zr-field__label" htmlFor={inputId}>
            <span>{label}</span>
            {required ? (
              <span className="zr-field__required" aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
          <a className="zr-field__link" href={forgotPasswordHref}>
            {forgotPasswordLabel}
          </a>
        </div>
      ) : (
        <label className="zr-field__label" htmlFor={inputId}>
          <span>{label}</span>
          {required ? (
            <span className="zr-field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      )}
      <div className={cx("zr-field__wrap", showDefaultTrailing && "zr-field__wrap--trailing")}>
        {prefix}
        <input
          {...rest}
          ref={inputRef}
          id={inputId}
          required={required}
          disabled={disabled}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          aria-invalid={invalid || showError ? "true" : "false"}
          aria-describedby={describedBy || undefined}
          className="zr-field__input"
        />
        {suffix}
        {showDefaultTrailing ? (
          <span className="zr-field__trailing">
            {trailing.clearable ? (
              <button
                type="button"
                className="zr-field__trailing-action"
                aria-label="Clear"
                disabled={isDisabled}
                onClick={handleClear}
              >
                <Icon name={trailing.name} size="16" tone={trailing.tone} decorative />
              </button>
            ) : (
              <Icon name={trailing.name} size="16" tone={trailing.tone} decorative />
            )}
          </span>
        ) : null}
      </div>
      {help ? (
        <div id={helpId} className="zr-field__help">
          {help}
        </div>
      ) : null}
      {showSuccess ? (
        <div id={successId} className="zr-field__success" role="status">
          {success}
        </div>
      ) : null}
      {showError ? (
        <div id={errorId} className="zr-field__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
});
