# Authentication experience

> **Status:** Product vision  
> **Tracks:** [#678 — Customise the authentication experience](https://github.com/zitadel/nextgen/issues/678)

## Vision

Authentication should feel like a natural part of the customer’s product rather than a separate Zitadel experience.

Zitadel provides complete, secure authentication capabilities and multiple ways to present them. Customers can embed Zitadel login components in their application, use a standalone login served by Zitadel, or build and operate their own frontend.

Within each model, customers choose the level of customisation that fits their product and use case.

## Mental model

> **One authentication foundation, multiple presentation choices, and the freedom to take more control over time.**

| Model | Zitadel provides | Customer controls |
|---|---|---|
| **Customer-embedded login** | Login components, authentication journeys and security controls | The application around the components and supported component customisation |
| **Zitadel-served login** | A complete standalone login experience | The supported branding, content and authentication configuration |
| **Fully custom frontend** | Authentication APIs, policies and backend security enforcement | The complete frontend experience |

These models share the same authentication foundation, but they are not one presentation or customisation surface.

Where applicable, customers should be able to reuse branding, content and authentication configuration across embedded and Zitadel-served login. The exact customisation available for each model is defined separately.

These are choices rather than a required progression. Customers can select the model that fits their needs and change their approach over time.

## Target users and customer use cases

### Target users

The people creating, reviewing or operating the authentication experience include:

- **Developers** who want to launch and maintain authentication without building every part of the UI themselves.
- **Product and design teams** who want authentication to match the rest of their product.
- **Platform and identity teams** who manage authentication consistently across applications, products or brands.
- **Security, legal and compliance teams** who need the experience to meet organisational and regulatory requirements.

### Common use cases

Across these groups, customers need to:

1. Launch a professional authentication experience with minimal effort.
2. Match authentication to their product’s branding, content and interaction patterns.
3. Preview and safely publish changes across complete authentication journeys.
4. Maintain consistency while adapting the experience across applications, products, brands or customers.
5. Meet localisation, accessibility, legal, security and compliance requirements.
6. Take full ownership of the frontend when the Zitadel-provided experience is insufficient.

## Delivery models

### Customer-embedded login

Customers embed the Zitadel login components into their own application.

Zitadel provides and maintains the authentication journeys and security controls within the components. The customer controls the application around them, including the wider page layout, backgrounds, navigation and product content.

During onboarding, Zitadel may provide a complete starting page for a new application. The login components remain maintained by Zitadel, while the generated page around them becomes part of the customer’s application.

In an existing application, Zitadel adds the login components without replacing the application’s existing layout.

This model primarily serves developer-led products that control their frontend and want authentication to feel native within their product.

### Zitadel-served login

Zitadel presents authentication as a complete standalone login experience.

Customers can use it without embedding login components into every application. This model primarily serves customers with multiple applications, third-party or legacy applications, enterprise SSO requirements, or a preference for a centrally operated login experience.

Zitadel-served login uses the same underlying authentication capabilities and journeys as the embedded components. Its exact branding, content and page-level customisation are defined in a separate delivery milestone.

Where applicable, customers should be able to reuse existing branding, content and authentication configuration rather than configuring the experience again.

“Zitadel-served” describes who presents the login experience. It is independent of whether Zitadel itself is operated in Zitadel Cloud or by the customer.

### Fully custom frontend

Customers requiring complete ownership can build and operate their own authentication frontend using Zitadel’s supported APIs.

They own its design, implementation, accessibility, localisation, testing, deployment and maintenance. Zitadel continues to provide authentication APIs, policies and backend security enforcement.

## Customising the embedded login components

Customers can use the maintained Zitadel components as provided or customise them to match their application.

They can customise:

| Area | What customers can change |
|---|---|
| **Appearance** | Brand assets, colours, typography and other supported visual choices |
| **Voice** | Headings, descriptions, labels, guidance and other supported authentication text |
| **Structure** | Supported arrangement, grouping and content within the components |
| **Behaviour** | Supported authentication journeys, methods, steps and fields through Zitadel login flows |

The customer controls the application around the components separately, including its page layout, backgrounds, navigation, imagery and product content.

Customers should be able to manage supported component customisation through the available visual or code-based experience without creating incompatible versions of the authentication experience.

The exact options included in the first visual customisation milestone are defined in #936.

## Embedded customer journey

Customers may start with a new application or introduce Zitadel into an existing product.

### Get authentication working

| New application | Existing application |
|---|---|
| Start with a complete application page containing the maintained Zitadel components. | Add the maintained Zitadel components without replacing the existing application experience. |
| Keep the provided page or change it as part of the application. | Place the components within the application’s existing layout and design. |
| Use the maintained components or customise them immediately. | Use the maintained components or customise them immediately. |
| Test the complete supported authentication journeys. | Test the complete supported authentication journeys before switching users to them. |

### Make the components yours

Customers can:

1. Use the maintained component appearance, voice and structure without modification.
2. Apply their brand assets, colours and typography.
3. Adapt supported headings, descriptions, labels and guidance.
4. Adjust supported arrangement, grouping and content within the components.
5. Configure the supported authentication journeys, methods, steps and fields through Zitadel login flows.
6. Preview the experience across supported journeys, states, errors and screen sizes.
7. Build a fully custom frontend if they require complete control beyond the Zitadel-provided components.

Changes to the surrounding page are made and tested as part of the customer’s application.

### Test and release component customisation

Customers can:

1. Save customisation changes without affecting the experience currently in use.
2. Preview supported authentication journeys, including relevant validation and error states.
3. Check the experience at relevant screen sizes.
4. Identify and correct invalid or incomplete customisation before publishing.
5. Review appearance, voice and structure together.
6. Clearly distinguish the version being edited from the version currently in use.
7. Publish the approved component customisation.
8. Return later to update it or restore the maintained Zitadel components.

### Expand and evolve

Customers can:

- Reuse component customisation across relevant applications.
- Maintain consistency while supporting relevant product, brand or customer variations.
- Update the component experience as Zitadel adds authentication journeys, methods and states.
- Change their presentation model where appropriate.
- Build a fully custom frontend if their requirements no longer fit the Zitadel-provided components.

## Zitadel-served customer journey

The detailed Zitadel-served journey is defined separately.

At a minimum, customers should be able to:

1. Use a complete, polished standalone login experience without building or operating the frontend.
2. Configure the supported authentication journeys and methods.
3. Apply supported branding and content.
4. Preview and safely make changes available to users.
5. Use the experience across applications that rely on a centrally served login.
6. Reuse compatible configuration from the embedded experience where applicable.

Advanced customisation of the standalone page is a separate capability and is not required to provide the initial Zitadel-served experience.

## Security and responsibility boundaries

Visual customisation does not grant control over Zitadel’s authentication logic or security requirements.

The embedded Zitadel components operate within a restricted customisation boundary. Customers can change supported presentation and content, but cannot remove or bypass mandatory authentication controls, validation, policies or security-relevant journey steps.

Customers who choose a fully custom frontend accept the additional implementation and security responsibilities associated with owning the complete presentation.

| Model | Zitadel responsibility | Customer responsibility |
|---|---|---|
| **Customer-embedded login** | Secure components, mandatory controls, supported authentication journeys, accessibility baseline and supported translations | The surrounding application, chosen branding and content, and accessibility of their changes |
| **Zitadel-served login** | The complete served experience, secure rendering, mandatory controls, supported journeys, accessibility baseline and supported translations | Chosen branding, content and authentication configuration |
| **Fully custom frontend** | Authentication APIs, policies and backend security enforcement | Frontend security, rendering, accessibility, localisation, testing and maintenance |

## Experience principles

- **Working by default** — customers can use a polished, secure authentication experience without first making advanced decisions.
- **Choice of presentation** — customers can choose embedded components, Zitadel-served login or a fully custom frontend based on their needs.
- **Choice of customisation** — customers using the embedded components can keep the maintained experience or customise supported appearance, voice, structure and behaviour.
- **Freedom to evolve** — customers can change their approach over time while retaining reusable configuration where applicable.
- **Complete and inclusive journeys** — Zitadel provides accessible and localised journeys by default. Customers remain responsible for ensuring their own application and customisations preserve that experience.
- **Safe to change** — customers can preview, validate, test, publish and restore changes before they affect users.
- **Reusable and adaptable** — customers can maintain consistency while supporting relevant variations across applications, products, brands or customers.
- **Clear ownership and responsibility** — customers understand what Zitadel maintains and what they own under each presentation model.

## Delivery direction

### 1. Establish the embedded foundation

- Provide complete, maintained embeddable login components.
- Give new applications a complete starting page containing the components.
- Fit the components into existing applications without replacing their surrounding experience.
- Support customisation of component appearance, voice and supported structure.
- Support configuration of authentication behaviour through Zitadel login flows.
- Support preview and safe publishing across complete authentication journeys.

This establishes the first presentation model and the shared authentication foundation.

### 2. Provide Zitadel-served login for the broad public launch

- Provide a complete standalone login experience.
- Serve customers and applications where embedding is not appropriate.
- Support the required branding, content and authentication configuration.
- Reuse compatible configuration from the embedded experience where applicable.
- Provide a polished experience without requiring advanced page-level customisation.

### 3. Expand customisation and management

- Expand the supported customisation of embedded components.
- Define and expand customisation of the Zitadel-served experience.
- Support management and relevant variations across applications, products, brands or customers.
- Continue improving preview, testing, publishing and restoration.

### 4. Support full ownership

- Provide supported APIs for fully custom authentication frontends.
- Clearly define security, compatibility and support responsibilities.

## Delivery tickets

- [ ] #936 — Visually customise and preview the embedded Zitadel login components
- [ ] Follow-up — Provide Zitadel-served login
- [ ] Follow-up — Define and deliver customisation of the Zitadel-served login
