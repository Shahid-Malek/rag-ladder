import assert from 'node:assert/strict';

// Run against npm run preview; use an existing Playwright installation/browser.
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await playwright[process.env.BROWSER || 'chromium'].launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE && {
    executablePath: process.env.BROWSER_EXECUTABLE,
  }),
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4321/rag-ladder';
const only = process.env.ONLY;
let checks = 0;

const cases = {
  async 'third-party script failure stays hidden'(page) {
    await page.route('https://static.cloudflareinsights.com/**', (route) =>
      route.abort('blockedbyclient'),
    );
    await page.goto(`${base}/`);
    const failed = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = 'https://static.cloudflareinsights.com/x.js';
          script.onerror = () => resolve(true);
          script.onload = () => resolve(false);
          document.body.append(script);
        }),
    );
    assert.equal(failed, true, 'injected third-party script should fail');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#script-error').isHidden(), true);
  },
  async 'own island chunk failure is shown'(page) {
    // Match the path with or without Astro's ?astro-retry= query, so the retry also fails.
    await page.route(
      (url) =>
        /\/rag-ladder\/_astro\/PartsSelector[^/]*\.js$/.test(url.pathname),
      (route) => route.fulfill({ status: 404, body: 'not found' }),
    );
    await page.goto(`${base}/`);
    await page
      .locator('astro-island[component-url*="PartsSelector"]')
      .scrollIntoViewIfNeeded();
    await page.locator('#script-error').waitFor({ state: 'visible' });
  },
};

try {
  for (const [name, run] of Object.entries(cases)) {
    if (only && !name.includes(only)) continue;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    try {
      await run(page);
      checks++;
      console.log(`${name}: passed`);
    } finally {
      await context.close();
    }
  }
  console.log(`${checks} script-error browser cases passed.`);
} finally {
  await browser.close();
}
