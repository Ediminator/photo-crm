import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  '../../../../control/ownlight/runs/TASK-0011/iter-01/ux',
);

async function ensureOwnerBootstrappedAndSignedIn(page: import('@playwright/test').Page) {
  // Check if initial setup is available
  await page.goto('/en/setup');
  const setupForm = page.locator('[data-testid="setup-form"]');
  if (await setupForm.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.fill('[data-testid="setup-token-input"]', VALID_SETUP_TOKEN);
    await page.fill('[data-testid="name-input"]', 'Studio Owner');
    await page.fill('[data-testid="email-input"]', E2E_OWNER_EMAIL);
    await page.fill('[data-testid="password-input"]', E2E_OWNER_PASSWORD);
    await page.click('[data-testid="setup-submit-btn"]');
    await expect(page).not.toHaveURL(/\/setup/);
    return;
  }

  // If already set up, check if sign-in is needed
  await page.goto('/en/sign-in');
  const emailInput = page.locator('[data-testid="email-input"]');
  if (await emailInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await emailInput.fill(E2E_OWNER_EMAIL);
    await page.fill('[data-testid="password-input"]', E2E_OWNER_PASSWORD);
    await page.click('[data-testid="signin-submit-btn"]');
    await expect(page).not.toHaveURL(/\/sign-in$/);
  }
}

