'use strict';

const { Firestore } = require('@google-cloud/firestore');
const { ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { ECSClient, RunTaskCommand, DescribeTasksCommand } = require('@aws-sdk/client-ecs');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  assertSafeGalleryPrefix,
  fingerprintObjects,
  jobIdFor,
  selectOriginals,
  totalBytes,
} = require('../shared');

const region = process.env.AWS_REGION || 'ca-central-1';
const s3 = new S3Client({ region });
const ecs = new ECSClient({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});
const secrets = new SecretsManagerClient({ region });
let firestorePromise;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

const config = {
  tableName: required('JOBS_TABLE'),
  sourceBucket: required('SOURCE_BUCKET'),
  exportBucket: required('EXPORT_BUCKET'),
  clusterArn: required('ECS_CLUSTER_ARN'),
  taskDefinitionArn: required('TASK_DEFINITION_ARN'),
  taskContainerName: process.env.TASK_CONTAINER_NAME || 'archive-worker',
  subnetIds: required('SUBNET_IDS').split(',').filter(Boolean),
  securityGroupIds: required('SECURITY_GROUP_IDS').split(',').filter(Boolean),
  firebaseApiKey: required('FIREBASE_API_KEY'),
  firebaseSecretArn: required('FIREBASE_SERVICE_ACCOUNT_SECRET'),
  jobLifetimeSeconds: Number(process.env.JOB_LIFETIME_SECONDS || '86400'),
  signedUrlSeconds: Number(process.env.SIGNED_URL_SECONDS || '900'),
};

function headers() {
  return {
    'access-control-allow-origin': 'https://sharedlens.ca',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'vary': 'Origin',
  };
}

function response(statusCode, body) {
  return { statusCode, headers: headers(), body: JSON.stringify(body) };
}

function errorResponse(statusCode, code, message) {
  return response(statusCode, { error: code, message });
}

function bearerToken(event) {
  const value = event.headers && (event.headers.authorization || event.headers.Authorization) || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function authenticatedUid(event) {
  const token = bearerToken(event);
  if (!token) return '';
  const result = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.firebaseApiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  if (!result.ok) return '';
  const payload = await result.json();
  return payload.users && payload.users[0] && payload.users[0].localId || '';
}

async function getFirestore() {
  if (!firestorePromise) {
    firestorePromise = (async () => {
      const result = await secrets.send(new GetSecretValueCommand({ SecretId: config.firebaseSecretArn }));
      if (!result.SecretString) throw new Error('Firebase service-account secret is empty.');
      const credentials = JSON.parse(result.SecretString);
      return new Firestore({ projectId: credentials.project_id, credentials });
    })().catch(error => {
      firestorePromise = null;
      throw error;
    });
  }
  return firestorePromise;
}

async function listGalleryObjects(prefix) {
  const items = [];
  let continuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: config.sourceBucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    items.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return selectOriginals(items, prefix);
}

async function getJob(jobId) {
  const result = await ddb.send(new GetCommand({ TableName: config.tableName, Key: { jobId } }));
  return result.Item || null;
}

async function markStoppedTaskFailed(job) {
  if (!job.taskArn || !['queued', 'processing'].includes(job.status)) return job;
  const result = await ecs.send(new DescribeTasksCommand({ cluster: config.clusterArn, tasks: [job.taskArn] }));
  const task = result.tasks && result.tasks[0];
  if (!task || task.lastStatus !== 'STOPPED') return job;

  const updatedAt = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { jobId: job.jobId },
    UpdateExpression: 'SET #status = :failed, errorMessage = :message, updatedAt = :updatedAt',
    ConditionExpression: '#status IN (:queued, :processing)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':failed': 'failed',
      ':queued': 'queued',
      ':processing': 'processing',
      ':message': 'The archive could not be prepared. Please try again.',
      ':updatedAt': updatedAt,
    },
  })).catch(() => {});
  return { ...job, status: 'failed', errorMessage: 'The archive could not be prepared. Please try again.', updatedAt };
}

