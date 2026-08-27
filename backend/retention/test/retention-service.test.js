'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  addCalendarYears,
  assertSafeManagedPrefix,
  buildNoticeEmail,
  createRetentionService,
  expirationForSite,
  maskEmail,
  nextNoticeType,
  policyIdForSite,
} = require('../retention-service');

describe('retention date calculations', () => {
  test('existing galleries receive three years from the policy start', () => {
    const start = new Date('2026-08-27T07:00:00.000Z');
    const expires = expirationForSite({ createdAt: new Date('2024-05-01T12:00:00.000Z') }, start);
    assert.equal(expires.toISOString(), '2029-08-27T07:00:00.000Z');
  });

  test('new galleries receive three years from their own creation time', () => {
    const start = new Date('2026-08-27T07:00:00.000Z');
    const expires = expirationForSite({ createdAt: new Date('2027-02-10T18:15:00.000Z') }, start);
    assert.equal(expires.toISOString(), '2030-02-10T18:15:00.000Z');
  });

  test('leap-day expirations remain in February', () => {
    assert.equal(
      addCalendarYears(new Date('2028-02-29T10:00:00.000Z'), 3).toISOString(),
      '2031-02-28T10:00:00.000Z',
    );
  });
});

describe('storage deletion safety', () => {
  test('accepts a site-scoped managed prefix', () => {
    assert.equal(assertSafeManagedPrefix('/sites/wedding-one'), 'sites/wedding-one/');
  });

  test('rejects empty and broad prefixes', () => {
    assert.throws(() => assertSafeManagedPrefix(''), /unsafe storage prefix/);
    assert.throws(() => assertSafeManagedPrefix('sites/'), /unsafe storage prefix/);
    assert.throws(() => assertSafeManagedPrefix('thumbs/'), /unsafe storage prefix/);
  });

  test('uses a stable policy id across gallery renames that retain a prefix', () => {
    const first = policyIdForSite({ slug: 'first-name', bucket: 'photos', objectPrefix: 'sites/original/' });
    const renamed = policyIdForSite({ slug: 'new-name', bucket: 'photos', objectPrefix: 'sites/original/' });
    assert.equal(first, renamed);
  });

  test('deletes every paginated object only within the managed site prefix', async () => {
    class ListObjectsV2Command { constructor(input) { this.input = input; this.kind = 'list'; } }
    class DeleteObjectsCommand { constructor(input) { this.input = input; this.kind = 'delete'; } }
    const calls = [];
    const s3 = {
      async send(command) {
        calls.push(command);
        if (command.kind === 'delete') return {};
        if (!command.input.ContinuationToken) {
          return { Contents: [{ Key: 'sites/wedding/photo-1.jpg' }], IsTruncated: true, NextContinuationToken: 'next' };
        }
        return { Contents: [{ Key: 'sites/wedding/thumbs/photo-1.jpg' }], IsTruncated: false };
      },
    };
    const service = createRetentionService({
      db: {}, auth: {}, s3, ses: {},
      commands: { ListObjectsV2Command, DeleteObjectsCommand },
      timestampFromDate: date => date,
      fieldDelete: () => null,
      config: {
        policyStart: '2026-08-27T07:00:00.000Z',
        retentionYears: 3,
        managedBucket: 'the-wedding-share',
      },
    });

    const deleted = await service.deleteManagedPrefix({
      bucket: 'the-wedding-share',
      objectPrefix: 'sites/wedding/',
    });
    assert.equal(deleted, 2);
    assert.equal(calls.filter(call => call.kind === 'list').length, 2);
    assert.deepEqual(
      calls.filter(call => call.kind === 'delete').flatMap(call => call.input.Delete.Objects),
      [{ Key: 'sites/wedding/photo-1.jpg' }, { Key: 'sites/wedding/thumbs/photo-1.jpg' }],
    );
  });
});

describe('retention notices', () => {
  const expiresAt = new Date('2029-08-27T07:00:00.000Z');

  test('sends the rollout notice before countdown reminders', () => {
    assert.equal(nextNoticeType({ expiresAt, notifications: {} }, new Date('2029-08-25T07:00:00.000Z')), 'rollout');
  });

  test('sends 30-day and 7-day reminders only once', () => {
    assert.equal(nextNoticeType({
      expiresAt,
      notifications: { rolloutSentAt: new Date() },
    }, new Date('2029-08-01T07:00:00.000Z')), 'thirtyDay');
    assert.equal(nextNoticeType({
      expiresAt,
      notifications: { rolloutSentAt: new Date(), thirtyDaySentAt: new Date() },
    }, new Date('2029-08-22T07:00:00.000Z')), 'sevenDay');
  });

  test('builds a branded notice without allowing HTML injection', () => {
    const email = buildNoticeEmail({
      type: 'rollout',
      title: '<script>alert(1)</script>',
      expiresAt,
      siteUrl: 'https://sharedlens.ca/example',
    });
    assert.match(email.subject, /August 27, 2029/);
    assert.doesNotMatch(email.html, /<script>/);
    assert.match(email.html, /&lt;script&gt;/);
  });

  test('masks owner addresses in recipient previews', () => {
    assert.equal(maskEmail('jared@example.com'), 'j***@example.com');
    assert.equal(maskEmail(''), '');
  });
});
