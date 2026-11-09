data "aws_lb" "existing" {
  name = var.load_balancer_name
}

data "aws_lb_listener" "https" {
  load_balancer_arn = data.aws_lb.existing.arn
  port              = 443
}

data "aws_rds_cluster" "existing" {
  cluster_identifier = var.database_cluster
}

data "aws_elasticache_replication_group" "existing" {
  replication_group_id = var.cache_replication_group
}

data "aws_elasticache_cluster" "existing" {
  cluster_id = sort(data.aws_elasticache_replication_group.existing.member_clusters)[0]
}

locals {
  public_url            = "https://${var.hostname}"
  alb_security_group_id = tolist(data.aws_lb.existing.security_groups)[0]
  app_ports             = { web = 3000, api = 4000 }
  cache_login           = var.cache_auth_token == null ? "" : ":${var.cache_auth_token}@"
  # A cluster-mode cache has only a configuration endpoint and database 0; PulseGrid keeps its keys apart with a hash tag.
  cache_cluster  = coalesce(data.aws_elasticache_replication_group.existing.configuration_endpoint_address, "none") != "none"
  cache_endpoint = local.cache_cluster ? data.aws_elasticache_replication_group.existing.configuration_endpoint_address : data.aws_elasticache_replication_group.existing.primary_endpoint_address
  redis_url      = "rediss://${local.cache_login}${local.cache_endpoint}:6379${local.cache_cluster ? "" : "/${var.cache_database}"}"
  data_access = {
    postgres = { security_group_id = tolist(data.aws_rds_cluster.existing.vpc_security_group_ids)[0], port = 5432 }
    valkey   = { security_group_id = tolist(data.aws_elasticache_cluster.existing.security_group_ids)[0], port = 6379 }
  }
}

module "secrets" {
  source            = "../modules/secrets"
  name              = var.name
  database_endpoint = "${data.aws_rds_cluster.existing.endpoint}:${data.aws_rds_cluster.existing.port}"
  redis_url         = local.redis_url
}

module "app" {
  source                = "../modules/app"
  name                  = var.name
  region                = var.region
  vpc_id                = data.aws_lb.existing.vpc_id
  subnet_ids            = var.subnet_ids
  alb_security_group_id = local.alb_security_group_id
  public_url            = local.public_url
  assign_public_ip      = false
  image_repository      = var.image_repository
  app_version           = var.app_version
  desired_count         = var.desired_count
  secret_arn            = module.secrets.secret_arn
  listener_rules        = [aws_lb_listener_rule.api.arn, aws_lb_listener_rule.web.arn]
  redis_cluster         = local.cache_cluster
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  for_each                     = local.app_ports
  security_group_id            = local.alb_security_group_id
  referenced_security_group_id = module.app.task_security_group_id
  from_port                    = each.value
  to_port                      = each.value
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "tasks_to_data" {
  for_each                     = local.data_access
  security_group_id            = each.value.security_group_id
  referenced_security_group_id = module.app.task_security_group_id
  from_port                    = each.value.port
  to_port                      = each.value.port
  ip_protocol                  = "tcp"
}

resource "aws_lb_listener_certificate" "hostname" {
  count           = var.certificate_arn == null ? 0 : 1
  listener_arn    = data.aws_lb_listener.https.arn
  certificate_arn = var.certificate_arn
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = module.app.api_target_group_arn
  }

  condition {
    host_header {
      values = [var.hostname]
    }
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  dynamic "condition" {
    for_each = length(var.allowed_cidrs) > 0 ? [var.allowed_cidrs] : []

    content {
      source_ip {
        values = condition.value
      }
    }
  }
}

resource "aws_lb_listener_rule" "web" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = var.listener_rule_priority + 1

  action {
    type             = "forward"
    target_group_arn = module.app.web_target_group_arn
  }

  condition {
    host_header {
      values = [var.hostname]
    }
  }

  dynamic "condition" {
    for_each = length(var.allowed_cidrs) > 0 ? [var.allowed_cidrs] : []

    content {
      source_ip {
        values = condition.value
      }
    }
  }
}
