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

  test('editing preserves backend retention fields and the original creation date', () => {
    assert.match(html, /await docRef\.set\(docData, \{ merge: true \}\)/);
    assert.match(
      html,
      /createdAt: isEditing && editingSite\.createdAt[\s\S]*?\? editingSite\.createdAt[\s\S]*?: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/,
    );
  });

  test('the management form explains the gallery retention date and demo exemption', () => {
    assert.match(html, /id="retentionSummary"[^>]*hidden[^>]*aria-live="polite"/);
    assert.match(html, /slug === 'wedding-photos' \|\| exempt/);
    assert.match(html, /will be permanently deleted on \$\{formatted\}/);
    assert.match(html, /asRetentionDate\(expiresAt\) \|\| addRetentionYears\(createdAt\)/);
    assert.doesNotMatch(html, /kept for three years from its original creation date/);
    assert.match(html, /permanently available and never expires/);
  });

  test('deleting the loaded gallery clears its stale retention notice', () => {
    assert.match(
      html,
      /function hideRetentionSummary\(\)[\s\S]*?retentionSummary\.hidden = true;[\s\S]*?retentionSummary\.textContent = '';[\s\S]*?delete retentionSummary\.dataset\.state;/
    );
    assert.match(html, /async function prefillFromAccount\(\) \{\s*hideRetentionSummary\(\);/);
    assert.match(html, /await docRef\.delete\(\);[\s\S]*?await prefillFromAccount\(\);/);
  });

  test('managed gallery downloads use the authenticated background archive service', () => {
    assert.match(html, /id="archiveDownloadResult"[^>]*hidden[^>]*aria-live="polite"/);
    assert.match(html, /authorization: `Bearer \$\{token\}`/);
    assert.match(html, /archiveApiRequest\('\/exports', \{[\s\S]*?method: 'POST'/);
    assert.match(html, /archiveApiRequest\(`\/exports\/\$\{encodeURIComponent\(current\.jobId\)\}`\)/);
    assert.match(html, /You can leave this page and return later/);
    assert.match(html, /Download links are private and expire after 15 minutes/);
    assert.match(html, /job\.downloads\.length === 1 \? 'Download ZIP' : `Download part \$\{index \+ 1\}`/);
  });

  test('legacy self-managed galleries retain the in-browser download fallback', () => {
    assert.match(html, /siteInfo\.plan \|\| 'managed'\) !== 'managed'/);
    assert.match(html, /return downloadSitePhotosInBrowser\(siteInfo, \{ onStatus \}\)/);
  });
});
