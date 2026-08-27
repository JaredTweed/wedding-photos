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

  test('a fresh access check does not flash the payment gate for an authorized account', () => {
    assert.match(
      html,
      /const hasCachedAccess = donationCache\.checked[\s\S]*?&& donationCache\.hasDonated;[\s\S]*?if \(!hasCachedAccess\) \{[\s\S]*?setPublishLockState\(\{ locked: true, message: 'Checking your access…' \}\);/,
    );
  });

  test('publishing keeps the existing site result visible and disables its controls', () => {
    const submitSource = html.match(
      /async function submitForm\(e\) \{[\s\S]*?\n    \}/,
    )?.[0] || '';

    assert.match(submitSource, /setSiteResultBusy\(true\)/);
    assert.match(submitSource, /setSiteResultBusy\(false\)/);
    assert.doesNotMatch(submitSource, /siteResult\.style\.display = 'none'/);
    assert.doesNotMatch(submitSource, /siteResult\.textContent = ''/);
    assert.match(html, /siteResult\.inert = !!busy/);
  });
});
