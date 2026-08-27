#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd "$project_dir/../.." && pwd)
aws_region=${AWS_REGION:-ca-central-1}
expected_account_id=339712861752
aws_account_id=$(aws sts get-caller-identity --query Account --output text)
stack_name=sharedlens-gallery-archives
repository_name=sharedlens-gallery-archive-worker
artifact_bucket="sharedlens-retention-deployments-${aws_account_id}"
export_bucket="sharedlens-gallery-exports-${aws_account_id}"
secret_id=sharedlens/firebase-retention-service-account
firebase_api_key=$(sed -n 's/.*apiKey: "\([^"]*\)".*/\1/p' "$repo_dir/form.html" | head -1)

if [[ "$aws_account_id" != "$expected_account_id" ]]; then
  echo "Refusing to deploy to unexpected AWS account ${aws_account_id}." >&2
  exit 1
fi
if [[ -z "$firebase_api_key" ]]; then
  echo "Could not read the Firebase API key from form.html." >&2
  exit 1
fi

if ! aws ecr describe-repositories --region "$aws_region" --repository-names "$repository_name" >/dev/null 2>&1; then
  aws ecr create-repository \
    --region "$aws_region" \
    --repository-name "$repository_name" \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 >/dev/null
fi

registry="${aws_account_id}.dkr.ecr.${aws_region}.amazonaws.com"
image_tag=$(sha256sum "$project_dir/worker/index.js" "$project_dir/shared.js" "$project_dir/package-lock.json" | sha256sum | cut -d' ' -f1)
image_uri="${registry}/${repository_name}:${image_tag}"
aws ecr get-login-password --region "$aws_region" | docker login --username AWS --password-stdin "$registry" >/dev/null
docker build --platform linux/amd64 -f "$project_dir/worker/Dockerfile" -t "$image_uri" "$project_dir" >/dev/null
docker push "$image_uri" >/dev/null
docker logout "$registry" >/dev/null 2>&1 || true

build_dir=$(mktemp -d)
archive_dir=$(mktemp -d)
archive_path="$archive_dir/archive-api.zip"
cleanup() {
  rm -rf "$build_dir" "$archive_dir"
}
trap cleanup EXIT

cp "$project_dir/package.json" "$project_dir/package-lock.json" "$project_dir/shared.js" "$build_dir/"
mkdir -p "$build_dir/api"
cp "$project_dir/api/index.js" "$build_dir/api/"
npm ci --omit=dev --omit=optional --prefix "$build_dir" >/dev/null
(cd "$build_dir" && zip -qr "$archive_path" .)

code_hash=$(sha256sum "$archive_path" | cut -d' ' -f1)
code_key="gallery-archives/api-${code_hash}.zip"
aws s3 cp "$archive_path" "s3://${artifact_bucket}/${code_key}" --only-show-errors

secret_arn=$(aws secretsmanager describe-secret --region "$aws_region" --secret-id "$secret_id" --query ARN --output text)
vpc_id=$(aws ec2 describe-vpcs --region "$aws_region" --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
subnet_ids=$(aws ec2 describe-subnets --region "$aws_region" --filters Name=vpc-id,Values="$vpc_id" Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
security_group_ids=$(aws ec2 describe-security-groups --region "$aws_region" --filters Name=vpc-id,Values="$vpc_id" Name=group-name,Values=default --query 'SecurityGroups[].GroupId' --output text | tr '\t' ',')

aws cloudformation deploy \
  --region "$aws_region" \
  --stack-name "$stack_name" \
  --template-file "$project_dir/cloudformation.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "ApiCodeBucket=${artifact_bucket}" \
    "ApiCodeKey=${code_key}" \
    "WorkerImageUri=${image_uri}" \
    "FirebaseServiceAccountSecretArn=${secret_arn}" \
    "VpcId=${vpc_id}" \
    "SubnetIds=${subnet_ids}" \
    "SecurityGroupIds=${security_group_ids}" \
    "ExportBucketName=${export_bucket}" \
    "FirebaseApiKey=${firebase_api_key}"

aws cloudformation describe-stacks \
  --region "$aws_region" \
  --stack-name "$stack_name" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text
