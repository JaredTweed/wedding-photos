import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const projectId = 'shared-lens-rules-test';
let testEnv;

function donationDoc(context, uid) {
  return doc(context.firestore(), 'donations', uid);
}

function validSite(uid, slug = 'test-wedding') {
  return {
    title: 'Test Wedding',
    slug,
    primaryColor: 'hsl(96 23.7% 54%)',
    region: 'ca-central-1',
    idPool: 'test-pool',
    bucket: 'test-bucket',
    icoImage: '',
    createdBy: uid,
    createdAt: serverTimestamp(),
    plan: 'managed',
    objectPrefix: `sites/${slug}/`,
    theme: 'refined',
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

describe('donation access records', () => {
  test('owners can read only their own donation record', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(donationDoc(context, 'alice'), { hasDonated: true });
    });

    const alice = testEnv.authenticatedContext('alice');
    const bob = testEnv.authenticatedContext('bob');
    const anonymous = testEnv.unauthenticatedContext();

    await assertSucceeds(getDoc(donationDoc(alice, 'alice')));
    await assertFails(getDoc(donationDoc(bob, 'alice')));
    await assertFails(getDoc(donationDoc(anonymous, 'alice')));
  });

  test('the public coupon can create an access record without extra fields', async () => {
    const alice = testEnv.authenticatedContext('alice');

    await assertSucceeds(setDoc(donationDoc(alice, 'alice'), {
      couponCode: 'FREEWEDDING',
    }));
    await assertFails(setDoc(donationDoc(alice, 'alice'), {
      couponCode: 'WRONG',
    }));
    await assertFails(setDoc(donationDoc(alice, 'alice'), {
      couponCode: 'FREEWEDDING',
      hasDonated: true,
    }));
  });

  test('applying the coupon preserves server-managed payment fields', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(donationDoc(context, 'alice'), {
        hasDonated: true,
        stripeSessionId: 'cs_test_123',
      });
    });

    const alice = testEnv.authenticatedContext('alice');
    const ref = donationDoc(alice, 'alice');
    await assertSucceeds(setDoc(ref, { couponCode: 'FREEWEDDING' }, { merge: true }));

    const snapshot = await getDoc(ref);
    assert.deepEqual(snapshot.data(), {
      hasDonated: true,
      stripeSessionId: 'cs_test_123',
      couponCode: 'FREEWEDDING',
    });
  });

  test('clients cannot forge or change paid status', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(donationDoc(context, 'alice'), {
        hasDonated: false,
        couponCode: 'FREEWEDDING',
      });
    });

    const alice = testEnv.authenticatedContext('alice');
    await assertFails(updateDoc(donationDoc(alice, 'alice'), { hasDonated: true }));
    await assertFails(updateDoc(donationDoc(alice, 'alice'), {
      hasDonated: true,
      couponCode: 'FREEWEDDING',
    }));
  });
});

describe('publishing gate', () => {
  test('paid and coupon accounts can publish; unpaid accounts cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(donationDoc(context, 'paid-user'), { hasDonated: true });
      await setDoc(donationDoc(context, 'coupon-user'), { couponCode: 'FREEWEDDING' });
      await setDoc(donationDoc(context, 'unpaid-user'), { hasDonated: false });
    });

    const paid = testEnv.authenticatedContext('paid-user');
    const coupon = testEnv.authenticatedContext('coupon-user');
    const unpaid = testEnv.authenticatedContext('unpaid-user');

    await assertSucceeds(setDoc(
      doc(paid.firestore(), 'sites', 'paid-wedding'),
      validSite('paid-user', 'paid-wedding'),
    ));
    await assertSucceeds(setDoc(
      doc(coupon.firestore(), 'sites', 'coupon-wedding'),
      validSite('coupon-user', 'coupon-wedding'),
    ));
    await assertFails(setDoc(
      doc(unpaid.firestore(), 'sites', 'unpaid-wedding'),
      validSite('unpaid-user', 'unpaid-wedding'),
    ));
  });

  test('only supported gallery themes can be published', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(donationDoc(context, 'paid-user'), { hasDonated: true });
    });

    const paid = testEnv.authenticatedContext('paid-user');
    await assertFails(setDoc(
      doc(paid.firestore(), 'sites', 'invalid-theme'),
      { ...validSite('paid-user', 'invalid-theme'), theme: 'unknown' },
    ));
  });

  test('owners can edit settings without changing backend retention fields', async () => {
    const expiresAt = new Date('2029-08-27T07:00:00.000Z');
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(donationDoc(context, 'paid-user'), { hasDonated: true });
      await setDoc(doc(context.firestore(), 'sites', 'retained-wedding'), {
        ...validSite('paid-user', 'retained-wedding'),
        expiresAt,
        retentionExempt: false,
        retentionPolicyId: 'policy-123',
      });
    });

    const paid = testEnv.authenticatedContext('paid-user');
    const ref = doc(paid.firestore(), 'sites', 'retained-wedding');
    await assertSucceeds(setDoc(ref, { title: 'Updated Wedding' }, { merge: true }));
    await assertFails(updateDoc(ref, { expiresAt: new Date('2035-01-01T00:00:00.000Z') }));
    await assertFails(updateDoc(ref, { retentionExempt: true }));
    await assertFails(updateDoc(ref, { retentionPolicyId: 'another-policy' }));
  });
});
