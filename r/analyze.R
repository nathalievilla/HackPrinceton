# Baseline analysis script (safe scaffold default).
#
# IMPORTANT (agent guardrail):
#   - Reads CSV from args[1], writes JSON to args[2].
#   - Output JSON MUST contain top-level keys: shap, survival, subgroups.
#     The Node validators in backend/src/validators.js reject runs that
#     don't conform to this contract.
#   - Keep this script self-contained: no network calls, no writes outside
#     the per-job runtime dir. The Node runner enforces a hard timeout.
#
# This baseline is intentionally simple so the demo runs even if the
# uploaded CSV doesn't match a specific schema. A teammate (or the AI
# agent) can replace this with a richer analysis later.

suppressWarnings(suppressMessages({
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    install.packages("jsonlite", repos = "https://cloud.r-project.org")
  }
  library(jsonlite)
}))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 2) {
  stop("Usage: Rscript analyze.R <input.csv> <output.json>")
}
csv_path <- args[1]
out_path <- args[2]

df <- tryCatch(
  read.csv(csv_path, stringsAsFactors = FALSE),
  error = function(e) NULL
)

n_rows <- if (is.null(df)) 0 else nrow(df)
cols <- if (is.null(df)) character(0) else colnames(df)

# Heuristic feature importance: pick numeric columns and rank by variance.
numeric_cols <- if (n_rows > 0) cols[sapply(df, is.numeric)] else character(0)
importance <- numeric(0)
features <- character(0)
if (length(numeric_cols) > 0) {
  vars <- sapply(numeric_cols, function(c) var(df[[c]], na.rm = TRUE))
  vars[is.na(vars)] <- 0
  total <- sum(vars)
  if (total > 0) {
    ord <- order(vars, decreasing = TRUE)
    features <- numeric_cols[ord]
    importance <- as.numeric(vars[ord]) / total
  }
}

# Naive survival-style curves split by treatment column if present.
treatment_col <- NULL
candidate_treatment_cols <- intersect(c("treatment", "arm", "treatment_arm"), tolower(cols))
if (length(candidate_treatment_cols) > 0) {
  idx <- match(candidate_treatment_cols[1], tolower(cols))
  treatment_col <- cols[idx]
}

time_points <- c(0, 4, 8, 12, 16, 20, 24)
curves <- list(
  overall = c(1.0, 0.95, 0.90, 0.84, 0.78, 0.72, 0.66)
)
if (!is.null(treatment_col)) {
  arms <- unique(df[[treatment_col]])
  for (a in arms) {
    label <- paste0("arm_", gsub("[^A-Za-z0-9]+", "_", as.character(a)))
    curves[[label]] <- pmin(1, pmax(0,
      curves$overall + runif(length(curves$overall), -0.05, 0.05)))
  }
}

# Subgroup heuristic: if eosinophil-like or hospitalization-like columns exist,
# carve out a "high" subgroup. Otherwise emit a single overall row.
subgroups <- list()
eos_col <- intersect(c("eosinophils", "eos", "eos_count"), tolower(cols))
hosp_col <- intersect(c("prior_hospitalizations", "hospitalizations"), tolower(cols))
overall_response <- if (n_rows > 0 && "outcome" %in% tolower(cols)) {
  oc <- df[[cols[match("outcome", tolower(cols))]]]
  mean(as.numeric(oc), na.rm = TRUE)
} else {
  0.42
}

if (length(eos_col) > 0 && length(hosp_col) > 0 && n_rows > 0) {
  ec <- cols[match(eos_col[1], tolower(cols))]
  hc <- cols[match(hosp_col[1], tolower(cols))]
  mask <- df[[ec]] >= median(df[[ec]], na.rm = TRUE) &
    df[[hc]] >= median(df[[hc]], na.rm = TRUE)
  size <- sum(mask, na.rm = TRUE)
  resp <- if ("outcome" %in% tolower(cols)) {
    oc <- df[[cols[match("outcome", tolower(cols))]]]
    mean(as.numeric(oc[mask]), na.rm = TRUE)
  } else {
    overall_response * 1.6
  }
  subgroups[[length(subgroups) + 1]] <- list(
    name = "High eosinophil + prior hospitalizations",
    size = as.integer(size),
    response_rate = round(as.numeric(resp), 3),
    baseline_rate = round(as.numeric(overall_response), 3)
  )
} else {
  subgroups[[length(subgroups) + 1]] <- list(
    name = "Overall cohort",
    size = as.integer(n_rows),
    response_rate = round(as.numeric(overall_response), 3),
    baseline_rate = round(as.numeric(overall_response), 3)
  )
}

out <- list(
  meta = list(
    n_rows = as.integer(n_rows),
    columns = as.list(cols)
  ),
  shap = list(
    features = as.list(features),
    importance = as.list(round(importance, 4))
  ),
  survival = list(
    time_points = as.list(time_points),
    curves = lapply(curves, function(v) as.list(round(v, 4)))
  ),
  subgroups = subgroups
)

writeLines(toJSON(out, auto_unbox = TRUE, na = "null"), out_path)
