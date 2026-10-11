/* Regenerates the Chrome Web Store pictures from the real extension running in Chromium:
   two 1280x800 screenshots and the 440x280 promo tile. The script checks they have no alpha channel. */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EXT = path.resolve(__dirname, '..', 'extension');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-shots-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto('chrome-extension://' + id + '/generator.html');
  await page.click('#sample');
  await page.waitForSelector('#loaded:not([hidden])');
  await page.evaluate(() => {
    const code = document.getElementById('code');
    const at = code.textContent.indexOf('// POST /items: returns');
    code.scrollTop = Math.max(0, (code.textContent.slice(0, at).split('\n').length - 3) * parseFloat(getComputedStyle(code).lineHeight));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'spectest-screenshot-1.png') });

  await page.locator('#targets label').getByText('Python', { exact: true }).click();
  await page.fill('#filter', '/items');
  await page.evaluate(() => {
    const code = document.getElementById('code');
    const at = code.textContent.indexOf('# POST /items: returns');
    code.scrollTop = Math.max(0, (code.textContent.slice(0, at).split('\n').length - 3) * parseFloat(getComputedStyle(code).lineHeight));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'spectest-screenshot-2.png') });

  const tile = await ctx.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.goto('file://' + path.join(__dirname, 'promo.html'));
  await tile.screenshot({ path: path.join(__dirname, 'spectest-promo-440x280.png') });
  await ctx.close();

  // Chrome Web Store rejects PNGs with an alpha channel. Page screenshots come out as 24-bit RGB; check rather than assume.
  for (const f of ['spectest-screenshot-1.png', 'spectest-screenshot-2.png', 'spectest-promo-440x280.png']) {
    const head = fs.readFileSync(path.join(__dirname, f)).subarray(0, 26);
    const size = head.readUInt32BE(16) + 'x' + head.readUInt32BE(20);
    const colorType = head[25]; // 2 = RGB, 6 = RGB with alpha
    console.log(f, size, colorType === 2 ? 'RGB, no alpha' : 'colour type ' + colorType);
    if (colorType !== 2) throw new Error(f + ' has an alpha channel or is not RGB');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
