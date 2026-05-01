output "cloudfront_url" {
  description = "Public URL of the deployed game (may take ~5 min to propagate after first deploy)"
  value       = "https://${aws_cloudfront_distribution.game.domain_name}"
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket holding the game files"
  value       = aws_s3_bucket.game.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (useful for cache invalidation)"
  value       = aws_cloudfront_distribution.game.id
}
