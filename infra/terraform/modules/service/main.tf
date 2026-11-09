variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "cluster_id" {
  type = string
}

variable "task_definition_arn" {
  type = string
}

variable "container_port" {
  type = number
}

variable "health_check_path" {
  type = string
}

variable "desired_count" {
  type = number
}

variable "subnet_ids" {
  type = list(string)
}

variable "task_security_group_id" {
  type = string
}

variable "alb_security_group_id" {
  type = string
}

variable "assign_public_ip" {
  type = bool
}

variable "listener_rules" {
  description = "ECS can't attach a target group until a listener uses it, so the service waits for these."
  type        = list(string)
}

resource "aws_lb_target_group" "service" {
  name_prefix = "dd-"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path    = var.health_check_path
    matcher = "200"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  security_group_id            = var.task_security_group_id
  referenced_security_group_id = var.alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
}

resource "aws_ecs_service" "service" {
  depends_on = [var.listener_rules]

  name            = var.name
  cluster         = var.cluster_id
  task_definition = var.task_definition_arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.task_security_group_id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.service.arn
    container_name   = "app"
    container_port   = var.container_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

output "target_group_arn" {
  value = aws_lb_target_group.service.arn
}
