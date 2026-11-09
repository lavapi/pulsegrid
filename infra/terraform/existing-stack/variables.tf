variable "region" {
  description = "Region of the existing resources."
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

variable "app_version" {
  description = "Version to run, for example 0.2.0."
  type        = string
}

variable "image_repository" {
  description = "Images are named <repository>-api and <repository>-web."
  type        = string
  default     = "ghcr.io/lavapi/pulsegrid"
}

variable "load_balancer_name" {
  description = "Existing application load balancer."
  type        = string
}

variable "database_cluster" {
  description = "Existing Aurora cluster."
  type        = string
}

variable "cache_replication_group" {
  description = "Existing ElastiCache replication group."
  type        = string
}

variable "cache_auth_token" {
  description = "Set this if the cache requires an auth token (e.g. a shared ElastiCache with transit encryption and AUTH)."
  type        = string
  default     = null
  sensitive   = true
}

variable "cache_database" {
  description = "Cache database number that keeps the dashboard's data apart. Check that nothing else uses it. Not used for a cluster-mode cache, which has only database 0: there the keys carry the {dashops} hash tag."
  type        = number
  default     = 5
}

variable "subnet_ids" {
  description = "Private subnets with internet access through NAT, where the tasks run."
  type        = list(string)
}

variable "listener_rule_priority" {
  description = "First of two free rule priorities on the HTTPS listener."
  type        = number
}

variable "certificate_arn" {
  description = "ACM certificate for the hostname. Leave unset if the listener's certificates already cover it."
  type        = string
  default     = null
}

variable "allowed_cidrs" {
  description = "Addresses allowed to reach the hostname. Leave empty to allow everyone."
  type        = list(string)
  default     = []
}

variable "desired_count" {
  description = "Tasks to run for the API and the web app."
  type        = number
  default     = 1
}
