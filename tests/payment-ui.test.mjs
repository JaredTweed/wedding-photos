import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

let html;

before(async () => {
  html = await readFile(new URL('../form.html', import.meta.url), 'utf8');
});

describe('checkout account association', () => {
  test('checkout starts hidden until authentication resolves', () => {
    assert.match(html, /<stripe-buy-button hidden\b/);
    assert.match(html, /if \(!user\) \{\s*stripeBuyButton\.hidden = true;/);
  });

  test('signed-in checkout identifies the Firebase account to Stripe', () => {
    assert.match(
      html,
      /stripeBuyButton\.setAttribute\('client-reference-id', user\.uid\)/,
    );
    assert.match(
      html,
      /stripeBuyButton\.setAttribute\('customer-email', user\.email\)/,
    );
  });

  test('publishing forces a fresh payment lookup', () => {
    assert.match(
      html,
      /const hasDonation = await ensureDonationFor\(user, \{ force: true \}\)/,
    );
    assert.match(
      html,
      /snap\.data\(\)\?\.hasDonated === true/,
    );
  });
});
