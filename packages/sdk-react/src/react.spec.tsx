// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ZitadelLogin, ZitadelLogout } from './react';

// A representative project handle. The element still starts its flow before
// @lit/react binds this prop (see vitest.config.ts), so the expected mount-time
// rejection is ignored package-wide; these are light render assertions.
const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

afterEach(cleanup);

describe('ZitadelLogin', () => {
  it('renders a <zitadel-login> element', () => {
    const { container } = render(
      <ZitadelLogin project={project} purpose="login" />,
    );
    expect(container.querySelector('zitadel-login')).not.toBeNull();
  });
});

describe('ZitadelLogout', () => {
  it('renders a <zitadel-logout> element', () => {
    const { container } = render(<ZitadelLogout project={project} />);
    expect(container.querySelector('zitadel-logout')).not.toBeNull();
  });
});
