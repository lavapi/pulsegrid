variable "region" {
  description = "AWS region for the relay."
  type        = string
  default     = "eu-central-1"
}

variable "domain_name" {
  description = "The relay's address, such as push.example.com. Its DNS records are added by hand (see the outputs)."
  type        = string
}

variable "apns_key_id" {
  description = "The 10-character ID of the Apple push key."
  type        = string

  validation {
    condition     = can(regex("^[A-Z0-9]{10}$", var.apns_key_id))
    error_message = "The Apple key ID is 10 capital letters and digits."
  }
}

variable "apns_team_id" {
  description = "The 10-character Apple developer team ID."
  type        = string

  validation {
    condition     = can(regex("^[A-Z0-9]{10}$", var.apns_team_id))
    error_message = "The Apple team ID is 10 capital letters and digits."
  }
}

variable "apns_bundle_id" {
  description = "The iPhone app's bundle ID. The relay sends to this app only."
  type        = string
}

variable "notifications_per_day" {
  description = "How many notifications one server may send a day."
  type        = number
  default     = 2000
}

variable "registrations_per_day" {
  description = "How many servers may register from one internet address a day."
  type        = number
  default     = 10
}

variable "budget_email" {
  description = "Who gets an email when the month's cost passes the budget."
  type        = string
}

variable "monthly_budget_usd" {
  description = "The monthly cost that sends a budget email."
  type        = number
  default     = 5
}

variable "handler_file" {
  description = "The built relay (pnpm --filter @pulsegrid/push-relay build)."
  type        = string
  default     = "../../../apps/push-relay/dist/handler.js"
}
