#!/usr/bin/env bash
# Runs a one-off command as the API on an AWS stage: the same image, task role, secrets, and
# private network as the API service (spec 014 research R10). Waits for it, prints its
# logs, and exits with its exit code.
#
#   AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging migrate
#   AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging demo-seed you@example.com
#   AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging plan show --workspace <uuid>
#   AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging plan topup --workspace <uuid> --replies 250 --note "pilot"
#
# `plan` runs the founder's plan tool (specs 011 and 019): set, show, topup, topups, topup-correct.
set -euo pipefail

usage() {
  echo "usage: scripts/aws-task.sh <stage> migrate | demo-seed <email> | plan <set|show|topup|topups|topup-correct> [options]" >&2
  exit 2
}

stage="${1:-}"
action="${2:-}"
[ -n "$stage" ] && [ -n "$action" ] || usage
case "$stage" in *[!a-z0-9-]*) usage ;; esac

case "$action" in
  migrate)
    command='["node","node_modules/@guidesk/db/dist/cli/migrate.js"]'
    ;;
  demo-seed)
    email="${3:-}"
    # A plain address only, so it can sit inside the JSON override as is.
    case "$email" in
      "" | *[!A-Za-z0-9@._+-]* | *@*@* | @* | *@) usage ;;
      *@*.*) ;;
      *) usage ;;
    esac
    command="[\"node\",\"dist/cli/demo-seed.js\",\"--email\",\"$email\"]"
    ;;
  plan)
    sub="${3:-}"
    case "$sub" in
      set | show | topup | topups | topup-correct) ;;
      *) usage ;;
    esac
    # The tool's own checks validate each option; python3 turns the arguments into a JSON array so
    # notes with spaces or quotes reach it unchanged.
    command=$(python3 -c 'import json, sys; print(json.dumps(["node", "node_modules/@guidesk/db/dist/cli/plan.js"] + sys.argv[1:]))' "${@:3}")
    ;;
  *) usage ;;
esac

# The API service of this stage, found by SST's tags.
service_arn=$(aws resourcegroupstaggingapi get-resources \
  --resource-type-filters ecs:service \
  --tag-filters "Key=sst:app,Values=guidesk" "Key=sst:stage,Values=$stage" \
  --query "ResourceTagMappingList[].ResourceARN" --output text | tr '\t' '\n' | grep -i "/api" | head -1 || true)
if [ -z "$service_arn" ]; then
  echo "No API service found for stage '$stage'. Is it deployed, and is AWS_PROFILE the right account?" >&2
  exit 1
fi
cluster=$(echo "$service_arn" | cut -d/ -f2)
service=$(echo "$service_arn" | cut -d/ -f3)

read -r task_definition subnets security_groups public_ip < <(aws ecs describe-services \
  --cluster "$cluster" --services "$service" \
  --query "services[0].[taskDefinition, join(',', networkConfiguration.awsvpcConfiguration.subnets), join(',', networkConfiguration.awsvpcConfiguration.securityGroups), networkConfiguration.awsvpcConfiguration.assignPublicIp]" \
  --output text)
read -r container log_group log_prefix < <(aws ecs describe-task-definition \
  --task-definition "$task_definition" \
  --query "taskDefinition.containerDefinitions[0].[name, logConfiguration.options.\"awslogs-group\", logConfiguration.options.\"awslogs-stream-prefix\"]" \
  --output text)

echo "Running '$action' on $stage ($cluster/$service)..."
task_arn=$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE \
  --task-definition "$task_definition" \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_groups],assignPublicIp=${public_ip:-DISABLED}}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"$container\",\"command\":$command}]}" \
  --query "tasks[0].taskArn" --output text)
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn"

exit_code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" \
  --query "tasks[0].containers[0].exitCode" --output text)
task_id="${task_arn##*/}"
if [ -n "$log_group" ] && [ "$log_group" != "None" ]; then
  aws logs get-log-events --log-group-name "$log_group" \
    --log-stream-name "$log_prefix/$container/$task_id" \
    --query "events[].message" --output text 2>/dev/null | tr '\t' '\n' || true
fi
echo "Exit code: $exit_code"
[ "$exit_code" = "0" ]
