# TorrentStream Installation Script for Windows
Write-Host "🚀 Installing TorrentStream Server..." -ForegroundColor Green

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js detected: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed. Please install Node.js 16+ first." -ForegroundColor Red
    Write-Host "📥 Download from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check if npm is installed
try {
    $npmVersion = npm --version
    Write-Host "✅ npm detected: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ npm is not installed. Please install npm first." -ForegroundColor Red
    exit 1
}

# Create downloads directory
if (!(Test-Path "downloads")) {
    New-Item -ItemType Directory -Name "downloads" | Out-Null
    Write-Host "📁 Created downloads directory" -ForegroundColor Green
}

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
    exit 1
}

# Create environment file if it doesn't exist
if (!(Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "📝 Created .env file from example" -ForegroundColor Green
}

Write-Host ""
Write-Host "✅ Installation completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "🎬 To start TorrentStream:" -ForegroundColor Yellow
Write-Host "   npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "🌐 The server will be available at:" -ForegroundColor Yellow
Write-Host "   http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "🔧 Configuration files:" -ForegroundColor Yellow
Write-Host "   - server.js (main server)" -ForegroundColor Gray
Write-Host "   - .env (environment variables)" -ForegroundColor Gray
Write-Host "   - package.json (dependencies)" -ForegroundColor Gray
Write-Host ""
Write-Host "📁 Downloads will be saved to: .\downloads\" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  Note: This tool is for educational purposes only." -ForegroundColor Red
Write-Host "   Please respect copyright laws and use responsibly." -ForegroundColor Red

# Ask if user wants to start the server
$startServer = Read-Host "Would you like to start the server now? (y/n)"
if ($startServer -eq "y" -or $startServer -eq "Y") {
    Write-Host "Starting TorrentStream server..." -ForegroundColor Green
    npm start
}