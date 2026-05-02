output "game_url" {
  description = "Public URL of the Bounce Dash game server"
  value       = "http://${aws_eip.game_server.public_ip}:3000"
}

output "s3_bucket_name" {
  description = "S3 bucket used for deployment artifacts"
  value       = aws_s3_bucket.game.id
}

output "instance_id" {
  description = "EC2 instance ID (use with AWS SSM Session Manager to connect)"
  value       = aws_instance.game_server.id
}

output "dynamodb_scores_table" {
  description = "DynamoDB table used for leaderboard scores"
  value       = aws_dynamodb_table.scores.name
}
