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

variable "origin_header" {
  description = "Header a CDN in front of the load balancer sets on every request, with its value in a Secrets Manager secret: one value, or two separated by a comma during a rotation. The placeholder value means no check. When a value is set, both listener rules require the header, so requests that bypass the CDN never reach the dashboard. Null: no check."
  type = object({
    secret_id   = string
    name        = optional(string, "X-Origin-Auth")
    placeholder = optional(string, "NA")
  })
  default = null
}

variable "database_access_settings" {
  description = "DB_ACCESS_* settings for production database access, passed to the API and worker. See docs/database-access.md."
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for name in keys(var.database_access_settings) : startswith(name, "DB_ACCESS_")])
    error_message = "Every key in database_access_settings must start with DB_ACCESS_."
  }
}
