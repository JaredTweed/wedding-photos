'use strict';

const ZipStreamModule = require('zip-stream');
const ZipStream = ZipStreamModule.default || ZipStreamModule;
const { PassThrough } = require('node:stream');
const { ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const {
  assertSafeGalleryPrefix,
  fingerprintObjects,
  groupArchiveParts,
  selectOriginals,
  totalBytes,
} = require('../shared');

const region = process.env.AWS_REGION || 'ca-central-1';
const s3 = new S3Client({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

const config = {
  jobId: required('JOB_ID'),
  slug: required('GALLERY_SLUG'),
  sourcePrefix: assertSafeGalleryPrefix(required('SOURCE_PREFIX')),
  expectedFingerprint: required('EXPECTED_FINGERPRINT'),
  jobsTable: required('JOBS_TABLE'),
  sourceBucket: required('SOURCE_BUCKET'),
  exportBucket: required('EXPORT_BUCKET'),
  maxArchiveBytes: Number(process.env.MAX_ARCHIVE_BYTES || String(4 * 1024 * 1024 * 1024)),
};

async function updateJob(fields) {
  const names = { '#status': 'status' };
  const values = {};
  const assignments = [];
  for (const [key, value] of Object.entries(fields)) {
    const name = key === 'status' ? '#status' : `#${key}`;
    names[name] = key;
    values[`:${key}`] = value;
    assignments.push(`${name} = :${key}`);
  }
  await ddb.send(new UpdateCommand({
    TableName: config.jobsTable,
    Key: { jobId: config.jobId },
    UpdateExpression: `SET ${assignments.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function listOriginals() {
  const items = [];
  let continuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: config.sourceBucket,
      Prefix: config.sourcePrefix,
      ContinuationToken: continuationToken,
    }));
    items.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return selectOriginals(items, config.sourcePrefix);
}

function addEntry(zip, body, options) {
  return new Promise((resolve, reject) => {
    zip.entry(body, options, error => error ? reject(error) : resolve());
  });
}

async function buildArchive(part, partIndex, partCount, progress) {
  const suffix = partCount > 1 ? `-part-${String(partIndex + 1).padStart(2, '0')}-of-${String(partCount).padStart(2, '0')}` : '';
  const filename = `${config.slug}-originals${suffix}.zip`;
  const key = `archives/${config.jobId}/${filename}`;
  const zip = new ZipStream({ forceZip64: true, store: true });
  const uploadBody = new PassThrough();
  zip.pipe(uploadBody);
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: config.exportBucket,
      Key: key,
      Body: uploadBody,
      ContentType: 'application/zip',
      ContentDisposition: `attachment; filename="${filename}"`,
      ServerSideEncryption: 'AES256',
      Metadata: { 'sharedlens-job-id': config.jobId },
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });
  const uploadPromise = upload.done();
  let lastProgressUpdate = 0;

  try {
    for (const item of part) {
      const object = await s3.send(new GetObjectCommand({ Bucket: config.sourceBucket, Key: item.key }));
      await addEntry(zip, object.Body, {
        name: item.archivePath,
        store: true,
        date: item.lastModified ? new Date(item.lastModified) : new Date(),
      });
      progress.completedFiles += 1;
      progress.completedBytes += item.size;
      const now = Date.now();
      if (now - lastProgressUpdate >= 2000 || progress.completedFiles === progress.totalFiles) {
        await updateJob({
          status: 'processing',
          completedFiles: progress.completedFiles,
          completedBytes: progress.completedBytes,
          updatedAt: new Date(now).toISOString(),
        });
        lastProgressUpdate = now;
      }
    }
    zip.finalize();
    const result = await uploadPromise;
    return { key, filename, size: totalBytes(part), etag: result.ETag || '' };
  } catch (error) {
    zip.destroy(error);
    uploadBody.destroy(error);
    await uploadPromise.catch(() => {});
    throw error;
  }
}

async function main() {
  const uploaded = [];
  try {
    await updateJob({ status: 'processing', updatedAt: new Date().toISOString() });
    const originals = await listOriginals();
    if (!originals.length) throw new Error('No original gallery files were found.');
    if (fingerprintObjects(originals) !== config.expectedFingerprint) {
      throw new Error('The gallery changed while its archive was being prepared.');
    }

    const parts = groupArchiveParts(originals, config.maxArchiveBytes);
    const progress = {
      totalFiles: originals.length,
      completedFiles: 0,
      completedBytes: 0,
    };
    for (let index = 0; index < parts.length; index += 1) {
      const archive = await buildArchive(parts[index], index, parts.length, progress);
      uploaded.push(archive);
    }

    await updateJob({
      status: 'completed',
      archives: uploaded,
      completedFiles: originals.length,
      completedBytes: totalBytes(originals),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Archive worker failed', error);
    await Promise.all(uploaded.map(item => s3.send(new DeleteObjectCommand({
      Bucket: config.exportBucket,
      Key: item.key,
    })).catch(() => {})));
    await updateJob({
      status: 'failed',
      errorMessage: error.message.includes('gallery changed')
        ? 'The gallery changed while the archive was being prepared. Start the download again.'
        : 'The archive could not be prepared. Please try again.',
      updatedAt: new Date().toISOString(),
    }).catch(updateError => console.error('Could not record archive failure', updateError));
    process.exitCode = 1;
  }
}

main();
