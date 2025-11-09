#!/bin/bash

# TorrentStream Installation Script

echo "🚀 Installing TorrentStream Server..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    echo "📥 Download from: https://nodejs.org/"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm detected"

# Create downloads directory
mkdir -p downloads

echo "📁 Created downloads directory"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create environment file if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "📝 Created .env file from example"
fi

# Make the script executable
chmod +x server.js

echo ""
echo "✅ Installation completed successfully!"
echo ""
echo "🎬 To start TorrentStream:"
echo "   npm start"
echo ""
echo "🌐 The server will be available at:"
echo "   http://localhost:3000"
echo ""
echo "🔧 Configuration files:"
echo "   - server.js (main server)"
echo "   - .env (environment variables)"
echo "   - package.json (dependencies)"
echo ""
echo "📁 Downloads will be saved to: ./downloads/"
echo ""
echo "⚠️  Note: This tool is for educational purposes only."
echo "   Please respect copyright laws and use responsibly."