@echo off
echo Installing R and required packages for HackPrinceton clinical trial analysis...
echo.

echo Step 1: Downloading R for Windows...
echo Please visit: https://cran.r-project.org/bin/windows/base/
echo Download and install the latest R version for Windows
echo.

echo Step 2: After installing R, run this R script to install required packages:
echo.
echo Creating install_packages.R script...
echo.

(
echo # Install required R packages for clinical trial analysis
echo # This script will install all packages needed by the HackPrinceton backend
echo.
echo cat^("Installing required packages for clinical trial analysis...\n"^)
echo.
echo # Core packages
echo packages ^<- c^(
echo   "jsonlite",     # JSON parsing for backend communication
echo   "survival",     # Survival analysis and Kaplan-Meier curves  
echo   "survminer",    # Enhanced survival plots
echo   "dplyr",        # Data manipulation
echo   "tidyr",        # Data tidying
echo   "ggplot2",      # Advanced plotting
echo   "readr",        # Fast CSV reading
echo   "stringr",      # String manipulation
echo   "purrr",        # Functional programming
echo   "broom",        # Tidy statistical output
echo   "car",          # Regression diagnostics
echo   "corrplot",     # Correlation plots
echo   "VIM",          # Missing data visualization
echo   "mice"          # Multiple imputation
echo ^)
echo.
echo cat^("Installing packages:", paste^(packages, collapse = ", "^), "\n"^)
echo.
echo # Install packages
echo install.packages^(packages, dependencies = TRUE^)
echo.
echo cat^("Installation complete! Verifying packages...\n"^)
echo.
echo # Verify installation
echo for ^(pkg in packages^) {
echo   if ^(require^(pkg, character.only = TRUE, quietly = TRUE^)^) {
echo     cat^("✓", pkg, "installed successfully\n"^)
echo   } else {
echo     cat^("✗", pkg, "installation failed\n"^)
echo   }
echo }
echo.
echo cat^("Setup complete! You can now run analyses with real R data.\n"^)
) > install_packages.R

echo install_packages.R created successfully!
echo.
echo To complete the installation:
echo 1. Install R from: https://cran.r-project.org/bin/windows/base/
echo 2. Open R or RStudio
echo 3. Run: source("install_packages.R")
echo.
echo Alternative: Run this single command in R:
echo install.packages(c("jsonlite", "survival", "survminer", "dplyr", "tidyr", "ggplot2", "readr", "stringr", "purrr", "broom", "car", "corrplot", "VIM", "mice"), dependencies = TRUE)
echo.
echo After installation, restart your HackPrinceton backend to use real R data!

pause