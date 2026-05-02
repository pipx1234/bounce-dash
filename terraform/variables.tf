variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name — used as a prefix for all resource names"
  type        = string
  default     = "bounce-dash"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,28}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 4-30 lowercase alphanumeric characters or hyphens, starting with a letter."
  }
}

variable "instance_type" {
  description = "EC2 instance type for the game server"
  type        = string
  default     = "t3.micro"
}
