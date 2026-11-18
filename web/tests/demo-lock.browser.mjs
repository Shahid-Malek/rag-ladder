import assert from 'node:assert/strict';

// Run against npm run preview; use an existing Playwright installation/browser.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE && {
    executablePath: process.env.BROWSER_EXECUTABLE,
  }),
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4321';
let checks = 0;

try {
  for (const level of ['naive', 'intermediate']) {
    for (const mode of [
      'supported',
      'absent',
      'rejected',
      'throws',
      'reduced',
      'desktop',
    ]) {
      const mobile = mode !== 'desktop';
      const context = await browser.newContext({
        viewport: { width: mobile ? 360 : 1280, height: 900 },
        hasTouch: mobile,
        reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
      });
      await context.addInitScript((mode) => {
        window.hapticCalls = [];
        Object.defineProperty(navigator, 'vibrate', {
          configurable: true,
          value:
            mode === 'absent'
              ? undefined
              : (duration) => {
                  window.hapticCalls.push(duration);
                  if (mode === 'throws') throw new Error('Haptics unavailable');
                  return mode !== 'rejected';
                },
        });
      }, mode);
      const page = await context.newPage();
      const errors = [],
        requests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (['fetch', 'xhr'].includes(request.resourceType()))
          requests.push(new URL(request.url()).pathname);
      });
      await page.goto(`${base}/${level}/`);
      const fields = page.locator('.demo-locked-field');
      await fields.first().scrollIntoViewIfNeeded();
      await page.waitForSelector('astro-island:not([ssr]) [data-demo-locked]');
      assert.equal(await fields.count(), 2);
      assert.equal(
        await page
          .locator('[data-demo-locked] input, [data-demo-locked] textarea')
          .count(),
        0,
      );
      for (let i = 0; i < 2; i++) {
        const field = fields.nth(i);
        await field.scrollIntoViewIfNeeded();
        assert.equal(await field.getAttribute('disabled'), null);
        assert.equal(await field.getAttribute('aria-disabled'), 'true');
        if (mode === 'reduced') {
          assert.equal(
            await field
              .locator('svg')
              .evaluate((el) => getComputedStyle(el).animationName),
            'none',
          );
        }
        await field.focus();
        await page.getByRole('tooltip').waitFor();
        await page.keyboard.press(i ? 'Space' : 'Enter');
        const dialog = page.getByRole('dialog', { name: 'Coming soon' });
        await dialog.waitFor();
        assert.ok(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
        );
        const feedback = await field.evaluate((el) =>
          el.getAnimations().map((a) => ({
            duration: a.effect.getTiming().duration,
            moving: a.effect
              .getKeyframes()
              .some((k) => k.transform && k.transform !== 'none'),
            glow: a.effect
              .getKeyframes()
              .some((k) => k.boxShadow?.includes('4px')),
          })),
        );
        assert.ok(
          feedback.some(
            (a) =>
              a.duration === 600 && a.glow && a.moving === (mode !== 'reduced'),
          ),
        );
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() =>
          document.activeElement?.classList.contains('demo-locked-field'),
        );
        assert.ok(await field.evaluate((el) => el === document.activeElement));
      }
      const field = fields.first();
      await field.scrollIntoViewIfNeeded();
      const box = await field.boundingBox();
      if (mobile)
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
      else
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByRole('dialog', { name: 'Coming soon' }).waitFor();
      await page.getByRole('button', { name: 'Got it', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const calls = await page.evaluate(() => window.hapticCalls);
      assert.deepEqual(
        calls,
        ['absent', 'reduced', 'desktop'].includes(mode) ? [] : [35, 35, 35],
      );
      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      checks++;
      console.log(`${level}: ${mode} passed`);
      await context.close();
    }
  }
  console.log(`${checks} locked-demo browser cases passed.`);
} finally {
  await browser.close();
}
