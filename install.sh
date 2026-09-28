#!/usr/bin/env bash

# ======================================================
# Inventory Bot & Userbot Installer (Sanaei Style)
# Repository: https://github.com/meh732/-.git
# ======================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

INSTALL_DIR="/opt/inventory-bot"
SERVICE_NAME="inventory-bot"
REPO_URL="https://github.com/meh732/dastyarnew2.git"

show_banner() {
    clear
    echo -e "${CYAN}======================================================${NC}"
    echo -e "${GREEN}    ___                      _                      ${NC}"
    echo -e "${GREEN}   |_ _|_ ____   _____ _ __ | |_ ___  _ __ _   _    ${NC}"
    echo -e "${GREEN}    | || '_ \ \ / / _ \ '_ \| __/ _ \| '__| | | |   ${NC}"
    echo -e "${GREEN}    | || | | \ V /  __/ | | | || (_) | |  | |_| |   ${NC}"
    echo -e "${GREEN}   |___|_| |_|\_/ \___|_| |_|\__\___/|_|   \__, |   ${NC}"
    echo -e "${GREEN}                                           |___/    ${NC}"
    echo -e "${CYAN}        Inventory & Telegram Userbot Installer        ${NC}"
    echo -e "${CYAN}======================================================${NC}"
    echo ""
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}[ERROR] Please run this script as root (sudo).${NC}"
        exit 1
    fi
}

install_dependencies() {
    echo -e "${BLUE}[1/5] Updating OS packages and installing prerequisites...${NC}"
    if command -v apt-get &> /dev/null; then
        apt-get update -y
        apt-get install -y curl git build-essential ufw
    elif command -v yum &> /dev/null; then
        yum update -y
        yum install -y curl git make gcc-c++
    fi

    # Install Node.js 20.x
    if ! command -v node &> /dev/null || [ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]; then
        echo -e "${BLUE}Installing Node.js 20.x LTS...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        if command -v apt-get &> /dev/null; then
            apt-get install -y nodejs
        else
            yum install -y nodejs
        fi
    fi

    echo -e "${GREEN}Node.js Version: $(node -v)${NC}"
    echo -e "${GREEN}NPM Version: $(npm -v)${NC}"
}

clone_or_update_repo() {
    echo -e "${BLUE}[2/5] Downloading latest code from GitHub...${NC}"
    
    if [ -f "$INSTALL_DIR/.env" ]; then
        source "$INSTALL_DIR/.env" || true
    fi
    CURRENT_REPO="${GITHUB_REPO_URL:-$REPO_URL}"
    echo -e "Configured Repository: ${CYAN}${CURRENT_REPO}${NC}"
    read -p "Enter GitHub Repository URL [Press Enter for default: ${CURRENT_REPO}]: " INPUT_REPO
    REPO_URL=${INPUT_REPO:-$CURRENT_REPO}

    if [ -d "$INSTALL_DIR/.git" ]; then
        echo -e "${YELLOW}Existing git directory found at $INSTALL_DIR. Updating code...${NC}"
        cd "$INSTALL_DIR"
        git remote set-url origin "$REPO_URL" || true
        git fetch --all
        git reset --hard origin/main || git reset --hard origin/master || git pull origin main || git pull origin master || true
    elif [ -d "$INSTALL_DIR" ]; then
        mkdir -p "$INSTALL_DIR"
        cd "$INSTALL_DIR"
        git clone "$REPO_URL" .
    else
        mkdir -p "$INSTALL_DIR"
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
}

build_app() {
    echo -e "${BLUE}[3/5] Installing NPM dependencies and building...${NC}"
    cd "$INSTALL_DIR"
    npm install
    npm run build
}

