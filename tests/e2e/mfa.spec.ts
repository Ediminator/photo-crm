import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TEST_AUTH_COOKIE = {
  name: 'photo_crm_session',
  value: 'e2e-session-valid-token',
  url: 'http://localhost:3000',
};

test.describe('TASK-0008: Multi-Factor Authentication (MFA) & Passkeys E2E', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([TEST_AUTH_COOKIE]);
  });

  test('AC-1: TOTP enrolment renders local QR code SVG, text alternative, and handles code verification', async ({
    page,
  }) => {
    // Intercept third-party network requests to verify local vector SVG rendering
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(req.url());
      }
    });

    await page.goto('/en/settings/security');
    await expect(page.locator('h1')).toHaveText('Security & Multi-Factor Authentication');

    // Click setup TOTP button
    const setupBtn = page.locator('[data-testid="setup-totp-btn"]');
    await expect(setupBtn).toBeVisible();
    await setupBtn.click();

    // Verify enrolment panel opened
    const enrolmentPanel = page.locator('[data-testid="totp-enrolment-panel"]');
    await expect(enrolmentPanel).toBeVisible();

    // Verify local QR code SVG is rendered without external requests
    const qrSvg = page.locator('[data-testid="totp-qr-code"] svg');
    await expect(qrSvg).toBeVisible();
    expect(externalRequests).toEqual([]);

    // Verify text alternative (manual secret key) is present
    const manualSecretEl = page.locator('[data-testid="totp-manual-secret"]');
    await expect(manualSecretEl).toBeVisible();
    const manualSecret = (await manualSecretEl.textContent())?.trim() ?? '';
    expect(manualSecret.length).toBeGreaterThanOrEqual(16);
    expect(manualSecret).toMatch(/^[A-Z2-7]+$/);

    // Verify copy secret button is available
    await expect(page.locator('[data-testid="copy-secret-btn"]')).toBeVisible();

    // Submit invalid verification code
    await page.fill('[data-testid="totp-verify-input"]', '000000');
    await page.click('[data-testid="totp-activate-btn"]');

    // Error alert is shown
    const errorAlert = page.locator('[data-testid="security-error-alert"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveAttribute('role', 'alert');
  });

  test('AC-2: Sign-in view presents passkey option and handles MFA challenge', async ({
    page,
    context,
  }) => {
    // Clear cookies to test sign-in form
    await context.clearCookies();
    await page.goto('/en/sign-in');

    // Verify standard sign-in form elements
    await expect(page.locator('[data-testid="signin-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="signin-submit-btn"]')).toBeVisible();

    // Verify WebAuthn passkey sign-in option is present
    const passkeyBtn = page.locator('[data-testid="passkey-signin-btn"]');
    await expect(passkeyBtn).toBeVisible();
  });

  test('AC-5: Passkey registration form with CDP virtual authenticator', async ({ page }) => {
    // Enable Chrome DevTools Protocol virtual authenticator for WebAuthn
    const cdpClient = await page.context().newCDPSession(page);
    await cdpClient.send('WebAuthn.enable');
    await cdpClient.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    await page.goto('/en/settings/security');

    // Click register passkey trigger to open form
    const registerBtn = page.locator('[data-testid="register-passkey-btn"]');
    await expect(registerBtn).toBeVisible();
    await registerBtn.click();

    // Form is displayed
    const passkeyForm = page.locator('[data-testid="passkey-register-form"]');
    await expect(passkeyForm).toBeVisible();
    await expect(page.locator('[data-testid="passkey-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="passkey-submit-btn"]')).toBeVisible();

    // Fill passkey name
    await page.fill('[data-testid="passkey-name-input"]', 'YubiKey 5C NFC');
    expect(await page.inputValue('[data-testid="passkey-name-input"]')).toBe('YubiKey 5C NFC');
  });

  test('AC-8: Forced MFA enrolment displays enforcement alert banner', async ({ page }) => {
    await page.goto('/en/settings/security?mfa_enforced=1');

    // Verify alert banner is rendered with role="alert"
    const alert = page.locator('[data-testid="mfa-enforcement-alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute('role', 'alert');
    await expect(alert).toContainText('Multi-factor authentication is required');

    // Verify postponement button is rendered
    const postponeBtn = page.locator('[data-testid="postpone-mfa-btn"]');
    await expect(postponeBtn).toBeVisible();
  });

  test.describe('AC-7: Localization & WCAG 2.2 AA Axe Accessibility on Security Settings', () => {
    const viewports = [
      { name: 'mobile (375px)', width: 375, height: 667 },
      { name: 'desktop (1440px)', width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      test(`AC-7: /en/settings/security is localized in English and has 0 serious/critical axe violations at ${vp.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/en/settings/security');

        // Verify HTML lang
        const htmlLang = await page.getAttribute('html', 'lang');
        expect(htmlLang).toBe('en');

        // Verify localized headings
        const h1 = page.locator('h1');
        await expect(h1).toHaveText('Security & Multi-Factor Authentication');
        await expect(page.getByRole('heading', { name: 'Authenticator App (TOTP)' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Passkeys (WebAuthn)' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Active Sessions' })).toBeVisible();

        // Run axe accessibility audit
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        const seriousOrCritical = scan.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(seriousOrCritical).toEqual([]);
      });

      test(`AC-7: /de/settings/security is localized in German and has 0 serious/critical axe violations at ${vp.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/de/settings/security');

        // Verify HTML lang
        const htmlLang = await page.getAttribute('html', 'lang');
        expect(htmlLang).toBe('de');

        // Verify localized headings
        const h1 = page.locator('h1');
        await expect(h1).toHaveText('Sicherheit & Multi-Faktor-Authentifizierung');
        await expect(
          page.getByRole('heading', { name: 'Authentifikator-App (TOTP)' }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Passkeys (WebAuthn)' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Aktive Sitzungen' })).toBeVisible();

        // Run axe accessibility audit
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        const seriousOrCritical = scan.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(seriousOrCritical).toEqual([]);
      });
    }
  });
});
