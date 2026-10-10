import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let mockIsPending = false;
let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useTransition: () => [
      mockIsPending,
      (fn: () => void | Promise<void>) => {
        void fn();
      },
    ],
    useState: <T,>(initial: T): [T, (val: T) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [val, vi.fn()];
      }
      return actual.useState(initial);
    },
  };
});

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    `translated-${key}${values ? JSON.stringify(values) : ''}`,
}));

let mockSearchParams = new URLSearchParams();
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => mockSearchParams,
}));

let mockIsWebAuthnSupported = true;
vi.mock('@/lib/webauthn-client', () => ({
  isWebAuthnSupported: () => mockIsWebAuthnSupported,
  base64UrlToBuffer: () => new ArrayBuffer(0),
  bufferToBase64Url: () => 'mock-b64',
}));

vi.mock('@/server/auth/guards', () => ({
  requireOwner: vi.fn().mockResolvedValue({
    user: { id: 'test-user', role: 'owner' },
  }),
}));

const {
  mockGetMfaStatusAction,
  mockListPasskeysAction,
  mockListActiveSessionsAction,
  mockStartTotpEnrolmentAction,
  mockVerifyAndEnableTotpAction,
  mockDisableTotpAction,
  mockRegenerateRecoveryCodesAction,
  mockStartPasskeyRegistrationAction,
  mockCompletePasskeyRegistrationAction,
  mockDeletePasskeyAction,
  mockPostponeMfaAction,
  mockRevokeSessionByIdAction,
  mockReauthenticateAction,
  mockSignOutEverywhereAction,
} = vi.hoisted(() => ({
  mockGetMfaStatusAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      totpEnabled: false,
      passkeyCount: 0,
      recoveryCodesRemaining: 0,
      mfaRequired: false,
      mfaPostponedUntil: null,
      hasMfa: false,
    },
  }),
  mockListPasskeysAction: vi.fn().mockResolvedValue({ success: true, data: [] }),
  mockListActiveSessionsAction: vi.fn().mockResolvedValue({
    success: true,
    data: [
      {
        id: 'sess-1',
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent',
        createdAt: new Date(),
        lastReauthenticatedAt: new Date(),
        isCurrent: true,
      },
    ],
  }),
  mockStartTotpEnrolmentAction: vi.fn(),
  mockVerifyAndEnableTotpAction: vi.fn(),
  mockDisableTotpAction: vi.fn(),
  mockRegenerateRecoveryCodesAction: vi.fn(),
  mockStartPasskeyRegistrationAction: vi.fn(),
  mockCompletePasskeyRegistrationAction: vi.fn(),
  mockDeletePasskeyAction: vi.fn(),
  mockPostponeMfaAction: vi.fn(),
  mockRevokeSessionByIdAction: vi.fn(),
  mockReauthenticateAction: vi.fn(),
  mockSignOutEverywhereAction: vi.fn(),
}));

vi.mock('@/server/auth/mfa-actions', () => ({
  getMfaStatusAction: mockGetMfaStatusAction,
  listPasskeysAction: mockListPasskeysAction,
  listActiveSessionsAction: mockListActiveSessionsAction,
  startTotpEnrolmentAction: mockStartTotpEnrolmentAction,
  verifyAndEnableTotpAction: mockVerifyAndEnableTotpAction,
  disableTotpAction: mockDisableTotpAction,
  regenerateRecoveryCodesAction: mockRegenerateRecoveryCodesAction,
  startPasskeyRegistrationAction: mockStartPasskeyRegistrationAction,
  completePasskeyRegistrationAction: mockCompletePasskeyRegistrationAction,
  deletePasskeyAction: mockDeletePasskeyAction,
  postponeMfaAction: mockPostponeMfaAction,
  revokeSessionByIdAction: mockRevokeSessionByIdAction,
  reauthenticateAction: mockReauthenticateAction,
}));

vi.mock('@/server/auth/actions', () => ({
  signOutEverywhereAction: mockSignOutEverywhereAction,
}));

