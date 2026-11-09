output "load_balancer_dns_name" {
  description = "Point the hostname at this address."
  value       = data.aws_lb.existing.dns_name
}

output "database_endpoint" {
  description = "Connect here to run the database setup."
  value       = data.aws_rds_cluster.existing.endpoint
}

output "database_setup_sql" {
  description = "Run once as the Aurora master user."
  sensitive   = true
  value       = <<-SQL
    create role ${module.secrets.owner_user} login createrole password '${module.secrets.owner_password}';
    grant ${module.secrets.owner_user} to current_user;
    create database ${module.secrets.database} owner ${module.secrets.owner_user};
  SQL
}
