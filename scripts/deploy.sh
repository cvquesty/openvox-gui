#!/bin/bash
# OpenVox GUI Deployment Script
# Run this on the OpenVox server to set up the application

set -euo pipefail

APP_DIR="/opt/openvox-gui"
VENV_DIR="${APP_DIR}/venv"

echo "=== OpenVox GUI Deployment ==="

# 1. Create directories
echo "[1/7] Creating directories..."
sudo mkdir -p ${APP_DIR}/{data,logs,config}

# 2. Create Python virtual environment
echo "[2/7] Setting up Python virtual environment..."
cd ${APP_DIR}
python3 -m venv ${VENV_DIR}
source ${VENV_DIR}/bin/activate

# 3. Install Python dependencies
echo "[3/7] Installing Python dependencies..."
pip install --upgrade pip
pip install -r ${APP_DIR}/backend/requirements.txt

# 4. Build React frontend
echo "[4/7] Building React frontend..."
cd ${APP_DIR}/frontend
npm install
npm run build

# 5. Set permissions
echo "[5/7] Setting permissions..."
sudo chown -R puppet:puppet ${APP_DIR}/data ${APP_DIR}/logs
sudo chmod +x ${APP_DIR}/scripts/enc.py

# 6. Install systemd service
echo "[6/7] Installing systemd service..."
sudo cp ${APP_DIR}/config/openvox-gui.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openvox-gui

# 7. Open firewall port
echo "[7/7] Configuring firewall..."
sudo firewall-cmd --permanent --add-port=8080/tcp 2>/dev/null || true
sudo firewall-cmd --reload 2>/dev/null || true

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "To start the application:"
echo "  sudo systemctl start openvox-gui"
echo ""
echo "To check status:"
echo "  sudo systemctl status openvox-gui"
echo ""
echo "Access the GUI at: http://openvox.questy.org:8080"
echo "API documentation: http://openvox.questy.org:8080/api/docs"
echo ""
echo "To enable ENC in puppet.conf, add:"
echo "  [server]"
echo "  node_terminus = exec"
echo "  external_nodes = ${APP_DIR}/scripts/enc.py"
echo ""