async function publicJob(job) {
  const payload = {
    jobId: job.jobId,
    slug: job.slug,
    status: job.status,
    totalFiles: Number(job.totalFiles || 0),
    totalBytes: Number(job.totalBytes || 0),
    completedFiles: Number(job.completedFiles || 0),
    completedBytes: Number(job.completedBytes || 0),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
  };
  if (job.status === 'failed') payload.message = job.errorMessage || 'The archive could not be prepared. Please try again.';
  if (job.status === 'completed') {
    payload.downloads = await Promise.all((job.archives || []).map(async archive => ({
      filename: archive.filename,
      size: Number(archive.size || 0),
      url: await getSignedUrl(s3, new GetObjectCommand({
        Bucket: config.exportBucket,
        Key: archive.key,
        ResponseContentDisposition: `attachment; filename="${String(archive.filename).replace(/["\r\n]/g, '')}"`,
      }), { expiresIn: config.signedUrlSeconds }),
    })));
    payload.urlExpiresInSeconds = config.signedUrlSeconds;
  }
  return payload;
}

async function startTask(job) {
  const result = await ecs.send(new RunTaskCommand({
    cluster: config.clusterArn,
    taskDefinition: config.taskDefinitionArn,
    launchType: 'FARGATE',
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: config.subnetIds,
        securityGroups: config.securityGroupIds,
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [{
        name: config.taskContainerName,
        environment: [
          { name: 'JOB_ID', value: job.jobId },
          { name: 'GALLERY_SLUG', value: job.slug },
          { name: 'SOURCE_PREFIX', value: job.sourcePrefix },
          { name: 'EXPECTED_FINGERPRINT', value: job.fingerprint },
        ],
      }],
    },
  }));
  if ((result.failures || []).length || !(result.tasks && result.tasks[0] && result.tasks[0].taskArn)) {
    throw new Error('AWS did not start the archive task.');
  }
  const taskArn = result.tasks[0].taskArn;
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { jobId: job.jobId },
    UpdateExpression: 'SET taskArn = :taskArn, updatedAt = :updatedAt',
    ExpressionAttributeValues: { ':taskArn': taskArn, ':updatedAt': new Date().toISOString() },
  }));
}

