variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "image" {
  type = string
}

variable "command" {
  type    = list(string)
  default = null
}

variable "container_port" {
  type    = number
  default = null
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  description = "Environment variable name to Secrets Manager reference."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Secrets the task may read at start-up."
  type        = list(string)
  default     = []
}

variable "init_command" {
  description = "Runs to completion in its own container before the app starts."
  type        = list(string)
  default     = null
}

variable "init_secrets" {
  description = "Environment variable name to Secrets Manager reference, for the init container."
  type        = map(string)
  default     = {}
}

variable "task_role_arn" {
  description = "Role the running task uses to call AWS."
  type        = string
  default     = null
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_cloudwatch_log_group" "task" {
  name              = "/ecs/${var.name}"
  retention_in_days = 90
}

resource "aws_iam_role" "execution" {
  name_prefix        = "${substr(var.name, 0, 24)}-exec-"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "read_secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0
  role  = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secret_arns
    }]
  })
}

locals {
  container = {
    image = var.image
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.task.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "app"
      }
    }
  }
  init_containers = var.init_command == null ? [] : [merge(local.container, {
    name      = "init"
    essential = false
    command   = var.init_command
    secrets   = [for name, reference in var.init_secrets : { name = name, valueFrom = reference }]
  })]
}

resource "aws_ecs_task_definition" "task" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode(concat(local.init_containers, [merge(local.container, {
    name         = "app"
    essential    = true
    command      = var.command
    portMappings = var.container_port == null ? [] : [{ containerPort = var.container_port }]
    environment  = [for name, value in var.environment : { name = name, value = value }]
    secrets      = [for name, reference in var.secrets : { name = name, valueFrom = reference }]
    dependsOn    = var.init_command == null ? [] : [{ containerName = "init", condition = "SUCCESS" }]
  })]))
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.task.arn
}
