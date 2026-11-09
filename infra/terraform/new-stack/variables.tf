variable "region" {
  description = "AWS region to deploy to."
  type        = string
}

variable "name" {
  description = "Prefix for everything this creates."
  type        = string
  default     = "dashops"
}

variable "hostname" {
  description = "Hostname the dashboard answers on."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate for the public hostname."
  type        = string
}

variable "app_version" {
  description = "Version to run, for example 0.2.0."
  type        = string
}

variable "image_repository" {
  description = "Images are named <repository>-api and <repository>-web."
  type        = string
  default     = "ghcr.io/lavapi/dashops"
}

variable "vpc_cidr" {
  description = "CIDR range for the VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance size."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "Run the database across two availability zones."
  type        = bool
  default     = false
}

variable "cache_node_type" {
  description = "ElastiCache node size."
  type        = string
  default     = "cache.t4g.micro"
}

variable "service_desired_count" {
  description = "Tasks to run for the API and the web app."
  type        = number
  default     = 1
}