async function createExport(event, uid) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'INVALID_REQUEST', 'The download request is not valid.');
  }
  const slug = String(body.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return errorResponse(400, 'INVALID_SLUG', 'The gallery name is not valid.');
  }

  const db = await getFirestore();
  const snapshot = await db.collection('sites').doc(slug).get();
  if (!snapshot.exists) return errorResponse(404, 'NOT_FOUND', 'That gallery could not be found.');
  const site = snapshot.data();
  if (site.createdBy !== uid) return errorResponse(403, 'FORBIDDEN', 'Only the gallery owner can download all originals.');
  const plan = site.plan || 'managed';
  if (plan !== 'managed') {
    return errorResponse(400, 'SELF_MANAGED', 'Server-prepared downloads are available for managed galleries only.');
  }
  if (site.bucket && site.bucket !== config.sourceBucket) {
    return errorResponse(400, 'UNSUPPORTED_STORAGE', 'This gallery does not use managed storage.');
  }

  const sourcePrefix = assertSafeGalleryPrefix(site.objectPrefix || `sites/${slug}/`);
  const originals = await listGalleryObjects(sourcePrefix);
  if (!originals.length) return errorResponse(409, 'NO_FILES', 'There are no original photos or videos to download yet.');

  const fingerprint = fingerprintObjects(originals);
  const jobId = jobIdFor({ ownerUid: uid, slug, fingerprint });
  let job = await getJob(jobId);
  const now = Date.now();
  if (job && Number(job.expiresAt || 0) > Math.floor(now / 1000)) {
    job = await markStoppedTaskFailed(job);
    if (job.status !== 'failed') return response(200, await publicJob(job));

    const retriedAt = new Date(now).toISOString();
    job = {
      ...job,
      status: 'queued',
      completedFiles: 0,
      completedBytes: 0,
      updatedAt: retriedAt,
      expiresAt: Math.floor(now / 1000) + config.jobLifetimeSeconds,
    };
    delete job.errorMessage;
    delete job.archives;
    delete job.taskArn;
    await ddb.send(new UpdateCommand({
      TableName: config.tableName,
      Key: { jobId },
      UpdateExpression: 'SET #status = :queued, completedFiles = :zero, completedBytes = :zero, updatedAt = :updatedAt, expiresAt = :expiresAt REMOVE errorMessage, archives, taskArn',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':queued': 'queued',
        ':zero': 0,
        ':updatedAt': retriedAt,
        ':expiresAt': job.expiresAt,
      },
    }));
    try {
      await startTask(job);
    } catch (error) {
      console.error('Failed to restart archive task', error);
      job.status = 'failed';
      job.errorMessage = 'The archive could not be started. Please try again.';
      await ddb.send(new UpdateCommand({
        TableName: config.tableName,
        Key: { jobId },
        UpdateExpression: 'SET #status = :failed, errorMessage = :message, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':message': job.errorMessage,
          ':updatedAt': new Date().toISOString(),
        },
      }));
    }
    return response(job.status === 'failed' ? 500 : 202, await publicJob(job));
  }

  const nowIso = new Date(now).toISOString();
  job = {
    jobId,
    ownerUid: uid,
    slug,
    sourcePrefix,
    fingerprint,
    status: 'queued',
    totalFiles: originals.length,
    totalBytes: totalBytes(originals),
    completedFiles: 0,
    completedBytes: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: Math.floor(now / 1000) + config.jobLifetimeSeconds,
  };

  try {
    await ddb.send(new PutCommand({
      TableName: config.tableName,
      Item: job,
      ConditionExpression: 'attribute_not_exists(jobId) OR expiresAt <= :nowEpoch',
      ExpressionAttributeValues: { ':nowEpoch': Math.floor(now / 1000) },
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      const existing = await getJob(jobId);
      if (existing) return response(200, await publicJob(existing));
    }
    throw error;
  }

  try {
    await startTask(job);
  } catch (error) {
    console.error('Failed to start archive task', error);
    job.status = 'failed';
    job.errorMessage = 'The archive could not be started. Please try again.';
    job.updatedAt = new Date().toISOString();
    await ddb.send(new UpdateCommand({
      TableName: config.tableName,
      Key: { jobId },
      UpdateExpression: 'SET #status = :failed, errorMessage = :message, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':failed': job.status, ':message': job.errorMessage, ':updatedAt': job.updatedAt },
    }));
  }
  return response(202, await publicJob(job));
}

async function getExport(event, uid) {
  const jobId = String(event.pathParameters && event.pathParameters.jobId || '');
  if (!/^[a-f0-9]{64}$/.test(jobId)) return errorResponse(400, 'INVALID_JOB', 'The archive request is not valid.');
  let job = await getJob(jobId);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'That archive request could not be found.');
  if (job.ownerUid !== uid) return errorResponse(403, 'FORBIDDEN', 'You do not have access to that archive.');
  job = await markStoppedTaskFailed(job);
  return response(200, await publicJob(job));
}

exports.handler = async event => {
  try {
    if (event.requestContext && event.requestContext.http && event.requestContext.http.method === 'OPTIONS') {
      return { statusCode: 204, headers: headers(), body: '' };
    }
    const uid = await authenticatedUid(event);
    if (!uid) return errorResponse(401, 'UNAUTHENTICATED', 'Please sign in again to download the gallery.');

    const method = event.requestContext && event.requestContext.http && event.requestContext.http.method;
    const routeKey = event.routeKey || '';
    if (method === 'POST' && routeKey === 'POST /exports') return await createExport(event, uid);
    if (method === 'GET' && routeKey === 'GET /exports/{jobId}') return await getExport(event, uid);
    return errorResponse(404, 'NOT_FOUND', 'The requested archive action was not found.');
  } catch (error) {
    console.error('Archive API request failed', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'The archive service is temporarily unavailable. Please try again.');
  }
};
