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
});