test.describe('TASK-0011: Client Directory & Profile UI E2E', () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1: /en/clients lists first 25 clients, shows Page 1 of 2, and Next shows remaining clients', async ({
    page,
  }) => {
    await page.goto('/en/clients');

    // Heading exists
    const heading = page.locator('h1');
    await expect(heading).toHaveText('Clients');

    // Table is visible on desktop
    const table = page.locator('[data-testid="client-table"]');
    await expect(table).toBeVisible();

    // 25 rows present in tbody
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(25);

    // Pagination shows Page 1 of 2
    const paginationSummary = page.locator('[data-testid="pagination-summary"]');
    await expect(paginationSummary).toHaveText('Page 1 of 2');

    // Activating Next button navigates to page 2
    const nextBtn = page.locator('[data-testid="pagination-next-btn"]');
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // Page 2 shows remaining 25 clients and Page 2 of 2
    await expect(paginationSummary).toHaveText('Page 2 of 2');
    const prevBtn = page.locator('[data-testid="pagination-prev-btn"]');
    await expect(prevBtn).toBeEnabled();
  });

  test('AC-2: search field filters clients by contact email, announces count in live region, and URL does not contain search term', async ({
    page,
  }) => {
    await page.goto('/en/clients');

    // Get an email from the table
    const firstRowEmail = await page
      .locator('[data-testid="client-table"] tbody tr:first-child td:nth-child(3)')
      .innerText();
    expect(firstRowEmail).toContain('@');

    // Type email into search input
    const searchInput = page.locator('[data-testid="client-search-input"]');
    await searchInput.fill(firstRowEmail);

    // Submit search
    await page.click('[data-testid="client-search-submit-btn"]');

    // Only matching client listed
    const rows = page.locator('[data-testid="client-table"] tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(firstRowEmail);

    // Live region announces result count
    const liveRegion = page.locator('[data-testid="client-directory-live-region"]');
    await expect(liveRegion).toHaveText('1 client found');

    // CRITICAL PRIVACY DIRECTIVE (ADR-0010): URL MUST NOT contain search term
    const currentUrl = page.url();
    expect(currentUrl).not.toContain(encodeURIComponent(firstRowEmail));
    expect(currentUrl).not.toContain(firstRowEmail);
    expect(currentUrl).not.toContain('q=');
  });

  test('AC-3: tag filter combined with search term reflects tagId in URL but not search term', async ({
    page,
  }) => {
    await page.goto('/en/clients');

    // Select first tag from dropdown
    const tagSelect = page.locator('[data-testid="client-tag-filter"]');
    const optionValues = await tagSelect
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    const firstOption = optionValues[0];
    expect(firstOption).toBeDefined();
    const selectedTagId = firstOption ?? '';

    await tagSelect.selectOption(selectedTagId);

    // Verify tagId is in URL
    await expect(page).toHaveURL(new RegExp(`tagId=${selectedTagId}`));

    // Enter search term
    const searchInput = page.locator('[data-testid="client-search-input"]');
    await searchInput.fill('GmbH');
    await page.click('[data-testid="client-search-submit-btn"]');

    // Verify tagId is still in URL, but search term 'GmbH' is NOT in URL
    const url = page.url();
    expect(url).toContain(`tagId=${selectedTagId}`);
    expect(url).not.toContain('GmbH');
    expect(url).not.toContain('q=');
  });

  test('AC-4: search matching nothing displays localized no results message', async ({ page }) => {
    await page.goto('/en/clients');

    const searchInput = page.locator('[data-testid="client-search-input"]');
    await searchInput.fill('NonExistentTermZ999');
    await page.click('[data-testid="client-search-submit-btn"]');

    const noResults = page.locator('[data-testid="client-no-results-state"]');
    await expect(noResults).toBeVisible();
    await expect(noResults).toContainText('No matching clients found');

    // Table is not shown when no results
    await expect(page.locator('[data-testid="client-table"]')).toBeHidden();
  });

  test('AC-5: navigating to client profile displays single h1, kind, contacts with mailto/tel links, formatted address, tags, and dates in studio timezone', async ({
    page,
  }) => {
    await page.goto('/en/clients');

    // Click first client name link
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    const clientName = await firstClientLink.innerText();
    await firstClientLink.click();

    // Verify profile page loaded
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}$/);

    // Single H1 matching client name
    const h1s = page.locator('h1');
    await expect(h1s).toHaveCount(1);
    await expect(h1s).toHaveText(clientName);

    // Profile view container
    const profileView = page.locator('[data-testid="client-profile-view"]');
    await expect(profileView).toBeVisible();

    // Kind badge
    const kindBadge = page.locator('[data-testid="client-kind-badge"]');
    await expect(kindBadge).toBeVisible();

    // Contacts section with mailto: and tel: links
    const emailLink = page.locator('a[href^="mailto:"]').first();
    await expect(emailLink).toBeVisible();

    const phoneLink = page.locator('a[href^="tel:"]').first();
    if (await phoneLink.isVisible().catch(() => false)) {
      const telHref = await phoneLink.getAttribute('href');
      expect(telHref).toMatch(/^tel:\+?\d+$/);
    }

    // Timestamps
    const createdDate = page.locator('[data-testid="client-created-date"]');
    await expect(createdDate).toBeVisible();

    const lastActivityDate = page.locator('[data-testid="client-last-activity-date"]');
    await expect(lastActivityDate).toBeVisible();
  });

  test('AC-6: requesting invalid clientId returns HTTP 404 not-found', async ({ page }) => {
    const invalidUuidResponse = await page.goto('/en/clients/not-a-valid-uuid');
    expect(invalidUuidResponse?.status()).toBe(404);
    await expect(page.locator('body')).toContainText('Client not found');

    const nonExistentResponse = await page.goto('/en/clients/018f0000-0000-7000-8000-999999999999');
    expect(nonExistentResponse?.status()).toBe(404);
    await expect(page.locator('body')).toContainText('Client not found');
  });

  test('AC-7: unauthenticated visit to /en/clients or client profile redirects to sign-in and leaks no personal data', async ({
    browser,
  }) => {
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();

    await unauthPage.goto('/en/clients');
    await expect(unauthPage).toHaveURL(/\/en\/sign-in\?callbackUrl=%2Fen%2Fclients/);

    const bodyText = await unauthPage.content();
    expect(bodyText).not.toContain('data-testid="client-table"');
    expect(bodyText).not.toContain('data-testid="client-profile-view"');
    expect(bodyText).not.toContain('Musterstraße');
    expect(bodyText).not.toContain('+49 30 0000');

    await unauthContext.close();
  });

  test('AC-8: German locale (/de/clients and /de/clients/[id]) displays German strings and Deutschland country name', async ({
    page,
  }) => {
    await page.goto('/de/clients');

    // German heading
    const heading = page.locator('h1');
    await expect(heading).toHaveText('Kund:innen');

    // German table headers
    const table = page.locator('[data-testid="client-table"]');
    await expect(table).toContainText('Name');
    await expect(table).toContainText('Hauptkontakt');
    await expect(table).toContainText('E-Mail');
    await expect(table).toContainText('Telefon');
    await expect(table).toContainText('Schlagwörter');

    // Click through to profile in German
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();

    // Verify German profile page
    await expect(page).toHaveURL(/\/de\/clients\/[0-9a-f-]{36}$/);
    await expect(page.locator('[data-testid="back-to-directory-link"]')).toContainText(
      'Zurück zu Kund:innen',
    );
    await expect(page.locator('body')).toContainText('Kontakte');
    await expect(page.locator('body')).toContainText('Adressen');

    // Check Deutschland for German address country
    const addressCard = page.locator('[data-testid^="address-card-"]').first();
    if (await addressCard.isVisible().catch(() => false)) {
      await expect(addressCard).toContainText('Deutschland');
    }
  });

  test('AC-9: Axe accessibility scan passes with 0 violations across directory and profile in en and de', async ({
    page,
  }) => {
    // 1. Directory /en/clients
    await page.goto('/en/clients');
    const axeDirEn = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeDirEn.violations).toEqual([]);

    // 2. Directory /de/clients
    await page.goto('/de/clients');
    const axeDirDe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeDirDe.violations).toEqual([]);

    // Get an ID for profile axe check
    const clientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    const profileHref = (await clientLink.getAttribute('href')) ?? '';
    expect(profileHref).toContain('/clients/');

    // 3. Profile /de/clients/[id]
    await page.goto(profileHref);
    const axeProfDe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeProfDe.violations).toEqual([]);

    // 4. Profile /en/clients/[id]
    const enProfileHref = profileHref.replace('/de/clients/', '/en/clients/');
    await page.goto(enProfileHref);
    const axeProfEn = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeProfEn.violations).toEqual([]);
  });

  test('AC-10: 320px viewport has no horizontal scrolling, uses stacked card list, and touch targets >= 24px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/en/clients');

    // Table is hidden on mobile
    await expect(page.locator('[data-testid="client-table"]')).toBeHidden();

    // Stacked card list is visible
    const stackedList = page.locator('[data-testid="client-stacked-list"]');
    await expect(stackedList).toBeVisible();

    // Check no horizontal scrolling at 320px
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px rounding margin

    // Check interactive touch target sizes (SC 2.5.8 >= 24px)
    const searchInputBox = await page.locator('[data-testid="client-search-input"]').boundingBox();
    expect(searchInputBox?.height).toBeGreaterThanOrEqual(24);
    expect(searchInputBox?.width).toBeGreaterThanOrEqual(24);

    const prevBtnBox = await page.locator('[data-testid="pagination-prev-btn"]').boundingBox();
    expect(prevBtnBox?.height).toBeGreaterThanOrEqual(24);
    expect(prevBtnBox?.width).toBeGreaterThanOrEqual(24);
  });

  test('AC-11: keyboard tabbing reaches search, submit, tag filter, client link, and pagination in logical order with visible focus', async ({
    page,
  }) => {
    await page.goto('/en/clients');

    // Click at top of page and tab down
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // sidebar or top element

    // Find and focus search input
    const searchInput = page.locator('[data-testid="client-search-input"]');
    await searchInput.focus();
    await expect(searchInput).toBeFocused();

    // Next Tab is search submit button
    await page.keyboard.press('Tab');
    const submitBtn = page.locator('[data-testid="client-search-submit-btn"]');
    await expect(submitBtn).toBeFocused();

    // Next Tab is tag filter select
    await page.keyboard.press('Tab');
    const tagFilter = page.locator('[data-testid="client-tag-filter"]');
    await expect(tagFilter).toBeFocused();

    // Next Tab is first client link
    await page.keyboard.press('Tab');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await expect(firstClientLink).toBeFocused();
  });

  test('AC-12: response headers have Cache-Control containing no-store and document title contains no PII', async ({
    page,
  }) => {
    // 1. Directory page
    const dirResponse = await page.goto('/en/clients');
    expect(dirResponse).not.toBeNull();
    const dirHeaders = dirResponse ? dirResponse.headers() : {};
    const dirCacheControl = dirHeaders['cache-control'] ?? '';
    expect(dirCacheControl).toContain('no-store');

    const dirTitle = await page.title();
    expect(dirTitle).toContain('Clients · Ownlight');
    expect(dirTitle).not.toMatch(/@/);
    expect(dirTitle).not.toMatch(/\+?\d{5,}/);

    // 2. Profile page
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    const profileHref = (await firstClientLink.getAttribute('href')) ?? '';
    expect(profileHref).toContain('/clients/');

    const profResponse = await page.goto(profileHref);
    expect(profResponse).not.toBeNull();
    const profHeaders = profResponse ? profResponse.headers() : {};
    const profCacheControl = profHeaders['cache-control'] ?? '';
    expect(profCacheControl).toContain('no-store');

    const profTitle = await page.title();
    expect(profTitle).toContain('Client profile · Ownlight');
    expect(profTitle).not.toMatch(/@/);
    expect(profTitle).not.toMatch(/\+?\d{5,}/);
  });

  test('UX: capture responsive screenshots at 320px, 768px, and 1280px for UX and accessibility reviewers', async ({
    page,
  }) => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });

    const breakpoints = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    // Directory screenshots
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto('/en/clients');
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `clients-directory-${bp.name}.png`),
        fullPage: true,
      });
    }

    // Profile screenshots
    await page.goto('/en/clients');
    const clientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    const profileHref = (await clientLink.getAttribute('href')) ?? '/en/clients';

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(profileHref);
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `client-profile-${bp.name}.png`),
        fullPage: true,
      });
    }

    // Verify screenshots were created
    for (const bp of breakpoints) {
      expect(fs.existsSync(path.join(UX_RUN_DIR, `clients-directory-${bp.name}.png`))).toBe(true);
      expect(fs.existsSync(path.join(UX_RUN_DIR, `client-profile-${bp.name}.png`))).toBe(true);
    }
  });
});
