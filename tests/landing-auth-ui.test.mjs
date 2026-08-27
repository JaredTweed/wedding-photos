import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

let html;

before(async () => {
  html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
});

describe('landing-page gallery action', () => {
  test('starts disabled while authentication is loading', () => {
    assert.match(html, /id="galleryActionButton"[^>]*disabled/);
    assert.match(html, /<span id="galleryActionText">Checking your account…<\/span>/);
    assert.match(html, /id="galleryActionGoogleIcon"[^>]*hidden/);
  });

  test('shows the requested signed-out and signed-in states', () => {
    assert.match(
      html,
      /galleryActionGoogleIcon\.hidden = !!user;/,
    );
    assert.match(
      html,
      /user \? 'Manage your gallery' : 'Create your gallery'/,
    );
    assert.match(html, /auth\.onAuthStateChanged\(updateGalleryAction\)/);
  });
});
