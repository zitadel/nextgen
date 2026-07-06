import 'package:flutter/material.dart';
import 'package:zitadel_client/zitadel_client.dart';

/// Renders one flow step natively: the server's ordered capability arrays
/// map directly to Material widgets. No Liquid template is involved — the
/// `branding.liquid_template` the web renderer executes is HTML-only and
/// deliberately ignored here; ordering comes from the arrays themselves.
class StepRenderer extends StatelessWidget {
  const StepRenderer({
    super.key,
    required this.step,
    required this.values,
    required this.localizer,
    required this.submitting,
    required this.onValueChanged,
    required this.onAction,
    this.transportError,
    this.branding,
  });

  final FlowStep step;
  final Map<String, String> values;
  final ZitadelLocalizer localizer;
  final bool submitting;
  final void Function(String name, String value) onValueChanged;
  final void Function(String actionName) onAction;
  final String? transportError;
  final FlowBranding? branding;

  @override
  Widget build(BuildContext context) {
    final title = step.texts?.titleKey;
    final description = step.texts?.descriptionKey;
    final descriptionText = description == null ? '' : localizer.t(description);

    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (branding?.logoUrl != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 24),
              child: Image.network(
                branding!.logoUrl!,
                height: 48,
                errorBuilder: (_, __, ___) => const SizedBox.shrink(),
              ),
            ),
          if (title != null)
            Text(
              localizer.t(title),
              style: Theme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
          if (descriptionText.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                descriptionText,
                style: Theme.of(context).textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
            ),
          if (step.error != null || transportError != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: _ErrorBanner(
                message: transportError ??
                    (step.errorIsTextKey
                        ? localizer.t(step.error!)
                        : step.error!),
              ),
            ),
          for (final field in step.fields)
            _FieldWidget(
              key: ValueKey('zitadel-field-${field.name}'),
              field: field,
              stepName: step.name,
              value: values[field.name] ?? '',
              localizer: localizer,
              enabled: !submitting,
              onChanged: (value) => onValueChanged(field.name, value),
              onSubmitted: () {
                final primary = step.primaryAction;
                if (primary != null) onAction(primary.name);
              },
            ),
          const SizedBox(height: 24),
          for (final action in step.actions)
            if (action.kind != ActionKind.passkey &&
                action.kind != ActionKind.passkeyRegister)
              Padding(
                key: ValueKey('zitadel-action-${action.name}'),
                padding: const EdgeInsets.only(bottom: 8),
                child: _actionButton(action),
              ),
        ],
      ),
    );
  }

  /// `kind: submit` + `primary` gets the filled emphasis; everything else
  /// (secondary submits, `navigate`, `back`) renders as a text button.
  /// Passkey actions are filtered out above — v1 has no WebAuthn bridge
  /// (surfaced via the controller's `onUnsupportedCapability`).
  Widget _actionButton(FlowAction action) {
    final label = Text(localizer.t(action.labelKeyFor(step.name)));
    final onPressed = submitting ? null : () => onAction(action.name);
    if (action.primary && action.kind == ActionKind.submit) {
      return FilledButton(
        onPressed: onPressed,
        child: submitting
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : label,
      );
    }
    return TextButton(onPressed: onPressed, child: label);
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.errorContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: colors.onErrorContainer, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: colors.onErrorContainer),
            ),
          ),
        ],
      ),
    );
  }
}

class _FieldWidget extends StatelessWidget {
  const _FieldWidget({
    super.key,
    required this.field,
    required this.stepName,
    required this.value,
    required this.localizer,
    required this.enabled,
    required this.onChanged,
    required this.onSubmitted,
  });

  final FlowField field;
  final String stepName;
  final String value;
  final ZitadelLocalizer localizer;
  final bool enabled;
  final ValueChanged<String> onChanged;
  final VoidCallback onSubmitted;

  String get _label => localizer.t(field.textKey);

  String? get _placeholder {
    final key = '${field.textKey}.placeholder';
    return localizer.contains(key) ? localizer.t(key) : null;
  }

