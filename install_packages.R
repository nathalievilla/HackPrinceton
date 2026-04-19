# Install required R packages for clinical trial analysis
# This script will install all packages needed by the HackPrinceton backend

cat("Installing required packages for clinical trial analysis...\n")

# Core packages
packages <- c(
  "jsonlite",     # JSON parsing for backend communication
  "survival",     # Survival analysis and Kaplan-Meier curves  
  "survminer",    # Enhanced survival plots
  "dplyr",        # Data manipulation
  "tidyr",        # Data tidying
  "ggplot2",      # Advanced plotting
  "readr",        # Fast CSV reading
  "stringr",      # String manipulation
  "purrr",        # Functional programming
  "broom",        # Tidy statistical output
  "car",          # Regression diagnostics
  "corrplot",     # Correlation plots
  "VIM",          # Missing data visualization
  "mice"          # Multiple imputation
)

cat("Installing packages:", paste(packages, collapse = ", "), "\n")

# Install packages
install.packages(packages, dependencies = TRUE, repos = 'https://cloud.r-project.org')

cat("Installation complete! Verifying packages...\n")

# Verify installation
for (pkg in packages) {
  if (require(pkg, character.only = TRUE, quietly = TRUE)) {
    cat("✓", pkg, "installed successfully\n")
  } else {
    cat("✗", pkg, "installation failed\n")
  }
}

cat("Setup complete! You can now run analyses with real R data.\n")
cat("Remember to restart your HackPrinceton backend after installation.\n")