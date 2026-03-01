#!/bin/bash

set -e

echo "===== LIBIDO INSTALLER START ====="

PROJECT_NAME="LIBIDO"
DB_NAME="libido_db"
DB_USER="libido_user"
DB_PASS="libido_pass"
JWT_SECRET="super_secret_jwt_key"

# -----------------------------------
# 1. Install system dependencies
# -----------------------------------

echo "[1/7] Installing system packages..."

sudo apt update
sudo apt install -y python3 python3-pip python3-venv \
postgresql postgresql-contrib redis-server \
tmux git

# -----------------------------------
# 2. Enable services
# -----------------------------------

echo "[2/7] Enabling PostgreSQL & Redis..."

sudo systemctl enable postgresql
sudo systemctl start postgresql

#sudo systemctl enable redis-server
#sudo systemctl start redis-server

# -----------------------------------
# 3. Setup PostgreSQL database
# -----------------------------------

echo "[3/7] Creating PostgreSQL database..."

sudo -u postgres psql <<EOF
CREATE DATABASE $DB_NAME;
CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
ALTER ROLE $DB_USER SET client_encoding TO 'utf8';
ALTER ROLE $DB_USER SET default_transaction_isolation TO 'read committed';
ALTER ROLE $DB_USER SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOF

# -----------------------------------
# 4. Create virtual environment
# -----------------------------------

echo "[4/7] Creating virtual environment..."

python3 -m venv venv
source venv/bin/activate

# -----------------------------------
# 5. Install Python dependencies
# -----------------------------------

echo "[5/7] Installing Python packages..."

pip install --upgrade pip

pip install \
flask \
flask-cors \
flask-jwt-extended \
sqlalchemy \
psycopg2-binary \
redis \
python-dotenv \
werkzeug

# -----------------------------------
# 6. Create .env file
# -----------------------------------

echo "[6/7] Creating .env..."

cat > .env <<EOF
JWT_SECRET_KEY=$JWT_SECRET
FRONTEND_URL=http://100.92.183.5:5500
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
REDIS_HOST=localhost
REDIS_PORT=6379
EOF

# -----------------------------------
# 7. Start tmux sessions
# -----------------------------------

echo "[7/7] Starting services in tmux..."

# Kill old sessions if exist
tmux kill-session -t libido_backend 2>/dev/null || true
tmux kill-session -t libido_frontend 2>/dev/null || true

# Backend session
tmux new-session -d -s libido_backend "source venv/bin/activate && python libido.py"

# Frontend session
tmux new-session -d -s libido_frontend "python3 -m http.server 5500 --bind 0.0.0.0"

echo ""
echo "======================================="
echo "LIBIDO is running!"
echo ""
echo "Backend:  http://localhost:5000"
echo "Frontend: http://localhost:5500"
echo ""
echo "Attach backend logs:"
echo "tmux attach -t libido_backend"
echo ""
echo "Attach frontend logs:"
echo "tmux attach -t libido_frontend"
echo "======================================="
