'use strict';

const { Firestore, Timestamp, FieldValue } = require('@google-cloud/firestore');
const { GoogleAuth } = require('google-auth-library');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { createRetentionService } = require('./retention-service');

let servicePromise;

class FirebaseAuthReader {
  constructor(credentials) {
    this.projectId = credentials.project_id;
    this.googleAuth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  async getUser(uid) {
    const client = await this.googleAuth.getClient();
    const response = await client.request({
      url: `https://identitytoolkit.googleapis.com/v1/projects/${this.projectId}/accounts:lookup`,
      method: 'POST',
      data: { localId: [uid] },
    });
    const user = response.data?.users?.[0];
    if (!user) throw new Error('Gallery owner account was not found.');
    return { email: user.email || '' };
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function createService() {
  const region = process.env.AWS_REGION || 'ca-central-1';
  const secrets = new SecretsManagerClient({ region });
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: required('FIREBASE_SERVICE_ACCOUNT_SECRET') }));
  if (!secret.SecretString) throw new Error('Firebase service-account secret is empty.');
  const serviceAccount = JSON.parse(secret.SecretString);

  const db = new Firestore({ projectId: serviceAccount.project_id, credentials: serviceAccount });

  return createRetentionService({
    db,
    auth: new FirebaseAuthReader(serviceAccount),
    s3: new S3Client({ region }),
    ses: new SESv2Client({ region }),
    commands: { ListObjectsV2Command, DeleteObjectsCommand, SendEmailCommand },
    timestampFromDate: date => Timestamp.fromDate(date),
    fieldDelete: () => FieldValue.delete(),
    config: {
      mode: process.env.RETENTION_MODE === 'apply' ? 'apply' : 'dry-run',
      policyStart: required('RETENTION_POLICY_START'),
      retentionYears: Number(process.env.RETENTION_YEARS || '3'),
      demoSlug: process.env.DEMO_SLUG || 'wedding-photos',
      managedBucket: required('MANAGED_BUCKET'),
      siteCollection: process.env.SITE_COLLECTION || 'sites',
      policyCollection: process.env.POLICY_COLLECTION || 'retentionPolicies',
      siteOrigin: process.env.SITE_ORIGIN || 'https://sharedlens.ca',
      emailEnabled: process.env.EMAIL_ENABLED === 'true',
      emailFrom: process.env.EMAIL_FROM || 'Shared Lens <notifications@sharedlens.ca>',
    },
  });
}

exports.handler = async (event = {}) => {
  servicePromise ||= createService();
  const service = await servicePromise;
  return service.run(new Date(), { previewRecipients: event.previewRecipients === true });
};
