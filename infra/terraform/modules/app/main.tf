variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "public_url" {
  type = string
}

variable "image_repository" {
  description = "Images are named <repository>-api and <repository>-web."
  type        = string
}

variable "app_version" {
  type = string
}

variable "assign_public_ip" {
  description = "True when the subnets reach the internet directly rather than through NAT."
  type        = bool
}

variable "desired_count" {
  description = "Tasks to run for the API and the web app."
  type        = number
}

variable "secret_arn" {
  description = "Secret holding DATABASE_URL, MIGRATION_DATABASE_URL, APP_DB_PASSWORD, REDIS_URL and TOKEN_ENCRYPTION_KEY."
  type        = string
}

variable "listener_rules" {
  description = "Listener rules that attach the target groups to the load balancer."
  type        = list(string)
}

variable "redis_cluster" {
  description = "The cache runs in cluster mode (REDIS_CLUSTER): connect through its configuration endpoint, with hash-tagged keys."
  type        = bool
  default     = false
}

resource "aws_security_group" "tasks" {
  name_prefix = "${var.name}-tasks-"
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_egress_rule" "tasks_all" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_ecs_cluster" "main" {
  name = var.name
}

locals {
  api_image = "${var.image_repository}-api:${var.app_version}"
  web_image = "${var.image_repository}-web:${var.app_version}"
  app_environment = {
    PUBLIC_URL    = var.public_url
    REDIS_CLUSTER = tostring(var.redis_cluster)
  }
  app_secrets = {
    DATABASE_URL         = "${var.secret_arn}:DATABASE_URL::"
    REDIS_URL            = "${var.secret_arn}:REDIS_URL::"
    TOKEN_ENCRYPTION_KEY = "${var.secret_arn}:TOKEN_ENCRYPTION_KEY::"
  }
}

module "api_task" {
  source         = "../task"
  name           = "${var.name}-api"
  region         = var.region
  image          = local.api_image
  container_port = 4000
  environment    = local.app_environment
  secrets        = local.app_secrets
  secret_arns    = [var.secret_arn]
  init_command   = ["node", "dist/database/migrate.cli.js"]

  init_secrets = {
    MIGRATION_DATABASE_URL = "${var.secret_arn}:MIGRATION_DATABASE_URL::"
    APP_DB_PASSWORD        = "${var.secret_arn}:APP_DB_PASSWORD::"
  }
}

module "worker_task" {
  source      = "../task"
  name        = "${var.name}-worker"
  region      = var.region
  image       = local.api_image
  command     = ["node", "dist/worker.js"]
  environment = local.app_environment
  secrets     = local.app_secrets
  secret_arns = [var.secret_arn]
}

module "web_task" {
  source         = "../task"
  name           = "${var.name}-web"
  region         = var.region
  image          = local.web_image
  container_port = 3000
  cpu            = 256
  memory         = 512

  environment = {
    API_URL = var.public_url
  }
}

resource "aws_ecs_service" "worker" {
  name            = "${var.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = module.worker_task.task_definition_arn
  desired_count   = min(var.desired_count, 1)
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = var.assign_public_ip
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

module "api_service" {
  source                 = "../service"
  name                   = "${var.name}-api"
  vpc_id                 = var.vpc_id
  cluster_id             = aws_ecs_cluster.main.id
  task_definition_arn    = module.api_task.task_definition_arn
  container_port         = 4000
  health_check_path      = "/api/health"
  desired_count          = var.desired_count
  subnet_ids             = var.subnet_ids
  task_security_group_id = aws_security_group.tasks.id
  alb_security_group_id  = var.alb_security_group_id
  assign_public_ip       = var.assign_public_ip
  listener_rules         = var.listener_rules
}

module "web_service" {
  source                 = "../service"
  name                   = "${var.name}-web"
  vpc_id                 = var.vpc_id
  cluster_id             = aws_ecs_cluster.main.id
  task_definition_arn    = module.web_task.task_definition_arn
  container_port         = 3000
  health_check_path      = "/login"
  desired_count          = var.desired_count
  subnet_ids             = var.subnet_ids
  task_security_group_id = aws_security_group.tasks.id
  alb_security_group_id  = var.alb_security_group_id
  assign_public_ip       = var.assign_public_ip
  listener_rules         = var.listener_rules
}

output "task_security_group_id" {
  value = aws_security_group.tasks.id
}

output "api_target_group_arn" {
  value = module.api_service.target_group_arn
}

output "web_target_group_arn" {
  value = module.web_service.target_group_arn
}
