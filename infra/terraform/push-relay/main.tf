locals {
  name = "push-relay"
}

data "archive_file" "relay" {
  type             = "zip"
  source_file      = var.handler_file
  output_path      = "${path.module}/.build/relay.zip"
  output_file_mode = "0644"
}

# Registered servers and the daily counters. Counters remove themselves through the TTL.
resource "aws_dynamodb_table" "relay" {
  name                        = local.name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

# The Apple .p8 key. Terraform makes the parameter only; the key itself is put in by hand, so it never sits in
# the Terraform state: aws ssm put-parameter --name <name> --type SecureString --overwrite --value file://AuthKey.p8
resource "aws_ssm_parameter" "apns_key" {
  name        = "/${local.name}/apns-key"
  description = "The Apple push key (.p8) the relay signs with"
  type        = "SecureString"
  value       = "replace-me"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_cloudwatch_log_group" "relay" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 14
}

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "relay" {
  name               = local.name
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

data "aws_iam_policy_document" "relay" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.relay.arn}:*"]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.relay.arn]
  }
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.apns_key.arn]
  }
}

resource "aws_iam_role_policy" "relay" {
  name   = local.name
  role   = aws_iam_role.relay.id
  policy = data.aws_iam_policy_document.relay.json
}

resource "aws_lambda_function" "relay" {
  function_name    = local.name
  role             = aws_iam_role.relay.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "handler.handler"
  filename         = data.archive_file.relay.output_path
  source_code_hash = data.archive_file.relay.output_base64sha256
  memory_size      = 256
  timeout          = 15

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.relay.name
  }

  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.relay.name
      APNS_KEY_PARAMETER    = aws_ssm_parameter.apns_key.name
      APNS_KEY_ID           = var.apns_key_id
      APNS_TEAM_ID          = var.apns_team_id
      APNS_BUNDLE_ID        = var.apns_bundle_id
      NOTIFICATIONS_PER_DAY = tostring(var.notifications_per_day)
      REGISTRATIONS_PER_DAY = tostring(var.registrations_per_day)
    }
  }
}

resource "aws_apigatewayv2_api" "relay" {
  name          = local.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "relay" {
  api_id                 = aws_apigatewayv2_api.relay.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.relay.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "relay" {
  for_each  = toset(["POST /v1/installations", "POST /v1/notifications"])
  api_id    = aws_apigatewayv2_api.relay.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.relay.id}"
}

# An overall speed limit on top of each server's daily limit.
resource "aws_apigatewayv2_stage" "relay" {
  api_id      = aws_apigatewayv2_api.relay.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 50
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.relay.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.relay.execution_arn}/*/*"
}

# The certificate is checked through a DNS record added by hand. Make it first (terraform apply
# -target=aws_acm_certificate.relay), add the record from the certificate_check_record output, then apply all.
resource "aws_acm_certificate" "relay" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "relay" {
  certificate_arn = aws_acm_certificate.relay.arn
}

resource "aws_apigatewayv2_domain_name" "relay" {
  domain_name = var.domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.relay.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "relay" {
  api_id      = aws_apigatewayv2_api.relay.id
  domain_name = aws_apigatewayv2_domain_name.relay.id
  stage       = aws_apigatewayv2_stage.relay.id
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
