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

# ── Unique resource name suffix ────────────────────────────────────────────
resource "random_id" "suffix" {
  byte_length = 4
}

# ── S3 bucket — private artifact storage ──────────────────────────────────
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

# ── Upload server artifacts to S3 ─────────────────────────────────────────
resource "aws_s3_object" "server_js" {
  bucket = aws_s3_bucket.game.id
  key    = "server.js"
  source = "${path.module}/../game/server.js"
  etag   = filemd5("${path.module}/../game/server.js")

  depends_on = [aws_s3_bucket_public_access_block.game]
}

resource "aws_s3_object" "package_json" {
  bucket = aws_s3_bucket.game.id
  key    = "package.json"
  source = "${path.module}/../game/package.json"
  etag   = filemd5("${path.module}/../game/package.json")

  depends_on = [aws_s3_bucket_public_access_block.game]
}

resource "aws_s3_object" "package_lock" {
  bucket = aws_s3_bucket.game.id
  key    = "package-lock.json"
  source = "${path.module}/../game/package-lock.json"
  etag   = filemd5("${path.module}/../game/package-lock.json")

  depends_on = [aws_s3_bucket_public_access_block.game]
}

resource "aws_s3_object" "client_html" {
  bucket = aws_s3_bucket.game.id
  key    = "public/index.html"
  source = "${path.module}/../game/public/index.html"
  etag   = filemd5("${path.module}/../game/public/index.html")

  depends_on = [aws_s3_bucket_public_access_block.game]
}

resource "aws_s3_object" "app_js" {
  bucket       = aws_s3_bucket.game.id
  key          = "public/app.js"
  source       = "${path.module}/../game/public/app.js"
  etag         = filemd5("${path.module}/../game/public/app.js")
  content_type = "application/javascript"

  depends_on = [aws_s3_bucket_public_access_block.game]
}

resource "aws_s3_object" "wasm_js" {
  bucket       = aws_s3_bucket.game.id
  key          = "public/wasm_game.js"
  source       = "${path.module}/../game/wasm-game/pkg/wasm_game.js"
  etag         = filemd5("${path.module}/../game/wasm-game/pkg/wasm_game.js")
  content_type = "application/javascript"

  depends_on = [aws_s3_bucket_public_access_block.game]
}

resource "aws_s3_object" "wasm_bg" {
  bucket       = aws_s3_bucket.game.id
  key          = "public/wasm_game_bg.wasm"
  source       = "${path.module}/../game/wasm-game/pkg/wasm_game_bg.wasm"
  etag         = filemd5("${path.module}/../game/wasm-game/pkg/wasm_game_bg.wasm")
  content_type = "application/wasm"

  depends_on = [aws_s3_bucket_public_access_block.game]
}

# ── DynamoDB leaderboard storage ─────────────────────────────────────────
resource "aws_dynamodb_table" "scores" {
  name         = "${var.project_name}-scores-${random_id.suffix.hex}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = { Project = var.project_name }
}

# ── IAM role — lets EC2 read artifacts from S3 ────────────────────────────
resource "aws_iam_role" "game_server" {
  name = "${var.project_name}-ec2-${random_id.suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = { Project = var.project_name }
}

resource "aws_iam_role_policy" "s3_read" {
  name = "game-server-access"
  role = aws_iam_role.game_server.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          aws_s3_bucket.game.arn,
          "${aws_s3_bucket.game.arn}/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:Scan", "dynamodb:DescribeTable"]
        Resource = aws_dynamodb_table.scores.arn
      }
    ]
  })
}

# Allows connect/diagnose via AWS SSM Session Manager — no SSH port needed
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.game_server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "game_server" {
  name = "${var.project_name}-profile-${random_id.suffix.hex}"
  role = aws_iam_role.game_server.name
}

# ── Security group ─────────────────────────────────────────────────────────
resource "aws_security_group" "game_server" {
  name        = "${var.project_name}-sg-${random_id.suffix.hex}"
  description = "Bounce Dash game server - HTTP + WebSocket"

  ingress {
    description      = "Game server"
    from_port        = 3000
    to_port          = 3000
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = { Project = var.project_name }
}

# ── AMI — latest Amazon Linux 2023 ────────────────────────────────────────
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── EC2 instance ───────────────────────────────────────────────────────────
resource "aws_instance" "game_server" {
  ami                  = data.aws_ami.al2023.id
  instance_type        = var.instance_type
  iam_instance_profile = aws_iam_instance_profile.game_server.name

  vpc_security_group_ids = [aws_security_group.game_server.id]

  # Embed file hashes so Terraform replaces the instance when code changes
  user_data = base64encode(templatefile("${path.module}/userdata.sh.tpl", {
    bucket       = aws_s3_bucket.game.id
    region       = var.aws_region
    scores_table = aws_dynamodb_table.scores.name
    hash         = "${filemd5("${path.module}/../game/server.js")}-${filemd5("${path.module}/../game/package.json")}-${filemd5("${path.module}/../game/package-lock.json")}-${filemd5("${path.module}/../game/public/index.html")}-${filemd5("${path.module}/../game/public/app.js")}-${filemd5("${path.module}/../game/wasm-game/pkg/wasm_game.js")}-${filemd5("${path.module}/../game/wasm-game/pkg/wasm_game_bg.wasm")}"
  }))

  user_data_replace_on_change = true

  depends_on = [
    aws_s3_object.server_js,
    aws_s3_object.package_json,
    aws_s3_object.package_lock,
    aws_s3_object.client_html,
    aws_s3_object.app_js,
    aws_s3_object.wasm_js,
    aws_s3_object.wasm_bg,
    aws_dynamodb_table.scores,
  ]

  tags = {
    Name    = "${var.project_name}-server"
    Project = var.project_name
  }
}

# ── Elastic IP — stable public address ────────────────────────────────────
resource "aws_eip" "game_server" {
  instance = aws_instance.game_server.id
  domain   = "vpc"

  tags = { Project = var.project_name }
}
