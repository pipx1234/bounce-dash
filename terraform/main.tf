terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
  required_version = ">= 1.3.0"
}

provider "aws" {
  region = var.aws_region
}

# ── Unique bucket name suffix ──────────────────────────────────────────────
resource "random_id" "suffix" {
  byte_length = 4
}

# ── S3 Bucket (private) ────────────────────────────────────────────────────
resource "aws_s3_bucket" "game" {
  bucket = "${var.project_name}-${random_id.suffix.hex}"

  tags = {
    Project = var.project_name
  }
}

resource "aws_s3_bucket_public_access_block" "game" {
  bucket = aws_s3_bucket.game.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── CloudFront Origin Access Control ──────────────────────────────────────
resource "aws_cloudfront_origin_access_control" "game" {
  name                              = "${var.project_name}-oac-${random_id.suffix.hex}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront Distribution ────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "game" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${var.project_name} distribution"

  origin {
    domain_name              = aws_s3_bucket.game.bucket_regional_domain_name
    origin_id                = "s3-game"
    origin_access_control_id = aws_cloudfront_origin_access_control.game.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-game"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Project = var.project_name
  }
}

# ── S3 bucket policy — allow CloudFront OAC to read objects ───────────────
resource "aws_s3_bucket_policy" "game" {
  bucket     = aws_s3_bucket.game.id
  depends_on = [aws_s3_bucket_public_access_block.game]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.game.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.game.arn
          }
        }
      }
    ]
  })
}

# ── Upload game file to S3 ─────────────────────────────────────────────────
resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.game.id
  key          = "index.html"
  source       = "${path.module}/../game/index.html"
  content_type = "text/html; charset=utf-8"
  etag         = filemd5("${path.module}/../game/index.html")

  depends_on = [aws_s3_bucket_public_access_block.game]
}
