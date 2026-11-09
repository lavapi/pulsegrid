output "load_balancer_dns_name" {
  description = "Point the public hostname at this address."
  value       = aws_lb.main.dns_name
}
