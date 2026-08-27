import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

let html;

before(async () => {
  html = await readFile(new URL('../home.html', import.meta.url), 'utf8');
});

describe('gallery photo-credit settings', () => {
  test('uses an accessible in-page dialog instead of a browser prompt', () => {
    assert.match(
      html,
      /<dialog id="settingsDialog" aria-labelledby="settingsTitle" aria-describedby="settingsDescription">/,
    );
    assert.match(html, /id="settingsBtn"[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-controls="settingsDialog"/);
    assert.match(html, /settingsDialog\.showModal\(\)/);
    assert.doesNotMatch(html, /\bprompt\s*\(/);
  });

  test('matches the selected primary color and both gallery themes', () => {
    assert.match(
      html,
      /#settingsDialog \{[\s\S]*?border-top: 4px solid var\(--primary-color\);[\s\S]*?border-radius: 10px;/,
    );
    assert.match(
      html,
      /#settingsSave \{[\s\S]*?background: var\(--primary-color\);/,
    );
    assert.match(
      html,
      /html\[data-theme="refined"\] #settingsDialog \{[\s\S]*?border-top: 3px solid var\(--primary-color\);[\s\S]*?border-radius: 2px;/,
    );
  });

  test('saves existing upload credits and reports failures inside the dialog', () => {
    assert.match(html, /await Promise\.all\(uploads\.map\(k => putCredit\(k, clean\)\)\)/);
    assert.match(html, /localStorage\.setItem\('creditName', creditName\)/);
    assert.match(html, /Could not save your photo credit\. Please try again\./);
    assert.match(html, /if \(settingsSaving\) e\.preventDefault\(\)/);
  });
});
