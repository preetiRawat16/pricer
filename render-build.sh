#!/usr/bin/env bash
# Install dependencies needed for Puppeteer
apt-get update
apt-get install -y wget --no-install-recommends \
  libx11-xcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxi6 \
  libxtst6 \
  libnss3 \
  libxrandr2 \
  libasound2 \
  libatk1.0-0 \
  libpangocairo-1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libxss1 \
  libgtk-3-0 \
  libdrm2 \
  libgbm1 \
  libnss3 \
  lsb-release \
  libxshmfence1 \
  libglu1-mesa