configure_env_and_service() {
    echo -e "${BLUE}[4/5] Configuring environment & systemd background service...${NC}"
    
    cd "$INSTALL_DIR"

    # Default values
    DEFAULT_PORT="3000"
    
    if [ -f "$INSTALL_DIR/.env" ]; then
        source "$INSTALL_DIR/.env" || true
    fi

    echo -e "${CYAN}------------------------------------------------------${NC}"
    read -p "Enter Port for Web UI/Server [Default: ${PORT:-3000}]: " INPUT_PORT
    APP_PORT=${INPUT_PORT:-${PORT:-3000}}

    read -p "Enter Proxy URL (Optional, e.g. socks5://127.0.0.1:10808 or press Enter for direct): " INPUT_PROXY
    PROXY_URL=${INPUT_PROXY:-${PROXY_URL:-""}}

    read -p "Enter Telegram Bot Token (Optional, press Enter to skip): " INPUT_TOKEN
    BOT_TOKEN=${INPUT_TOKEN:-${BOT_TOKEN:-""}}

    read -p "Enter Admin Telegram User ID (Optional, press Enter to skip): " INPUT_ADMIN
    ADMIN_ID=${INPUT_ADMIN:-${ADMIN_ID:-""}}

    cat <<EOF > "$INSTALL_DIR/.env"
PORT=$APP_PORT
PROXY_URL=$PROXY_URL
BOT_TOKEN=$BOT_TOKEN
ADMIN_ID=$ADMIN_ID
GITHUB_REPO_URL=$REPO_URL
NODE_ENV=production
EOF

    # Create systemd service
    cat <<EOF > /etc/systemd/system/${SERVICE_NAME}.service
[Unit]
Description=Inventory Telegram Bot & Userbot Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/dist/server.cjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT
Environment=PROXY_URL=$PROXY_URL

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}
    systemctl restart ${SERVICE_NAME}

    # Symlink manager shortcut command
    ln -sf "$INSTALL_DIR/install.sh" /usr/local/bin/inventory-bot
    chmod +x /usr/local/bin/inventory-bot || true

    echo -e "${GREEN}[SUCCESS] Service ${SERVICE_NAME} started successfully!${NC}"
}

