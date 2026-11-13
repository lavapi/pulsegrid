data "aws_secretsmanager_secret_version" "origin_header" {
  count = var.origin_header == null ? 0 : 1

  secret_id = var.origin_header.secret_id
}

locals {
  origin_header_secret      = one(data.aws_secretsmanager_secret_version.origin_header[*].secret_string)
  origin_header_placeholder = try(var.origin_header.placeholder, "NA")
  origin_header_values = local.origin_header_secret == null ? [] : [
    for value in split(",", local.origin_header_secret) : trimspace(value)
    if !contains(["", local.origin_header_placeholder], trimspace(value))
  ]
  origin_header_value_count = nonsensitive(length(local.origin_header_values))
  origin_header_name        = local.origin_header_value_count == 0 ? null : try(var.origin_header.name, "X-Origin-Auth")
}

check "origin_header_at_most_two_values" {
  assert {
    condition     = local.origin_header_value_count <= 2
    error_message = "The origin header secret holds more than two values: keep one, or two only during a rotation."
  }
}
