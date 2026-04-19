#!/bin/bash

# HackPrinceton Real Data Setup Test Script
echo "=== HackPrinceton Real Data Setup Test ==="
echo ""

echo "1. Checking environment configuration..."
if [ -f "backend/.env" ]; then
    echo "✓ .env file found"
    if grep -q "USE_R=true" backend/.env; then
        echo "✓ USE_R=true (real R execution enabled)"
    else
        echo "✗ USE_R=false (using synthetic data)"
    fi
    
    if grep -q "LLM_PROVIDER=vertex" backend/.env; then
        echo "✓ LLM_PROVIDER=vertex (real AI enabled)"
    else
        echo "✗ LLM_PROVIDER not set to vertex"
    fi
    
    if grep -q "VERTEX_PROJECT_ID=" backend/.env; then
        echo "✓ Vertex AI project configured"
    else
        echo "✗ Vertex AI project not configured"
    fi
else
    echo "✗ .env file not found"
fi

echo ""
echo "2. Checking R installation..."
if command -v Rscript &> /dev/null; then
    echo "✓ R is installed:"
    Rscript --version 2>&1 | head -1
    
    echo "   Checking required packages..."
    Rscript -e "
    required <- c('jsonlite', 'survival', 'dplyr')
    missing <- required[!sapply(required, require, quietly=TRUE, character.only=TRUE)]
    if(length(missing) == 0) {
        cat('✓ All core packages installed\n')
    } else {
        cat('✗ Missing packages:', paste(missing, collapse=', '), '\n')
        cat('   Run: install.packages(c(\"', paste(missing, collapse='\", \"'), '\"))\n', sep='')
    }
    "
else
    echo "✗ R is not installed"
    echo "   Install from: https://cran.r-project.org/bin/windows/base/"
    echo "   Or run: install_r_packages.bat"
fi

echo ""
echo "3. Checking Node.js dependencies..."
if [ -f "backend/package.json" ]; then
    echo "✓ Backend package.json found"
    cd backend
    if [ -d "node_modules" ]; then
        echo "✓ Node modules installed"
    else
        echo "✗ Node modules not installed"
        echo "   Run: npm install"
    fi
    cd ..
else
    echo "✗ Backend package.json not found"
fi

if [ -f "hack-princeton/package.json" ]; then
    echo "✓ Frontend package.json found"
    cd hack-princeton  
    if [ -d "node_modules" ]; then
        echo "✓ Frontend node modules installed"
    else
        echo "✗ Frontend node modules not installed" 
        echo "   Run: npm install"
    fi
    cd ..
else
    echo "✗ Frontend package.json not found"
fi

echo ""
echo "4. Testing backend health..."
cd backend
if npm list express > /dev/null 2>&1; then
    echo "✓ Express.js available"
    echo "  Starting backend test..."
    timeout 10s npm start > /dev/null 2>&1 &
    SERVER_PID=$!
    sleep 3
    
    if curl -s http://localhost:3000/health > /dev/null; then
        echo "✓ Backend server responding"
        HEALTH=$(curl -s http://localhost:3000/health)
        echo "   Health check: $HEALTH"
    else
        echo "✗ Backend server not responding"
    fi
    
    # Cleanup
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
else
    echo "✗ Express.js not available"
fi
cd ..

echo ""
echo "5. Real data status summary:"
echo "   AI Text Generation: $(grep -q "LLM_PROVIDER=vertex" backend/.env && echo "ENABLED" || echo "DISABLED")"
echo "   R Statistical Analysis: $(grep -q "USE_R=true" backend/.env && command -v Rscript > /dev/null && echo "ENABLED" || echo "DISABLED")"
echo "   Frontend Data Integration: ENABLED (updated)"

echo ""
echo "=== Setup Complete ==="
echo "If all checks pass, your system will use real AI data!"
echo "To start the system:"
echo "1. Backend: cd backend && npm start"  
echo "2. Frontend: cd hack-princeton && npm run dev"