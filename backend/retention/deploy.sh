#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
aws_region=${AWS_REGION:-ca-central-1}
aws_account_id=$(aws sts get-caller-identity --query Account --output text)
artifact_bucket="sharedlens-retention-deployments-${aws_account_id}"
secret_id="sharedlens/firebase-retention-service-account"
stack_name="sharedlens-retention"
retention_mode=${RETENTION_MODE:-dry-run}
email_enabled=${EMAIL_ENABLED:-false}
schedule_state=${SCHEDULE_STATE:-DISABLED}

if [[ "$aws_account_id" != "339712861752" ]]; then
  echo "Refusing to deploy to unexpected AWS account ${aws_account_id}." >&2
  exit 1
fi

if ! aws s3api head-bucket --bucket "$artifact_bucket" >/dev/null 2>&1; then
  aws s3api create-bucket \
    --bucket "$artifact_bucket" \
    --region "$aws_region" \
    --create-bucket-configuration "LocationConstraint=${aws_region}" >/dev/null
  aws s3api put-public-access-block \
    --bucket "$artifact_bucket" \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption \
    --bucket "$artifact_bucket" \
    --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
fi

build_dir=$(mktemp -d)
archive_dir=$(mktemp -d)
archive_path="$archive_dir/function.zip"
cleanup() {
  rm -rf "$build_dir"
  rm -rf "$archive_dir"
}
trap cleanup EXIT

cp "$project_dir/index.js" "$project_dir/retention-service.js" "$project_dir/package.json" "$project_dir/package-lock.json" "$build_dir/"
npm ci --omit=dev --omit=optional --prefix "$build_dir" >/dev/null
(cd "$build_dir" && zip -qr "$archive_path" .)

code_hash=$(sha256sum "$archive_path" | cut -d' ' -f1)
code_key="retention/${code_hash}.zip"
aws s3 cp "$archive_path" "s3://${artifact_bucket}/${code_key}" --only-show-errors
secret_arn=$(aws secretsmanager describe-secret --region "$aws_region" --secret-id "$secret_id" --query ARN --output text)

aws cloudformation deploy \
  --region "$aws_region" \
  --stack-name "$stack_name" \
  --template-file "$project_dir/cloudformation.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "CodeBucket=${artifact_bucket}" \
    "CodeKey=${code_key}" \
    "FirebaseServiceAccountSecretArn=${secret_arn}" \
    "RetentionMode=${retention_mode}" \
    "EmailEnabled=${email_enabled}" \
    "ScheduleState=${schedule_state}"

echo "Retention service deployed in ${retention_mode} mode with schedule ${schedule_state}."
