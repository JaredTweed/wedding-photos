'use strict';

const { createHash } = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addCalendarYears(dateValue, years) {
  const date = asDate(dateValue);
  if (!date) throw new Error('A valid date is required.');

  const targetYear = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    month,
    Math.min(day, lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

function normalizePrefix(value) {
  const clean = String(value || '').replace(/^\/+/, '');
  return clean && !clean.endsWith('/') ? `${clean}/` : clean;
}

function assertSafeManagedPrefix(prefixValue) {
  const prefix = normalizePrefix(prefixValue);
  const segments = prefix.split('/').filter(Boolean);
  if (segments.length < 2 || segments[0] !== 'sites') {
    throw new Error(`Refusing to delete unsafe storage prefix: ${prefix || '(empty)'}`);
  }
  return prefix;
}

function policyIdForSite(site) {
  const bucket = String(site.bucket || '');
  const prefix = normalizePrefix(site.objectPrefix || `sites/${site.slug || ''}`);
  return createHash('sha256').update(`${bucket}\n${prefix}`).digest('hex');
}

function expirationForSite(site, policyStart, years = 3) {
  const start = asDate(policyStart);
  if (!start) throw new Error('A valid retention policy start is required.');
  const createdAt = asDate(site.createdAt);
  const retentionStart = createdAt && createdAt > start ? createdAt : start;
  return addCalendarYears(retentionStart, years);
}

function nextNoticeType(policy, nowValue) {
  const now = asDate(nowValue);
  const expiresAt = asDate(policy.expiresAt);
  if (!now || !expiresAt || policy.exempt || expiresAt <= now) return null;
  const notices = policy.notifications || {};
  if (!notices.rolloutSentAt) return 'rollout';

  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 7 * DAY_MS && !notices.sevenDaySentAt) return 'sevenDay';
  if (remainingMs <= 30 * DAY_MS && !notices.thirtyDaySentAt) return 'thirtyDay';
  return null;
}

function formatExpiryDate(dateValue) {
  const date = asDate(dateValue);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function maskEmail(value) {
  const [local = '', domain = ''] = String(value || '').split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 1)}***@${domain}`;
}

function buildNoticeEmail({ type, title, expiresAt, siteUrl }) {
  const safeTitle = escapeHtml(title || 'Your Shared Lens gallery');
  const safeUrl = escapeHtml(siteUrl);
  const expiry = formatExpiryDate(expiresAt);
  const isRollout = type === 'rollout';
  const timing = type === 'sevenDay' ? 'in 7 days' : type === 'thirtyDay' ? 'in 30 days' : `on ${expiry}`;
  const subject = isRollout
    ? `Your Shared Lens gallery will be available until ${expiry}`
    : `Your Shared Lens gallery expires ${timing}`;
  const intro = isRollout
    ? `Shared Lens now keeps galleries and their photos for three years. Your gallery is scheduled for automatic deletion on ${expiry}.`
    : `This is a reminder that your gallery and all of its photos are scheduled for automatic deletion ${timing}.`;
  const text = `${title || 'Your Shared Lens gallery'}\n\n${intro}\n\nDownload anything you want to keep before that date: ${siteUrl}\n\nThe Shared Lens demo is not affected by this policy.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f6;color:#111;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #d4d4d4;border-radius:2px;padding:28px"><h1 style="margin:0 0 18px;font-size:22px">${safeTitle}</h1><p style="line-height:1.6">${escapeHtml(intro)}</p><p style="line-height:1.6">Download anything you want to keep before that date.</p><p style="margin:24px 0"><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:3px">Open your gallery</a></p><p style="margin:24px 0 0;color:#555;font-size:13px;line-height:1.5">The Shared Lens demo is not affected by this policy.</p></div></div></body></html>`;
  return { subject, text, html };
}

