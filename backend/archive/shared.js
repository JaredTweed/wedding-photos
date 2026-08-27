'use strict';

const crypto = require('node:crypto');

const THUMB_FOLDER = 'thumbs/';
const TRANSCODE_SUFFIX = '_720p.mp4';

function assertSafeGalleryPrefix(value) {
  const prefix = String(value || '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!/^sites\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(prefix)) {
    throw new Error('The gallery storage prefix is not safe.');
  }
  return prefix;
}

function safeArchivePath(value) {
  const parts = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..');
  return parts.join('/');
}

function isOriginalObject(item, prefix) {
  const key = String(item && item.Key || '');
  if (!key.startsWith(prefix)) return false;
  const relativeKey = safeArchivePath(key.slice(prefix.length));
  if (!relativeKey) return false;
  const lower = relativeKey.toLowerCase();
  return !lower.endsWith('.json') &&
    !lower.startsWith(THUMB_FOLDER) &&
    !lower.includes(`/${THUMB_FOLDER}`) &&
    !lower.endsWith(TRANSCODE_SUFFIX);
}

function toOriginal(item, prefix) {
  return {
    key: item.Key,
    archivePath: safeArchivePath(item.Key.slice(prefix.length)),
    size: Number(item.Size || 0),
    etag: String(item.ETag || ''),
    lastModified: item.LastModified ? new Date(item.LastModified).toISOString() : '',
  };
}

function selectOriginals(items, prefixValue) {
  const prefix = assertSafeGalleryPrefix(prefixValue);
  return (items || [])
    .filter(item => isOriginalObject(item, prefix))
    .map(item => toOriginal(item, prefix))
    .sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}

function fingerprintObjects(objects) {
  const hash = crypto.createHash('sha256');
  for (const item of objects || []) {
    hash.update(`${item.key}\0${item.size}\0${item.etag}\0${item.lastModified}\n`);
  }
  return hash.digest('hex');
}

function jobIdFor({ ownerUid, slug, fingerprint }) {
  return crypto.createHash('sha256')
    .update(`${ownerUid}\n${slug}\n${fingerprint}`)
    .digest('hex');
}

function groupArchiveParts(objects, maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('A positive archive size limit is required.');
  const groups = [];
  let current = [];
  let currentBytes = 0;

  for (const item of objects || []) {
    const size = Math.max(0, Number(item.size || 0));
    if (current.length && currentBytes + size > limit) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += size;
  }
  if (current.length) groups.push(current);
  return groups;
}

function totalBytes(objects) {
  return (objects || []).reduce((sum, item) => sum + Math.max(0, Number(item.size || 0)), 0);
}

module.exports = {
  assertSafeGalleryPrefix,
  fingerprintObjects,
  groupArchiveParts,
  jobIdFor,
  safeArchivePath,
  selectOriginals,
  totalBytes,
};
