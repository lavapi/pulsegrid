output "relay_url" {
  description = "Where PulseGrid servers send notifications (PUSH_RELAY_URL)."
  value       = "https://${var.domain_name}"
}

output "certificate_check_record" {
  description = "Add this CNAME record to the domain's DNS so the certificate can be issued."
  value = [for option in aws_acm_certificate.relay.domain_validation_options : {
    name  = option.resource_record_name
    type  = option.resource_record_type
    value = option.resource_record_value
  }]
}

output "address_record" {
  description = "Add this CNAME record to point the relay's address at it."
  value = {
    name  = var.domain_name
    type  = "CNAME"
    value = aws_apigatewayv2_domain_name.relay.domain_name_configuration[0].target_domain_name
  }
}

output "apns_key_parameter" {
  description = "Put the Apple .p8 key here by hand."
  value       = aws_ssm_parameter.apns_key.name
}