import { SecuritySettingsView } from '@/components/settings/security-settings-view';
import SecuritySettingsPage from '@/app/[locale]/settings/security/page';

function findButtonByTestId(
  element: React.ReactElement,
  testId: string,
): { onClick?: () => void | Promise<void> } | undefined {
  let found: { onClick?: () => void | Promise<void> } | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (props['data-testid'] === testId && typeof props.onClick === 'function') {
        found = { onClick: props.onClick as () => void | Promise<void> };
        return;
      }
      if (props.children) {
        traverse(props.children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    }
  }
  traverse(element);
  return found;
}

function findFormByTestId(
  element: React.ReactElement,
  testId: string,
): { onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void> } | undefined {
  let found: { onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void> } | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (props['data-testid'] === testId && typeof props.onSubmit === 'function') {
        found = {
          onSubmit: props.onSubmit as (e: { preventDefault: () => void }) => void | Promise<void>,
        };
        return;
      }
      if (props.children) {
        traverse(props.children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    }
  }
  traverse(element);
  return found;
}

function findForms(
  element: React.ReactElement,
): { onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void> }[] {
  const forms: { onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void> }[] = [];
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      if (node.type === 'form') {
        forms.push(
          node.props as { onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void> },
        );
      }
      const props = node.props as { children?: unknown };
      if (props.children) {
        traverse(props.children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    }
  }
  traverse(element);
  return forms;
}

