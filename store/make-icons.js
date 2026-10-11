/* Renders store/icon.svg into the extension icons and the 128 px store icon (96 px art, 16 px clear margin). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (size, pad, file) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block;width:' + (size - 2 * pad) + 'px;height:' + (size - 2 * pad) + 'px;margin:' + pad + 'px}</style>' + svg);
    await page.screenshot({ path: file, omitBackground: true });
    console.log('wrote', path.relative(path.join(__dirname, '..'), file));
  };
  for (const s of [16, 32, 48, 128]) await shot(s, 0, path.join(__dirname, '../extension/icons/icon' + s + '.png'));
  await shot(128, 16, path.join(__dirname, 'spectest-store-icon-128.png'));
  await browser.close();
})();
