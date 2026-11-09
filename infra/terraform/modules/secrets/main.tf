variable "name" {
  type = string
}

variable "database_endpoint" {
  description = "Database host and port."
  type        = string
}

variable "redis_url" {
  type      = string
  sensitive = true
}

locals {
  database   = "devdash"
  owner_user = "devdash_owner"
  app_user   = "devdash_app"
}

resource "random_password" "owner" {
  length  = 40
  special = false
}

resource "random_password" "app" {
  length  = 40
  special = false
}

resource "random_id" "token_encryption_key" {
  byte_length = 32
}

resource "aws_secretsmanager_secret" "runtime" {
  name_prefix             = "${var.name}/runtime-"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "runtime" {
  secret_id = aws_secretsmanager_secret.runtime.id
  secret_string = jsonencode({
    DATABASE_URL           = "postgres://${local.app_user}:${random_password.app.result}@${var.database_endpoint}/${local.database}?sslmode=verify-full"
    MIGRATION_DATABASE_URL = "postgres://${local.owner_user}:${random_password.owner.result}@${var.database_endpoint}/${local.database}?sslmode=verify-full"
    APP_DB_PASSWORD        = random_password.app.result
    REDIS_URL              = var.redis_url
    TOKEN_ENCRYPTION_KEY   = random_id.token_encryption_key.b64_std
  })
}

output "secret_arn" {
  value = aws_secretsmanager_secret.runtime.arn
}

output "database" {
  value = local.database
}

output "owner_user" {
  value = local.owner_user
}

output "owner_password" {
  value     = random_password.owner.result
  sensitive = true
}
