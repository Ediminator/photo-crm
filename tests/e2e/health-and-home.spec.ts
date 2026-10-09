import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('E2E: Health Endpoint and Bilingual Home Pages', () => {
  test('AC-7: GET /api/health returns 200 ok with Cache-Control no-store and zero extra fields', async ({
    request,
  }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const cacheControl = response.headers()['cache-control'];
    expect(cacheControl).toBeDefined();
    expect(cacheControl).toContain('no-store');

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: 'ok' });
    expect(Object.keys(body)).toEqual(['status']);
  });

  test('AC-8: home page in en shows localized heading, html lang=en, and passes axe a11y', async ({
    page,
  }) => {
    await page.goto('/en');

    // Check html lang attribute matches locale
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('en');

    // Check localized heading
    const heading = page.locator('h1');
    await expect(heading).toHaveText('Photo CRM');

    // Run axe accessibility audit
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);
  });

  test('AC-8: home page in de shows localized heading, html lang=de, and passes axe a11y', async ({
    page,
  }) => {
    await page.goto('/de');

    // Check html lang attribute matches locale
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('de');

    // Check localized heading
    const heading = page.locator('h1');
    await expect(heading).toHaveText('Photo CRM');

    // Run axe accessibility audit
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
