@echo off
setlocal EnableDelayedExpansion

echo === HackPrinceton Real Data Setup Test ===
echo.

echo 1. Checking environment configuration...
if exist "backend\.env" (
    echo ✓ .env file found
    findstr /c:"USE_R=true" backend\.env >nul && (
        echo ✓ USE_R=true ^(real R execution enabled^)
    ) || (
        echo ✗ USE_R=false ^(using synthetic data^)
    )
    
    findstr /c:"LLM_PROVIDER=vertex" backend\.env >nul && (
        echo ✓ LLM_PROVIDER=vertex ^(real AI enabled^)
    ) || (
        echo ✗ LLM_PROVIDER not set to vertex
    )
    
    findstr /c:"VERTEX_PROJECT_ID=" backend\.env >nul && (
        echo ✓ Vertex AI project configured
    ) || (
        echo ✗ Vertex AI project not configured
    )
) else (
    echo ✗ .env file not found
)

echo.
echo 2. Checking R installation...
Rscript --version >nul 2>&1 && (
    echo ✓ R is installed
    Rscript --version 2>&1
    echo.
    echo    Checking required packages...
    echo library(jsonlite); library(survival); library(dplyr); cat("✓ All core packages installed\n") > temp_check.R
    Rscript temp_check.R 2>nul || (
        echo ✗ Some required packages missing
        echo    Run: install.packages(c("jsonlite", "survival", "dplyr"^^)^^)
    )
    del temp_check.R 2>nul
) || (
    echo ✗ R is not installed
    echo    Install from: https://cran.r-project.org/bin/windows/base/
    echo    Or run: install_r_packages.bat
)

echo.
echo 3. Checking Node.js dependencies...
if exist "backend\package.json" (
    echo ✓ Backend package.json found
    if exist "backend\node_modules" (
        echo ✓ Backend node modules installed
    ) else (
        echo ✗ Backend node modules not installed
        echo    Run: cd backend ^&^& npm install
    )
) else (
    echo ✗ Backend package.json not found
)

if exist "hack-princeton\package.json" (
    echo ✓ Frontend package.json found
    if exist "hack-princeton\node_modules" (
        echo ✓ Frontend node modules installed
    ) else (
        echo ✗ Frontend node modules not installed
        echo    Run: cd hack-princeton ^&^& npm install
    )
) else (
    echo ✗ Frontend package.json not found
)

echo.
echo 4. Testing backend availability...
if exist "backend\server.js" (
    echo ✓ Backend server file found
    echo    ^(Manual test: cd backend ^&^& npm start^)
) else (
    echo ✗ Backend server file not found
)

echo.
echo 5. Real data status summary:
findstr /c:"LLM_PROVIDER=vertex" backend\.env >nul && (
    set AI_STATUS=ENABLED
) || (
    set AI_STATUS=DISABLED
)

findstr /c:"USE_R=true" backend\.env >nul && (
    Rscript --version >nul 2>&1 && (
        set R_STATUS=ENABLED
    ) || (
        set R_STATUS=DISABLED ^(R not installed^)
    )
) || (
    set R_STATUS=DISABLED ^(USE_R=false^)
)

echo    AI Text Generation: !AI_STATUS!
echo    R Statistical Analysis: !R_STATUS!
echo    Frontend Data Integration: ENABLED ^(updated^)

echo.
echo === Setup Complete ===
echo If all checks pass, your system will use real AI data!
echo.
echo To start the system:
echo 1. Backend:  cd backend ^&^& npm start
echo 2. Frontend: cd hack-princeton ^&^& npm run dev
echo.
echo To install missing dependencies:
echo - R packages: run install_packages.R in R
echo - Node modules: npm install in each directory

pause