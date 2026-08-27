'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const {
  assertSafeGalleryPrefix,
  fingerprintObjects,
  groupArchiveParts,
  jobIdFor,
  safeArchivePath,
  selectOriginals,
  totalBytes,
} = require('../shared');

describe('gallery archive safety', () => {
  test('accepts only a gallery-scoped managed prefix', () => {
    assert.equal(assertSafeGalleryPrefix('/sites/example-wedding/'), 'sites/example-wedding/');
    for (const unsafe of ['', 'sites/', 'thumbs/', 'sites/../', 'sites/example/photos/']) {
      assert.throws(() => assertSafeGalleryPrefix(unsafe));
    }
  });

  test('normalizes archive paths without traversal', () => {
    assert.equal(safeArchivePath('../photos\\one.jpg'), 'photos/one.jpg');
  });

  test('includes originals and excludes metadata, thumbnails, and transcodes', () => {
    const prefix = 'sites/wedding/';
    const selected = selectOriginals([
      { Key: `${prefix}photo.jpg`, Size: 10, ETag: 'a' },
      { Key: `${prefix}details.json`, Size: 1, ETag: 'b' },
      { Key: `${prefix}thumbs/photo.jpg`, Size: 2, ETag: 'c' },
      { Key: `${prefix}clip_720p.mp4`, Size: 3, ETag: 'd' },
      { Key: 'sites/other/photo.jpg', Size: 4, ETag: 'e' },
    ], prefix);
    assert.deepEqual(selected.map(item => item.archivePath), ['photo.jpg']);
    assert.equal(totalBytes(selected), 10);
  });
});

describe('archive reuse and splitting', () => {
  const objects = [
    { key: 'sites/x/a.jpg', archivePath: 'a.jpg', size: 6, etag: 'a', lastModified: '' },
    { key: 'sites/x/b.jpg', archivePath: 'b.jpg', size: 6, etag: 'b', lastModified: '' },
    { key: 'sites/x/c.jpg', archivePath: 'c.jpg', size: 2, etag: 'c', lastModified: '' },
  ];

  test('creates deterministic content and owner-specific job ids', () => {
    const fingerprint = fingerprintObjects(objects);
    assert.equal(fingerprint, fingerprintObjects(objects));
    assert.equal(jobIdFor({ ownerUid: 'one', slug: 'x', fingerprint }), jobIdFor({ ownerUid: 'one', slug: 'x', fingerprint }));
    assert.notEqual(jobIdFor({ ownerUid: 'one', slug: 'x', fingerprint }), jobIdFor({ ownerUid: 'two', slug: 'x', fingerprint }));
  });

  test('splits archives near the configured byte limit without splitting files', () => {
    const parts = groupArchiveParts(objects, 10);
    assert.deepEqual(parts.map(part => part.map(item => item.archivePath)), [['a.jpg'], ['b.jpg', 'c.jpg']]);
  });

  test('keeps a single oversized file in its own archive part', () => {
    const parts = groupArchiveParts([{ ...objects[0], size: 20 }, objects[1]], 10);
    assert.deepEqual(parts.map(part => part.length), [1, 1]);
  });
});

test('the worker can construct the installed streaming ZIP implementation', () => {
  const { PassThrough, Readable } = require('node:stream');
  const ZipStreamModule = require('zip-stream');
  const ZipStream = ZipStreamModule.default || ZipStreamModule;
  const stream = new ZipStream({ forceZip64: true, store: true });
  const uploadBody = new PassThrough();
  stream.pipe(uploadBody);
  assert.equal(typeof stream.entry, 'function');
  assert.equal(uploadBody instanceof Readable, true);
  stream.destroy();
  uploadBody.destroy();
});
