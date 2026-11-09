locals {
  name = var.name
}

module "network" {
  source   = "../modules/network"
  name     = local.name
  vpc_cidr = var.vpc_cidr
}

resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  vpc_id      = module.network.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_vpc" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "-1"
}

module "data" {
  source                   = "../modules/data"
  name                     = local.name
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.private_subnet_ids
  client_security_group_id = module.app.task_security_group_id
  db_instance_class        = var.db_instance_class
  db_multi_az              = var.db_multi_az
  cache_node_type          = var.cache_node_type
}

resource "aws_lb" "main" {
  name                       = local.name
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = module.network.public_subnet_ids
  drop_invalid_header_fields = true
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = module.app.web_target_group_arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = module.app.api_target_group_arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

module "app" {
  source                = "../modules/app"
  name                  = local.name
  region                = var.region
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.public_subnet_ids
  assign_public_ip      = true
  alb_security_group_id = aws_security_group.alb.id
  public_url            = "https://${var.hostname}"
  image_repository      = var.image_repository
  app_version           = var.app_version
  desired_count         = var.service_desired_count
  secret_arn            = module.data.secret_arn
  listener_rules        = [aws_lb_listener.https.arn, aws_lb_listener_rule.api.arn]
}