  @override
  Widget build(BuildContext context) {
    switch (field.type) {
      case FieldType.hidden:
        // Participates in the submitted values but never renders.
        return const SizedBox.shrink();
      case FieldType.checkbox:
        return CheckboxListTile(
          value: value == 'true',
          onChanged: enabled
              ? (checked) => onChanged(checked == true ? 'true' : 'false')
              : null,
          title: Text(_label),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
        );
      case FieldType.select:
        final options = field.validation?.enumValues ?? const <String>[];
        return Padding(
          padding: const EdgeInsets.only(top: 16),
          child: DropdownButtonFormField<String>(
            initialValue: value.isEmpty ? null : value,
            items: [
              for (final option in options)
                DropdownMenuItem(value: option, child: Text(option)),
            ],
            onChanged: enabled ? (selected) => onChanged(selected ?? '') : null,
            decoration: InputDecoration(
              labelText: _label,
              hintText: _placeholder,
              border: const OutlineInputBorder(),
            ),
          ),
        );
      case FieldType.date:
        return Padding(
          padding: const EdgeInsets.only(top: 16),
          child: TextFormField(
            key: ValueKey('zitadel-date-$stepName-${field.name}-$value'),
            initialValue: value,
            readOnly: true,
            enabled: enabled,
            decoration: InputDecoration(
              labelText: _label,
              border: const OutlineInputBorder(),
              suffixIcon: const Icon(Icons.calendar_today, size: 18),
            ),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: DateTime.tryParse(value) ?? DateTime.now(),
                firstDate: DateTime(1900),
                lastDate: DateTime(2100),
              );
              if (picked != null) {
                // ISO YYYY-MM-DD, matching what a native HTML date input
                // submits on the web path.
                onChanged(picked.toIso8601String().substring(0, 10));
              }
            },
          ),
        );
      // All remaining kinds are single-line text inputs with type-specific
      // keyboards/obscuring. Unknown future types degrade to plain text.
      case FieldType.text:
      case FieldType.email:
      case FieldType.password:
      case FieldType.tel:
      case FieldType.number:
      case FieldType.url:
      case FieldType.unknown:
        return Padding(
          padding: const EdgeInsets.only(top: 16),
          child: TextFormField(
            key: ValueKey('zitadel-input-$stepName-${field.name}'),
            initialValue: value,
            enabled: enabled,
            obscureText: field.type == FieldType.password,
            keyboardType: _keyboardType,
            autofillHints: _autofillHints,
            maxLength: field.validation?.maxLength,
            decoration: InputDecoration(
              labelText: _label,
              hintText: _placeholder,
              border: const OutlineInputBorder(),
              counterText: '',
            ),
            validator: _validate,
            autovalidateMode: AutovalidateMode.onUserInteraction,
            onChanged: onChanged,
            onFieldSubmitted: (_) => onSubmitted(),
            textInputAction: TextInputAction.next,
          ),
        );
    }
  }

  TextInputType? get _keyboardType => switch (field.type) {
        FieldType.email => TextInputType.emailAddress,
        FieldType.tel => TextInputType.phone,
        FieldType.number => TextInputType.number,
        FieldType.url => TextInputType.url,
        _ => null,
      };

  List<String>? get _autofillHints => switch (field.type) {
        FieldType.email => const [AutofillHints.email],
        FieldType.password => const [AutofillHints.password],
        FieldType.tel => const [AutofillHints.telephoneNumber],
        _ => null,
      };

  /// Client-side hints from `validation` — a UX nicety; the server
  /// re-validates on submit and is the only authority.
  String? _validate(String? input) {
    final text = input ?? '';
    if (field.required && text.isEmpty) {
      return localizer.t('error.required');
    }
    final min = field.validation?.minLength;
    if (min != null && text.isNotEmpty && text.length < min) {
      return localizer.t('error.required');
    }
    if (field.type == FieldType.email &&
        text.isNotEmpty &&
        !text.contains('@')) {
      return localizer.t('error.email_invalid');
    }
    return null;
  }
}
