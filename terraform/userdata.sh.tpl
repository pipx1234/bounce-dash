#!/bin/bash
# content-hash: ${hash}
set -euo pipefail

# ── Install Node.js 20 ────────────────────────────────────────────────────
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

# ── Download game files from S3 ───────────────────────────────────────────
mkdir -p /opt/bounce-dash/public

aws s3 cp "s3://${bucket}/server.js"                    /opt/bounce-dash/server.js
aws s3 cp "s3://${bucket}/package.json"                  /opt/bounce-dash/package.json
aws s3 cp "s3://${bucket}/package-lock.json"             /opt/bounce-dash/package-lock.json
aws s3 cp "s3://${bucket}/public/index.html"             /opt/bounce-dash/public/index.html
aws s3 cp "s3://${bucket}/public/app.js"                  /opt/bounce-dash/public/app.js
aws s3 cp "s3://${bucket}/public/wasm_game.js"           /opt/bounce-dash/public/wasm_game.js
aws s3 cp "s3://${bucket}/public/wasm_game_bg.wasm"      /opt/bounce-dash/public/wasm_game_bg.wasm

# ── Install production dependencies ───────────────────────────────────────
cd /opt/bounce-dash
npm install --omit=dev

# ── Systemd service ───────────────────────────────────────────────────────
cat > /etc/systemd/system/bounce-dash.service << 'SERVICE'
[Unit]
Description=Bounce Dash Game Server
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/bounce-dash
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=PORT=3000
Environment=AWS_REGION=${region}
Environment=SCORES_TABLE=${scores_table}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable bounce-dash
systemctl start bounce-dash
