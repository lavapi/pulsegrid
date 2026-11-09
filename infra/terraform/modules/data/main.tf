variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "client_security_group_id" {
  type = string
}

variable "db_instance_class" {
  type = string
}

variable "db_multi_az" {
  type = bool
}

variable "cache_node_type" {
  type = string
}

module "secrets" {
  source            = "../secrets"
  name              = var.name
  database_endpoint = aws_db_instance.main.endpoint
  redis_url         = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
}

resource "aws_security_group" "data" {
  name_prefix = "${var.name}-data-"
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  security_group_id            = aws_security_group.data.id
  referenced_security_group_id = var.client_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "redis" {
  security_group_id            = aws_security_group.data.id
  referenced_security_group_id = var.client_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_db_subnet_group" "main" {
  name_prefix = "${var.name}-"
  subnet_ids  = var.subnet_ids
}

resource "aws_db_instance" "main" {
  identifier_prefix         = "${var.name}-"
  engine                    = "postgres"
  engine_version            = "18"
  instance_class            = var.db_instance_class
  allocated_storage         = 20
  max_allocated_storage     = 200
  storage_encrypted         = true
  db_name                   = module.secrets.database
  username                  = module.secrets.owner_user
  password                  = module.secrets.owner_password
  db_subnet_group_name      = aws_db_subnet_group.main.name
  vpc_security_group_ids    = [aws_security_group.data.id]
  multi_az                  = var.db_multi_az
  backup_retention_period   = 7
  deletion_protection       = true
  final_snapshot_identifier = "${var.name}-final"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_parameter_group" "main" {
  name   = var.name
  family = "valkey8"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = var.name
  description                = "Queues and short-lived app data"
  engine                     = "valkey"
  engine_version             = "8.0"
  node_type                  = var.cache_node_type
  num_cache_clusters         = 1
  parameter_group_name       = aws_elasticache_parameter_group.main.name
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.data.id]
}

output "secret_arn" {
  value = module.secrets.secret_arn
}
