#!/bin/bash
set -e

# =============================================
# Trading Scanner — DigitalOcean Droplet Setup
# =============================================
# Run this on a fresh Ubuntu 22.04/24.04 droplet:
#   curl -sSL <raw-url> | bash
#   OR
#   chmod +x setup.sh && ./setup.sh

echo "==> Updating system..."
apt-get update && apt-get upgrade -y

echo "==> Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "Docker installed."
else
  echo "Docker already installed."
fi

echo "==> Installing Docker Compose plugin..."
if ! docker compose version &> /dev/null; then
  apt-get install -y docker-compose-plugin
fi

echo "==> Opening firewall ports..."
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp    # SSH
  ufw allow 3000/tcp  # Frontend
  ufw allow 4000/tcp  # Backend + WebSocket
  ufw --force enable
  echo "Firewall configured."
fi

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Clone your repo:"
echo "     git clone <your-repo-url> /opt/trading-scanner"
echo "     cd /opt/trading-scanner"
echo ""
echo "  2. Create .env file:"
echo "     cp .env.production.example .env"
echo "     nano .env"
echo "     # Set KITE_API_KEY, KITE_API_SECRET"
echo "     # Replace YOUR_DROPLET_IP with: $(curl -s ifconfig.me)"
echo ""
echo "  3. Deploy:"
echo "     docker compose up -d --build"
echo ""
echo "  4. Check logs:"
echo "     docker logs trading-backend -f"
echo "     docker logs trading-frontend -f"
echo ""
echo "  Your droplet IP: $(curl -s ifconfig.me)"
echo "============================================"