describe('SecuritySettingsView Component', () => {
  const baseStatus = {
    totpEnabled: false,
    passkeyCount: 0,
    recoveryCodesRemaining: 0,
    mfaRequired: false,
    mfaPostponedUntil: null,
    hasMfa: false,
  };

  const samplePasskeys = [
    {
      id: 'pk-1',
      name: 'YubiKey 5C',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      lastUsedAt: new Date('2026-01-02T12:00:00Z'),
    },
  ];

  const sampleSessions = [
    {
      id: 'sess-1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      lastReauthenticatedAt: new Date('2026-01-01T10:00:00Z'),
      isCurrent: true,
    },
    {
      id: 'sess-2',
      ipAddress: '10.0.0.1',
      userAgent: 'Mobile Safari',
      createdAt: new Date('2026-01-01T08:00:00Z'),
      lastReauthenticatedAt: new Date('2026-01-01T08:00:00Z'),
      isCurrent: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockIsPending = false;
    mockStateQueue = [];
    mockIsWebAuthnSupported = true;
  });

  it('renders security settings with unconfigured MFA state', () => {
    mockSearchParams = new URLSearchParams();
    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={baseStatus}
        initialPasskeys={[]}
        initialSessions={sampleSessions}
        locale="en"
      />,
    );

    expect(html).toContain('translated-title');
    expect(html).toContain('translated-totpTitle');
    expect(html).toContain('translated-enableTotp');
    expect(html).toContain('translated-noPasskeys');
    expect(html).toContain('translated-currentSession');
    expect(html).toContain('translated-revokeSession');
  });

  it('renders security settings with active TOTP and registered passkeys', () => {
    mockSearchParams = new URLSearchParams();
    const activeStatus = {
      totpEnabled: true,
      passkeyCount: 1,
      recoveryCodesRemaining: 8,
      mfaRequired: true,
      mfaPostponedUntil: null,
      hasMfa: true,
    };

    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={activeStatus}
        initialPasskeys={samplePasskeys}
        initialSessions={sampleSessions}
        locale="en"
      />,
    );

    expect(html).toContain('translated-totpActive');
    expect(html).toContain('translated-disableTotp');
    expect(html).toContain('translated-regenerateRecoveryCodes');
    expect(html).toContain('YubiKey 5C');
    expect(html).toContain('translated-deletePasskey');
  });

  it('renders forced MFA enrolment alert banner when mfa_enforced query param is present', () => {
    mockSearchParams = new URLSearchParams('mfa_enforced=1');
    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={baseStatus}
        initialPasskeys={[]}
        initialSessions={[]}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="mfa-enforcement-alert"');
    expect(html).toContain('translated-mfaEnforcedAlert');
    expect(html).toContain('translated-postponeBtn');
  });

  it('renders postponement info when mfaPostponedUntil is in the future', () => {
    mockSearchParams = new URLSearchParams('mfa_enforced=1');
    const postponedStatus = {
      ...baseStatus,
      mfaPostponedUntil: new Date('2026-12-31T23:59:59Z'),
    };

    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={postponedStatus}
        initialPasskeys={[]}
        initialSessions={[]}
        locale="en"
      />,
    );

    expect(html).toContain('translated-mfaPostponeNotice');
  });

  it('renders SecuritySettingsPage server component', async () => {
    const pageEl = await SecuritySettingsPage({
      params: Promise.resolve({ locale: 'en' }),
    });

    const html = renderToStaticMarkup(pageEl);
    expect(html).toContain('translated-title');
  });

  it('renders TOTP enrolment modal with QR code, manual secret, and copy secret button', () => {
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      true, // enrollingTotp
      'JBSWY3DPEHPK3PXP', // totpSecret
      '<svg><rect width="100" height="100"/></svg>', // totpQrSvg
      '123456', // verifyCode
      true, // copiedSecret
      null, // recoveryCodes
      false, // copiedCodes
      false, // registeringPasskey
      '', // passkeyName
      false, // reauthModalOpen
      '', // reauthPassword
      null, // pendingAction
      null, // error
      null, // successMessage
    ];

    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={baseStatus}
        initialPasskeys={[]}
        initialSessions={sampleSessions}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="totp-enrolment-panel"');
    expect(html).toContain('data-testid="totp-qr-code"');
    expect(html).toContain('data-testid="totp-manual-secret"');
    expect(html).toContain('JBSWY3DPEHPK3PXP');
    expect(html).toContain('data-testid="copy-secret-btn"');
    expect(html).toContain('data-testid="totp-verify-input"');
    expect(html).toContain('data-testid="totp-activate-btn"');
  });

  it('renders recovery codes modal with copy, download and confirm buttons', () => {
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      ['RECOV-1111-2222', 'RECOV-3333-4444'], // recoveryCodes
      true, // copiedCodes
      false,
      '',
      false,
      '',
      null,
      null,
      null,
    ];

    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={baseStatus}
        initialPasskeys={[]}
        initialSessions={sampleSessions}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="recovery-codes-display"');
    expect(html).toContain('data-testid="recovery-code-item"');
    expect(html).toContain('RECOV-1111-2222');
    expect(html).toContain('RECOV-3333-4444');
    expect(html).toContain('data-testid="copy-recovery-codes-btn"');
    expect(html).toContain('data-testid="download-recovery-codes-btn"');
    expect(html).toContain('data-testid="confirm-recovery-codes-btn"');
  });

  it('renders passkey registration form modal', () => {
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      true, // registeringPasskey
      'Work Laptop TouchID', // passkeyName
      false,
      '',
      null,
      null,
      null,
    ];

    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={baseStatus}
        initialPasskeys={[]}
        initialSessions={sampleSessions}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="passkey-register-form"');
    expect(html).toContain('data-testid="passkey-name-input"');
    expect(html).toContain('data-testid="passkey-submit-btn"');
    expect(html).toContain('Work Laptop TouchID');
  });

  it('renders re-authentication modal', () => {
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      false,
      '',
      true, // reauthModalOpen
      'SecretPassword123!', // reauthPassword
      null,
      null,
      null,
    ];

    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={baseStatus}
        initialPasskeys={[]}
        initialSessions={sampleSessions}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="reauth-modal"');
    expect(html).toContain('data-testid="reauth-password-input"');
    expect(html).toContain('data-testid="reauth-submit-btn"');
  });

  it('renders error alert and success message alert', () => {
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      false,
      '',
      false,
      '',
      null,
      'Test error message occurred', // error
      'Action completed successfully', // successMessage
    ];

    const html = renderToStaticMarkup(
      <SecuritySettingsView
        initialStatus={baseStatus}
        initialPasskeys={[]}
        initialSessions={sampleSessions}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="security-error-alert"');
    expect(html).toContain('Test error message occurred');
    expect(html).toContain('data-testid="security-success-alert"');
    expect(html).toContain('Action completed successfully');
  });

  it('triggers interactive buttons and action handlers', async () => {
    // 1. Setup TOTP button
    mockStartTotpEnrolmentAction.mockResolvedValueOnce({
      success: true,
      data: { secret: 'JBSWY3DPEHPK3PXP', qrSvg: '<svg/>' },
    });

    let btn: { onClick?: () => void | Promise<void> } | undefined;
    function Wrapper1() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'setup-totp-btn');
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper1 />);
    expect(btn).toBeDefined();
    await btn?.onClick?.();
    expect(mockStartTotpEnrolmentAction).toHaveBeenCalled();

    // 2. Postpone MFA button
    mockPostponeMfaAction.mockResolvedValueOnce({
      success: true,
      data: { postponedUntil: new Date('2026-10-17T00:00:00Z') },
    });
    mockSearchParams = new URLSearchParams('mfa_enforced=1');

    function Wrapper2() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'postpone-mfa-btn');
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper2 />);
    expect(btn).toBeDefined();
    await btn?.onClick?.();
    expect(mockPostponeMfaAction).toHaveBeenCalled();

    // 3. Disable TOTP button
    mockDisableTotpAction.mockResolvedValueOnce({ success: true });
    const activeStatus = { ...baseStatus, totpEnabled: true, hasMfa: true };

    function Wrapper3() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'disable-totp-btn');
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper3 />);
    expect(btn).toBeDefined();
    await btn?.onClick?.();
    expect(mockDisableTotpAction).toHaveBeenCalled();

    // 4. Regenerate Recovery Codes button
    mockRegenerateRecoveryCodesAction.mockResolvedValueOnce({
      success: true,
      data: { recoveryCodes: ['NEW-1', 'NEW-2'] },
    });

    function Wrapper4() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'regenerate-codes-btn');
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper4 />);
    expect(btn).toBeDefined();
    await btn?.onClick?.();
    expect(mockRegenerateRecoveryCodesAction).toHaveBeenCalled();

    // 5. Delete Passkey button
    mockDeletePasskeyAction.mockResolvedValueOnce({ success: true });

    function Wrapper5() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'delete-passkey-btn');
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper5 />);
    expect(btn).toBeDefined();
    await btn?.onClick?.();
    expect(mockDeletePasskeyAction).toHaveBeenCalledWith({ passkeyId: 'pk-1' });

    // 6. Revoke Session button
    mockRevokeSessionByIdAction.mockResolvedValueOnce({ success: true });

    function Wrapper6() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'revoke-session-btn');
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper6 />);
    expect(btn).toBeDefined();
    await btn?.onClick?.();
    expect(mockRevokeSessionByIdAction).toHaveBeenCalledWith({ sessionId: 'sess-2' });

    // 7. Sign Out Everywhere button
    mockSignOutEverywhereAction.mockResolvedValueOnce({ success: true });

    function Wrapper7() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'sign-out-everywhere-btn');
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper7 />);
    expect(btn).toBeDefined();
    await btn?.onClick?.();
    expect(mockSignOutEverywhereAction).toHaveBeenCalled();
  });

  it('triggers form submissions for TOTP verification, passkey registration, and reauth', async () => {
    // 1. TOTP verify form
    mockVerifyAndEnableTotpAction.mockResolvedValueOnce({
      success: true,
      data: { recoveryCodes: ['REC-1', 'REC-2'] },
    });

    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      true, // enrollingTotp
      'SECRET123',
      '<svg/>',
      '123456', // verifyCode
      false,
      null,
      false,
      false,
      '',
      false,
      '',
      null,
      null,
      null,
    ];

    let forms: { onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void> }[] = [];
    function Wrapper1() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      forms = findForms(tree);
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper1 />);
    expect(forms.length).toBeGreaterThan(0);
    await forms[0]?.onSubmit?.({ preventDefault: () => undefined });
    expect(mockVerifyAndEnableTotpAction).toHaveBeenCalledWith({ code: '123456' });

    // 2. Passkey registration form
    mockStartPasskeyRegistrationAction.mockResolvedValueOnce({
      success: true,
      data: {
        options: {
          challenge: 'test-challenge',
          rp: { id: 'localhost', name: 'PhotoCRM' },
          user: { id: 'user-id', name: 'Owner', displayName: 'Owner' },
          pubKeyCredParams: [],
        },
      },
    });

    Object.defineProperty(global.navigator, 'credentials', {
      value: {
        create: vi.fn().mockResolvedValueOnce({
          id: 'new-cred-id',
          response: {
            clientDataJSON: new ArrayBuffer(0),
            attestationObject: new ArrayBuffer(0),
          },
        }),
      },
      configurable: true,
      writable: true,
    });

    mockCompletePasskeyRegistrationAction.mockResolvedValueOnce({
      success: true,
      data: {
        passkey: {
          id: 'new-pk-1',
          name: 'My Passkey',
          createdAt: new Date(),
        },
      },
    });

    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      true, // registeringPasskey
      'My Passkey', // passkeyName
      false,
      '',
      null,
      null,
      null,
    ];

    let passkeyForm:
      { onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void> } | undefined;
    function Wrapper2() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      passkeyForm = findFormByTestId(tree, 'passkey-register-form');
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper2 />);
    expect(passkeyForm).toBeDefined();
    await passkeyForm?.onSubmit?.({ preventDefault: () => undefined });
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartPasskeyRegistrationAction).toHaveBeenCalled();
    expect(mockCompletePasskeyRegistrationAction).toHaveBeenCalled();

    // 3. Reauth form
    const mockPendingFn = vi.fn();
    mockReauthenticateAction.mockResolvedValueOnce({ success: true });

    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      false,
      '',
      true, // reauthModalOpen
      'SecretPassword123!',
      mockPendingFn, // pendingAction
      null,
      null,
    ];

    function Wrapper3() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      forms = findForms(tree);
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Wrapper3 />);
    expect(forms.length).toBeGreaterThan(0);
    await forms[forms.length - 1]?.onSubmit?.({ preventDefault: () => undefined });
    await new Promise((r) => setTimeout(r, 20));

    expect(mockReauthenticateAction).toHaveBeenCalledWith({ password: 'SecretPassword123!' });
    expect(mockPendingFn).toHaveBeenCalled();
  });

  it('handles re-authentication triggers and error states for disableTotp, regenerateCodes, and deletePasskey', async () => {
    const activeStatus = { ...baseStatus, totpEnabled: true, hasMfa: true };

    // 1. disableTotp returns REAUTH_REQUIRED
    mockDisableTotpAction.mockResolvedValueOnce({ success: false, code: 'REAUTH_REQUIRED' });
    let btn: { onClick?: () => void | Promise<void> } | undefined;
    function Wrapper1() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'disable-totp-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper1 />);
    await btn?.onClick?.();
    expect(mockDisableTotpAction).toHaveBeenCalled();

    // 2. disableTotp returns generic error
    mockDisableTotpAction.mockResolvedValueOnce({
      success: false,
      error: 'Database error disabling TOTP',
    });
    renderToStaticMarkup(<Wrapper1 />);
    await btn?.onClick?.();
    expect(mockDisableTotpAction).toHaveBeenCalled();

    // 3. regenerateRecoveryCodes returns REAUTH_REQUIRED
    mockRegenerateRecoveryCodesAction.mockResolvedValueOnce({
      success: false,
      code: 'REAUTH_REQUIRED',
    });
    function Wrapper2() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'regenerate-codes-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper2 />);
    await btn?.onClick?.();
    expect(mockRegenerateRecoveryCodesAction).toHaveBeenCalled();

    // 4. regenerateRecoveryCodes returns generic error
    mockRegenerateRecoveryCodesAction.mockResolvedValueOnce({
      success: false,
      error: 'Failed to regenerate',
    });
    renderToStaticMarkup(<Wrapper2 />);
    await btn?.onClick?.();
    expect(mockRegenerateRecoveryCodesAction).toHaveBeenCalled();

    // 5. deletePasskey returns REAUTH_REQUIRED
    mockDeletePasskeyAction.mockResolvedValueOnce({ success: false, code: 'REAUTH_REQUIRED' });
    function Wrapper3() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'delete-passkey-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper3 />);
    await btn?.onClick?.();
    expect(mockDeletePasskeyAction).toHaveBeenCalled();

    // 6. deletePasskey returns generic error
    mockDeletePasskeyAction.mockResolvedValueOnce({
      success: false,
      error: 'Failed to delete passkey',
    });
    renderToStaticMarkup(<Wrapper3 />);
    await btn?.onClick?.();
    expect(mockDeletePasskeyAction).toHaveBeenCalled();

    // 7. revokeSession returns generic error
    mockRevokeSessionByIdAction.mockResolvedValueOnce({
      success: false,
      error: 'Session not found',
    });
    function Wrapper4() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'revoke-session-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper4 />);
    await btn?.onClick?.();
    expect(mockRevokeSessionByIdAction).toHaveBeenCalled();

    // 8. signOutEverywhere returns generic error
    mockSignOutEverywhereAction.mockResolvedValueOnce({
      success: false,
      error: 'Failed to sign out everywhere',
    });
    function Wrapper5() {
      const tree = SecuritySettingsView({
        initialStatus: activeStatus,
        initialPasskeys: samplePasskeys,
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'sign-out-everywhere-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper5 />);
    await btn?.onClick?.();
    expect(mockSignOutEverywhereAction).toHaveBeenCalled();

    // 9. startTotpEnrolmentAction returns failure
    mockStartTotpEnrolmentAction.mockResolvedValueOnce({
      success: false,
      error: 'Start enrolment failed',
    });
    function Wrapper6() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'setup-totp-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper6 />);
    await btn?.onClick?.();
    expect(mockStartTotpEnrolmentAction).toHaveBeenCalled();

    // 10. postponeMfaAction returns failure
    mockSearchParams = new URLSearchParams('mfa_enforced=1');
    mockPostponeMfaAction.mockResolvedValueOnce({ success: false, error: 'Cannot postpone' });
    function Wrapper7() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'postpone-mfa-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper7 />);
    await btn?.onClick?.();
    expect(mockPostponeMfaAction).toHaveBeenCalled();
  });

  it('handles passkey registration error branches: unsupported WebAuthn, start failure, cancellation, completion error, and exception', async () => {
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      true, // registeringPasskey
      'Passkey 1',
      false,
      '',
      null,
      null,
      null,
    ];

    // 1. WebAuthn not supported
    mockIsWebAuthnSupported = false;
    let passkeyForm:
      { onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void> } | undefined;
    function Wrapper1() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      passkeyForm = findFormByTestId(tree, 'passkey-register-form');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper1 />);
    await passkeyForm?.onSubmit?.({ preventDefault: () => undefined });
    expect(mockStartPasskeyRegistrationAction).not.toHaveBeenCalled();

    // 2. startPasskeyRegistrationAction returns failure
    mockIsWebAuthnSupported = true;
    mockStartPasskeyRegistrationAction.mockResolvedValueOnce({
      success: false,
      error: 'Cannot start registration',
    });
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      true,
      'Passkey 1',
      false,
      '',
      null,
      null,
      null,
    ];
    renderToStaticMarkup(<Wrapper1 />);
    await passkeyForm?.onSubmit?.({ preventDefault: () => undefined });
    expect(mockStartPasskeyRegistrationAction).toHaveBeenCalled();

    // 3. User cancels passkey prompt (credentials.create returns null)
    mockStartPasskeyRegistrationAction.mockResolvedValueOnce({
      success: true,
      data: {
        options: {
          challenge: 'challenge',
          rp: { id: 'localhost', name: 'PhotoCRM' },
          user: { id: 'user-id', name: 'Owner', displayName: 'Owner' },
        },
      },
    });
    Object.defineProperty(global.navigator, 'credentials', {
      value: { create: vi.fn().mockResolvedValueOnce(null) },
      configurable: true,
      writable: true,
    });
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      true,
      'Passkey 1',
      false,
      '',
      null,
      null,
      null,
    ];
    renderToStaticMarkup(<Wrapper1 />);
    await passkeyForm?.onSubmit?.({ preventDefault: () => undefined });

    // 4. completePasskeyRegistrationAction fails
    mockStartPasskeyRegistrationAction.mockResolvedValueOnce({
      success: true,
      data: {
        options: {
          challenge: 'challenge',
          rp: { id: 'localhost', name: 'PhotoCRM' },
          user: { id: 'user-id', name: 'Owner', displayName: 'Owner' },
        },
      },
    });
    Object.defineProperty(global.navigator, 'credentials', {
      value: {
        create: vi.fn().mockResolvedValueOnce({
          id: 'cred-1',
          response: {
            clientDataJSON: new ArrayBuffer(0),
            attestationObject: new ArrayBuffer(0),
          },
        }),
      },
      configurable: true,
      writable: true,
    });
    mockCompletePasskeyRegistrationAction.mockResolvedValueOnce({
      success: false,
      error: 'Failed to complete registration',
    });
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      true,
      'Passkey 1',
      false,
      '',
      null,
      null,
      null,
    ];
    renderToStaticMarkup(<Wrapper1 />);
    await passkeyForm?.onSubmit?.({ preventDefault: () => undefined });

    // 5. Exception thrown during registration
    mockStartPasskeyRegistrationAction.mockRejectedValueOnce(new Error('Browser WebAuthn error'));
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      null,
      false,
      true,
      'Passkey 1',
      false,
      '',
      null,
      null,
      null,
    ];
    renderToStaticMarkup(<Wrapper1 />);
    await passkeyForm?.onSubmit?.({ preventDefault: () => undefined });
  });

  it('triggers modal utility buttons: copy secret, copy codes, download codes, confirm, and cancel buttons', async () => {
    if (typeof global.document === 'undefined') {
      (global as unknown as { document: Record<string, unknown> }).document = {
        createElement: vi.fn(() => ({
          href: '',
          download: '',
          click: vi.fn(),
        })),
      };
    }

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });

    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();

    // 1. Copy secret button in TOTP setup
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      true, // enrollingTotp
      'SECRETKEY123',
      '<svg/>',
      '',
      false,
      null,
      false,
      false,
      '',
      false,
      '',
      null,
      null,
      null,
    ];

    let btn: { onClick?: () => void | Promise<void> } | undefined;
    function Wrapper1() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'copy-secret-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper1 />);
    await btn?.onClick?.();

    // 2. Recovery codes buttons: copy, download, confirm
    mockStateQueue = [
      baseStatus,
      [],
      sampleSessions,
      false,
      '',
      '',
      '',
      false,
      ['REC-1', 'REC-2'],
      false,
      false,
      '',
      false,
      '',
      null,
      null,
      null,
    ];

    let copyBtn: { onClick?: () => void | Promise<void> } | undefined;
    let downloadBtn: { onClick?: () => void | Promise<void> } | undefined;
    let confirmBtn: { onClick?: () => void | Promise<void> } | undefined;
    function Wrapper2() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      copyBtn = findButtonByTestId(tree, 'copy-recovery-codes-btn');
      downloadBtn = findButtonByTestId(tree, 'download-recovery-codes-btn');
      confirmBtn = findButtonByTestId(tree, 'confirm-recovery-codes-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper2 />);
    await copyBtn?.onClick?.();
    await downloadBtn?.onClick?.();
    await confirmBtn?.onClick?.();

    // 3. Register passkey button
    function Wrapper3() {
      const tree = SecuritySettingsView({
        initialStatus: baseStatus,
        initialPasskeys: [],
        initialSessions: sampleSessions,
        locale: 'en',
      });
      btn = findButtonByTestId(tree, 'register-passkey-btn');
      return <div>{tree}</div>;
    }
    renderToStaticMarkup(<Wrapper3 />);
    await btn?.onClick?.();
  });
});
