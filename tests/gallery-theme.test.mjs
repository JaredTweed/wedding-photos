import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

let formHtml;
let galleryHtml;

before(async () => {
  [formHtml, galleryHtml] = await Promise.all([
    readFile(new URL('../form.html', import.meta.url), 'utf8'),
    readFile(new URL('../home.html', import.meta.url), 'utf8'),
  ]);
});

describe('gallery theme selection', () => {
  test('the form presents exactly the two requested themes', () => {
    const select = formHtml.match(/<select id="siteTheme">([\s\S]*?)<\/select>/)?.[1] || '';
    const options = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)]
      .map(([, value, label]) => ({ value, label }));

    assert.deepEqual(options, [
      { value: 'classic', label: 'Classic Gallery (Poppins)' },
      { value: 'refined', label: 'Refined Shared Lens' },
    ]);
  });

  test('new saves use the theme field and existing font choices remain compatible', () => {
    assert.match(formHtml, /theme: themeKey/);
    assert.match(formHtml, /resolveThemeKey\(d\.theme, d\.fontFamily\)/);
    assert.match(formHtml, /legacyValue === 'serif'[\s\S]*return 'refined'/);
    assert.match(formHtml, /legacyValue === 'sans'[\s\S]*return 'classic'/);
  });

  test('the gallery applies the selected theme while keeping Poppins', () => {
    assert.match(galleryHtml, /document\.documentElement\.dataset\.theme = THEME_KEY/);
    assert.match(galleryHtml, /const SITE_FONT = "'Poppins', 'Segoe UI', sans-serif"/);
    assert.match(galleryHtml, /html\[data-theme="refined"\] #tabs\.tabs/);
    assert.doesNotMatch(galleryHtml, /html\[data-theme="classic"\]/);
  });

  test('neutral primary colors cannot leave a stale hue in the glider', () => {
    const functionSource = galleryHtml.match(
      /function getSecondaryColor\(primaryHSL\) \{[\s\S]*?\n    \}/,
    )?.[0];
    assert.ok(functionSource, 'getSecondaryColor should exist');

    const getSecondaryColor = Function(`return (${functionSource})`)();
    assert.equal(getSecondaryColor('hsl(96 23.7% 0%)'), 'hsl(96 0.0% 94%)');
    assert.equal(getSecondaryColor('not-a-color'), 'hsl(0 0% 94%)');
    assert.notEqual(getSecondaryColor('hsl(303 23.7% 54%)'), 'hsl(303 0.0% 94%)');
  });

  test('the refined theme uses an instant neutral glider and active tab', () => {
    assert.match(
      galleryHtml,
      /html\[data-theme="refined"\] #tabs\.tabs \.glider \{[\s\S]*?background: #e5e5e5;[\s\S]*?transition: none;/,
    );
    assert.match(
      galleryHtml,
      /html\[data-theme="refined"\] #tabs\.tabs \.tab-header\.active \{[\s\S]*?color: #111;/,
    );
  });
});