function createRetentionService({
  db,
  auth,
  s3,
  ses,
  commands,
  timestampFromDate,
  fieldDelete,
  config,
  logger = console,
}) {
  const policyStart = asDate(config.policyStart);
  if (!policyStart) throw new Error('RETENTION_POLICY_START must be a valid date.');

  async function deleteManagedPrefix(site) {
    if (site.bucket !== config.managedBucket) {
      throw new Error(`Storage cleanup is not configured for bucket ${site.bucket || '(missing)'}.`);
    }
    const prefix = assertSafeManagedPrefix(site.objectPrefix || `sites/${site.slug || ''}`);
    let continuationToken;
    let deleted = 0;

    do {
      const page = await s3.send(new commands.ListObjectsV2Command({
        Bucket: config.managedBucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      const objects = (page.Contents || []).map(item => ({ Key: item.Key })).filter(item => item.Key);
      if (objects.length) {
        await s3.send(new commands.DeleteObjectsCommand({
          Bucket: config.managedBucket,
          Delete: { Objects: objects, Quiet: true },
        }));
        deleted += objects.length;
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
  }

  async function ensurePolicy(siteDoc) {
    const site = { slug: siteDoc.id, ...siteDoc.data() };
    if (site.slug === config.demoSlug) {
      if (config.mode === 'apply') {
        await siteDoc.ref.set({
          retentionExempt: true,
          expiresAt: fieldDelete(),
          retentionPolicyId: fieldDelete(),
        }, { merge: true });
      }
      return { site, exempt: true };
    }

    const policyId = policyIdForSite(site);
    const policyRef = db.collection(config.policyCollection).doc(policyId);
    const existing = await policyRef.get();
    let policy;

    const policyWasExisting = existing.exists;
    if (policyWasExisting) {
      policy = existing.data();
    } else {
      const expiresAt = expirationForSite(site, policyStart, config.retentionYears);
      policy = {
        status: 'active',
        exempt: false,
        bucket: site.bucket || config.managedBucket,
        objectPrefix: normalizePrefix(site.objectPrefix || `sites/${site.slug}`),
        ownerUid: site.createdBy || '',
        currentSlug: site.slug,
        startedAt: timestampFromDate(asDate(site.createdAt) > policyStart ? asDate(site.createdAt) : policyStart),
        expiresAt: timestampFromDate(expiresAt),
        createdAt: timestampFromDate(new Date()),
        notifications: {},
      };
      if (config.mode === 'apply') await policyRef.set(policy);
    }

    const expiresAt = asDate(policy.expiresAt);
    if (config.mode === 'apply') {
      await policyRef.set({
        ownerUid: site.createdBy || policy.ownerUid || '',
        currentSlug: site.slug,
        updatedAt: timestampFromDate(new Date()),
      }, { merge: true });
      await siteDoc.ref.set({
        retentionExempt: false,
        retentionPolicyId: policyId,
        expiresAt: timestampFromDate(expiresAt),
      }, { merge: true });
    }
    return { site, policy: { ...policy, expiresAt }, policyId, policyRef, policyWasExisting, exempt: false };
  }

  async function sendNotice(item, type) {
    if (!config.emailEnabled || config.mode !== 'apply') return false;
    const uid = item.site.createdBy || item.policy.ownerUid;
    if (!uid) return false;
    const user = await auth.getUser(uid);
    if (!user.email) return false;
    const siteUrl = `${config.siteOrigin}/${encodeURIComponent(item.site.slug)}`;
    const email = buildNoticeEmail({
      type,
      title: item.site.title,
      expiresAt: item.policy.expiresAt,
      siteUrl,
    });
    await ses.send(new commands.SendEmailCommand({
      FromEmailAddress: config.emailFrom,
      Destination: { ToAddresses: [user.email] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: email.text, Charset: 'UTF-8' },
            Html: { Data: email.html, Charset: 'UTF-8' },
          },
        },
      },
    }));
    const marker = type === 'sevenDay'
      ? 'sevenDaySentAt'
      : type === 'thirtyDay'
        ? 'thirtyDaySentAt'
        : 'rolloutSentAt';
    await item.policyRef.set({
      notifications: { ...(item.policy.notifications || {}), [marker]: timestampFromDate(new Date()) },
    }, { merge: true });
    return true;
  }

  async function previewRecipient(item) {
    const uid = item.site.createdBy || item.policy.ownerUid;
    if (!uid) return '';
    const user = await auth.getUser(uid);
    return maskEmail(user.email);
  }

  async function processSite(siteDoc, now, { previewRecipients = false } = {}) {
    const item = await ensurePolicy(siteDoc);
    if (item.exempt) return { slug: item.site.slug, action: 'exempt' };

    if (item.policy.expiresAt <= now) {
      if (config.mode !== 'apply') return { slug: item.site.slug, action: 'would-delete' };
      await item.policyRef.set({ status: 'deleting', deletionStartedAt: timestampFromDate(now) }, { merge: true });
      const deletedObjects = await deleteManagedPrefix(item.site);
      await siteDoc.ref.delete();
      await item.policyRef.set({
        status: 'deleted',
        deletedAt: timestampFromDate(new Date()),
        deletedObjectCount: deletedObjects,
        ownerUid: fieldDelete(),
        currentSlug: fieldDelete(),
      }, { merge: true });
      return { slug: item.site.slug, action: 'deleted', deletedObjects };
    }

    const noticeType = nextNoticeType(item.policy, now);
    const recipient = noticeType && previewRecipients ? await previewRecipient(item) : '';
    const notified = noticeType ? await sendNotice(item, noticeType) : false;
    return {
      slug: item.site.slug,
      action: item.policyWasExisting ? 'retained' : (config.mode === 'apply' ? 'backfilled' : 'would-backfill'),
      expiresAt: item.policy.expiresAt.toISOString(),
      noticeDue: noticeType,
      notified,
      recipient: recipient || undefined,
    };
  }

  async function run(nowValue = new Date(), options = {}) {
    const now = asDate(nowValue);
    const snapshot = await db.collection(config.siteCollection).get();
    const results = [];
    for (const siteDoc of snapshot.docs) {
      try {
        results.push(await processSite(siteDoc, now, options));
      } catch (error) {
        logger.error('Retention processing failed', { slug: siteDoc.id, message: error.message });
        results.push({ slug: siteDoc.id, action: 'error', error: error.message });
      }
    }
    const counts = results.reduce((summary, result) => {
      summary[result.action] = (summary[result.action] || 0) + 1;
      return summary;
    }, {});
    return { mode: config.mode, checkedAt: now.toISOString(), counts, results };
  }

  return { run, deleteManagedPrefix };
}

module.exports = {
  DAY_MS,
  addCalendarYears,
  assertSafeManagedPrefix,
  buildNoticeEmail,
  createRetentionService,
  expirationForSite,
  formatExpiryDate,
  nextNoticeType,
  maskEmail,
  normalizePrefix,
  policyIdForSite,
};