setup_domain_ssl() {
    echo -e "\n${BLUE}[5/5] Domain & SSL Setup (Nginx + Let's Encrypt)${NC}"
    
    read -p "Do you want to configure a custom Domain & SSL Certificate? (y/n) [n]: " CONFIRM_DOMAIN
    if [[ "$CONFIRM_DOMAIN" =~ ^[Yy]$ ]]; then
        read -p "Enter your Domain Name (e.g., bot.example.com): " DOMAIN_NAME
        if [ -z "$DOMAIN_NAME" ]; then
            echo -e "${RED}Domain name cannot be empty. Skipping SSL setup.${NC}"
            return
        fi

        APP_PORT=3000
        if [ -f "$INSTALL_DIR/.env" ]; then
            source "$INSTALL_DIR/.env" || true
            APP_PORT=${PORT:-3000}
        fi

        echo -e "${BLUE}Installing Nginx and Certbot...${NC}"
        if command -v apt-get &> /dev/null; then
            apt-get update -y
            apt-get install -y nginx certbot python3-certbot-nginx
        elif command -v yum &> /dev/null; then
            yum update -y
            yum install -y nginx certbot python3-certbot-nginx
        fi

        NGINX_CONF="/etc/nginx/sites-available/$DOMAIN_NAME"
        if [ ! -d "/etc/nginx/sites-available" ]; then
            NGINX_CONF="/etc/nginx/conf.d/$DOMAIN_NAME.conf"
        fi

        cat <<EOF > "$NGINX_CONF"
server {
    listen 80;
    server_name $DOMAIN_NAME;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

        if [ -d "/etc/nginx/sites-enabled" ]; then
            ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN_NAME"
            rm -f /etc/nginx/sites-enabled/default || true
        fi

        systemctl restart nginx || service nginx restart

        echo -e "${BLUE}Requesting free SSL Certificate with Certbot for $DOMAIN_NAME...${NC}"
        certbot --nginx -d "$DOMAIN_NAME" --non-interactive --agree-tos --register-unsafely-without-email || {
            echo -e "${YELLOW}[WARNING] Certbot could not issue SSL automatically. Make sure your domain points to this server IP and ports 80/443 are open in firewall/X-UI.${NC}"
        }

        echo -e "${GREEN}[SUCCESS] Domain configured: https://$DOMAIN_NAME${NC}"
    fi
}

show_complete() {
    IP_ADDR=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')
    echo -e "\n${CYAN}======================================================${NC}"
    echo -e "${GREEN} 🎉 Installation Completed Successfully! ${NC}"
    echo -e "${CYAN}======================================================${NC}"
    echo -e " 🌐 Web Panel URL: ${YELLOW}http://${IP_ADDR}:${APP_PORT}${NC}"
    echo -e " 🛠️  Management CLI: Type ${GREEN}inventory-bot${NC} anywhere in terminal"
    echo -e "${CYAN}======================================================${NC}\n"
}

manage_menu() {
    show_banner
    echo -e "${YELLOW}Please select an option:${NC}\n"
    echo -e " ${GREEN}1)${NC} Full Install / Reinstall"
    echo -e " ${GREEN}2)${NC} Update Bot from GitHub"
    echo -e " ${GREEN}3)${NC} Restart Service"
    echo -e " ${GREEN}4)${NC} Check Service Status"
    echo -e " ${GREEN}5)${NC} View Live Logs"
    echo -e " ${GREEN}6)${NC} Change Port or Environment Variables"
    echo -e " ${GREEN}7)${NC} Configure Domain & Free SSL"
    echo -e " ${GREEN}8)${NC} Database Backup & Restore Manager"
    echo -e " ${GREEN}9)${NC} Change GitHub Repository URL"
    echo -e " ${RED}10)${NC} Uninstall"
    echo -e " ${CYAN}0)${NC} Exit"
    echo ""
    read -p "Select [0-10]: " CHOICE

    case $CHOICE in
        1)
            check_root
            install_dependencies
            clone_or_update_repo
            build_app
            configure_env_and_service
            setup_domain_ssl
            show_complete
            ;;
        2)
            check_root
            clone_or_update_repo
            build_app
            systemctl restart ${SERVICE_NAME}
            echo -e "${GREEN}Updated and restarted successfully!${NC}"
            ;;
        3)
            check_root
            systemctl restart ${SERVICE_NAME}
            echo -e "${GREEN}Service restarted.${NC}"
            ;;
        4)
            systemctl status ${SERVICE_NAME} --no-pager
            ;;
        5)
            journalctl -u ${SERVICE_NAME} -n 100 -f
            ;;
        6)
            check_root
            configure_env_and_service
            ;;
        7)
            check_root
            setup_domain_ssl
            ;;
        8)
            mkdir -p "$INSTALL_DIR/backups"
            TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
            cp "$INSTALL_DIR/inventory_data.json" "$INSTALL_DIR/backups/backup_$TIMESTAMP.json" 2>/dev/null || true
            echo -e "${GREEN}[OK] Backup created at $INSTALL_DIR/backups/backup_$TIMESTAMP.json${NC}"
            ;;
        9)
            check_root
            read -p "Enter new GitHub Repository URL: " NEW_REPO
            if [ -n "$NEW_REPO" ]; then
                REPO_URL="$NEW_REPO"
                cd "$INSTALL_DIR"
                git remote set-url origin "$NEW_REPO" 2>/dev/null || true
                sed -i "s|^GITHUB_REPO_URL=.*|GITHUB_REPO_URL=$NEW_REPO|" "$INSTALL_DIR/.env" 2>/dev/null || echo "GITHUB_REPO_URL=$NEW_REPO" >> "$INSTALL_DIR/.env"
                echo -e "${GREEN}[OK] Repository URL changed to: $NEW_REPO${NC}"
            fi
            ;;
        10)
            check_root
            systemctl stop ${SERVICE_NAME} || true
            systemctl disable ${SERVICE_NAME} || true
            rm -f /etc/systemd/system/${SERVICE_NAME}.service
            rm -rf "$INSTALL_DIR"
            rm -f /usr/local/bin/inventory-bot
            systemctl daemon-reload
            echo -e "${RED}Uninstalled successfully.${NC}"
            ;;
        0)
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid selection.${NC}"
            ;;
    esac
}

# If run directly from terminal without args, launch menu
if [ "$1" == "install" ]; then
    check_root
    install_dependencies
    clone_or_update_repo
    build_app
    configure_env_and_service
    show_complete
else
    manage_menu
fi
