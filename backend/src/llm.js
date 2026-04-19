/**
 * Provider-agnostic LLM wrapper.
 *
 * IMPORTANT (agent guardrail):
 *   - Always go through `generateAnalysisPlan`, `generateRCode`,
 *     `generateSummary`, and `managerCheck`. Do not call provider SDKs from
 *     pipeline.js or routes.
 *   - Every function MUST return a deterministic fallback if no provider is
 *     configured or the call fails. The demo cannot crash because the AI is
 *     down.
 *   - LLM_PROVIDER is read from env. Currently supported: "fallback" (always
 *     deterministic), "vertex" (Google Vertex AI).
 */

const { VertexAI } = require('@google-cloud/vertexai');

const PROVIDER = (process.env.LLM_PROVIDER || "fallback").toLowerCase();
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || "";
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "us-central1";
const VERTEX_MODEL = process.env.VERTEX_MODEL || "gemini-1.5-flash";

// Initialize Vertex AI client
let vertexAI = null;
let generativeModel = null;
if (VERTEX_PROJECT_ID && PROVIDER === 'vertex') {
  try {
    vertexAI = new VertexAI({ project: VERTEX_PROJECT_ID, location: VERTEX_LOCATION });
    generativeModel = vertexAI.getGenerativeModel({ model: VERTEX_MODEL });
    console.log(`🔧 [LLM] Vertex AI client initialized with model: ${VERTEX_MODEL}`);
  } catch (error) {
    console.error('❌ [LLM] Failed to initialize Vertex AI:', error.message);
  }
}

async function callVertexAI(prompt, systemPrompt = "") {
  if (!generativeModel) {
    throw new Error("Vertex AI not configured");
  }
  
  console.log(`🚀 [LLM] Making Vertex AI call with model: ${VERTEX_MODEL}...`);
  try {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const result = await generativeModel.generateContent(fullPrompt);
    const response = result.response;
    console.log('✅ [LLM] Vertex AI call successful');
    return response.candidates[0].content.parts[0].text;
  } catch (error) {
    // Try with alternative model names if the first one fails
    console.log(`⚠️ [LLM] Primary model ${VERTEX_MODEL} failed, trying alternatives...`);
    const alternativeModels = ['gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    
    for (const altModel of alternativeModels) {
      if (altModel === VERTEX_MODEL) continue; // Skip the one we already tried
      
      try {
        console.log(`🔄 [LLM] Trying model: ${altModel}`);
        const altGenerativeModel = vertexAI.getGenerativeModel({ model: altModel });
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
        const result = await altGenerativeModel.generateContent(fullPrompt);
        const response = result.response;
        console.log(`✅ [LLM] Success with alternative model: ${altModel}`);
        return response.candidates[0].content.parts[0].text;
      } catch (altError) {
        console.log(`❌ [LLM] Model ${altModel} also failed:`, altError.message);
        continue;
      }
    }
    
    console.error('❌ [LLM] All Vertex AI models failed:', error.message);
    throw error;
  }
}

async function generateAnalysisPlan(csvMeta) {
  console.log('🔍 [LLM] Starting analysis plan generation...');
  const cols = (csvMeta && csvMeta.columns) || [];
  console.log(`📊 [LLM] CSV metadata - Columns: ${cols.length}, Rows: ${csvMeta?.row_count || 'unknown'}`);
  
  if (PROVIDER === 'vertex' && generativeModel) {
    console.log('🤖 [LLM] Using Vertex AI provider for analysis plan');
    try {
      const systemPrompt = `# Role
You are a world-class biostatistician and R programmer with expertise in 
clinical trial analysis and FDA regulatory submissions.

# Objective
You will receive metadata about a clinical trial CSV file including column 
names and sample rows. Your goal is to produce a structured analysis plan 
that a junior R programmer could follow exactly to analyze this data.

Think step by step. Be specific about which columns to use for each step 
based on the column names provided.

# Analysis Steps

1. Data Profiling
   - Count total rows and columns
   - Identify column data types
   - Identify which column represents the treatment arm
   - Identify which column represents the primary outcome

2. Data Quality Checks
   - Count missing values per column
   - Flag numeric columns with outliers beyond 3 standard deviations
   - Count the number of unique treatment arms and report them
   - Confirm outcome column contains only binary values (0 and 1)

3. Data Cleaning
   - Remove duplicate rows based on patient ID column if present
   - Handle missing values: remove rows where the outcome column 
     is missing, impute missing numeric values with column median
   - Standardize the treatment arm column: trim whitespace, 
     convert to consistent casing
   - Convert the outcome column to binary integer (0 and 1) 
     if it contains text values like "Yes/No" or "Responder/Non-responder"
   - Remove rows where treatment arm value appears fewer than 
     5 times as these are likely data entry errors
   - Report how many rows were removed and why

4. Treatment Arm Balance
   - Count patients per treatment arm
   - Flag if any arm has fewer than 30 patients

5. Baseline Characteristics
   - Compute mean and standard deviation of numeric columns by treatment arm
   - Compute frequency counts and percentages of categorical columns 
     by treatment arm

6. Primary Efficacy Analysis
   - Fit a logistic regression predicting the outcome column from treatment 
     arm and all other relevant numeric columns
   - Report odds ratios and p-values

7. Subgroup Analysis
   - Identify 2 to 3 key numeric columns as subgroup variables
   - Split patients into high and low groups using the median as cutoff
   - Compute response rate in each subgroup
   - Flag subgroups where response rate is 1.5x higher than the overall 
     baseline rate

8. SHAP Feature Importance
   - Use logistic regression coefficients as a proxy for feature importance
   - Exclude the intercept term
   - Report feature names and their importance values

9. Survival Analysis
   - Generate Kaplan-Meier curves split by treatment arm
   - Extract time points and survival probabilities for each arm separately

10. Required Outputs
   - Demographics and baseline characteristics table
   - Primary efficacy results table
   - One Kaplan-Meier figure
   - Subgroup response rate summary

# Output Format
Return only a structured analysis plan as numbered steps.
Do not write any R code.
Do not include any code blocks.
Only describe what needs to be done, not how to implement it in code.
The R implementation will be handled separately.

# Critical Rules
- Base your plan entirely on the column names provided
- Do not invent columns that were not provided
- Every step must reference specific column names from the data
- Output JSON must have exactly these top level keys: shap, survival, 
  subgroups, demographics, efficacy

# Data Available
The following column names and sample rows will be provided at runtime 
based on the uploaded CSV. Use only these columns in your analysis plan 
and generated R code.`;
      
      const prompt = `CSV columns: ${cols.join(', ')}
Row count: ${csvMeta?.row_count || 'unknown'}
Additional metadata: ${JSON.stringify(csvMeta, null, 2)}

Create a flexible analysis plan that works with these specific columns.
Focus on extracting meaningful insights regardless of the data domain.
Work with whatever columns are available - do not require specific column names.
Automatically detect the best columns to use for grouping and outcomes.`;
      
      const response = await callVertexAI(prompt, systemPrompt);
      const cleanResponse = response.replace(/```(json)?|```/g, '').trim();
      
      // Try to parse as JSON first, if not, create structured plan from text
      let parsed;
      try {
        parsed = JSON.parse(cleanResponse);
      } catch {
        // If not valid JSON, create a structured plan array from the text
        const planSteps = cleanResponse.split(/\d+\./).filter(step => step.trim().length > 0);
        parsed = {
          plan: planSteps.map(step => step.trim()).slice(0, 10),
          target_columns: cols,
        };
      }
      
      return {
        provider: "vertex",
        plan: parsed.plan || [
          "Profile the CSV (n rows, column types, missingness).",
          "Fit a baseline response model (logistic regression on treatment + key covariates).",
          "Compute SHAP-style feature importance approximations.",
          "Build Kaplan-Meier survival curves split by treatment arm and key subgroups.",
          "Identify subgroups with response_rate >= 1.5x baseline.",
        ],
        target_columns: parsed.target_columns || cols,
      };
    } catch (error) {
      console.warn('⚠️ [LLM] Vertex AI analysis plan generation failed:', error.message);
    }
  } else {
    console.log('⏭️ [LLM] Using fallback provider for analysis plan (Vertex AI not configured)');
  }
  
  console.log('📝 [LLM] Using fallback analysis plan');
  
  // Fallback
  return {
    provider: "fallback",
    plan: [
      "Profile the CSV (n rows, column types, missingness).",
      "Fit a baseline response model (logistic regression on treatment + key covariates).",
      "Compute SHAP-style feature importance approximations.",
      "Build Kaplan-Meier survival curves split by treatment arm and key subgroups.",
      "Identify subgroups with response_rate >= 1.5x baseline.",
    ],
    target_columns: cols,
  };
}

async function generateRCode(plan, csvMeta) {
  console.log('⚙️ [LLM] Starting R code generation...');
  const fs = require("fs");
  const path = require("path");
  
  if (PROVIDER === 'vertex' && generativeModel && plan) {
    console.log('🤖 [LLM] Using Vertex AI provider for R code generation');
    try {
      const cols = (csvMeta && csvMeta.columns) || [];
      const systemPrompt = `# Role
You are a world-class biostatistician and R programmer with expertise in 
clinical trial analysis and FDA regulatory submissions.

# Objective
You will receive an analysis plan for a clinical trial dataset and the 
column names available in the data. Your goal is to write a complete, 
executable R script that implements every step in the plan exactly.

The script must read the CSV from args[1] and write the results as JSON 
to args[2]. Return raw R code only with no explanation, no markdown 
formatting, and no code blocks. The output must be valid R that can be 
executed directly by Rscript without modification.

# Output Format
Return raw R code only.
Do not include any explanation or commentary.
Do not include markdown formatting or code fences like \`\`\`r or \`\`\`.
Do not include any text before or after the R code.
The first line of your response must be a library() call.
The last line of your response must be:
write(json_data, output_json)

# Data Cleaning Requirements
Before any analysis, the R script must clean the data in this order:
- Remove duplicate rows using duplicated()
- Remove rows where the outcome column is missing using na.omit 
  on that column only
- Impute missing numeric values with column median using sapply 
  and is.numeric
- Standardize the treatment arm column using trimws() and tolower() 
  to remove whitespace and normalize casing
- Convert the outcome column to binary integer using as.integer() 
  in case it contains text values
- Remove treatment arm groups with fewer than 5 rows as these 
  are likely data entry errors
- Track rows removed at each step and store in a cleaning_summary 
  named list

# Critical Rules
- Base your code entirely on the column names provided
- Do not invent columns that were not provided
- Every step must reference specific column names from the data
- The final R code must read from args[1] and write JSON to args[2]
- Output JSON must have exactly these top level keys: shap, survival, 
  subgroups, demographics, efficacy, data_cleaning
- Always include library() calls at the top of the R script
- Never hardcode file paths
- For shap output, use coef(model)[-1] to exclude the intercept. 
  Populate shap$features with predictor names and shap$importance 
  with absolute coefficient values. Never return empty shap arrays
- For Kaplan-Meier curves, always use summary(fit) then filter 
  strata using paste0(treatment_col, "=", arm) where treatment_col 
  is the actual treatment arm column name identified from the data. 
  Never index survfit objects directly by arm name
- For categorical summaries by group, use tapply() not aggregate() 
  with cbind
- For numeric summaries, compute mean and sd as separate tapply calls 
  and combine into a named list. Never use c(mean=, sd=) inside tapply
- When computing SHAP feature importance, always exclude the intercept 
  using coef(model)[-1]
- The treatment arm column may have 2 or more unique values
- All analyses must work dynamically across any number of arms
- Kaplan-Meier curves must be generated for every arm present 
  in the data after cleaning
- The data_cleaning key in the output JSON must contain a summary 
  of rows removed and reasons`;
      
      const prompt = `# Analysis Plan
The following analysis plan was generated from the dataset metadata. 
Implement every step exactly as described:

${JSON.stringify(plan.plan)}

# Data Available
Columns: ${cols.join(', ')}
Context: ACTG 175 HIV trial, treatment='trt', outcome='label'

Generate the complete R script that implements this analysis plan:`;
      
      const rCode = await callVertexAI(prompt, systemPrompt);
      console.log('✅ [LLM] Vertex AI R code generated successfully');
      
      // Clean the response to ensure it's pure R code
      const cleanedRCode = rCode
        .replace(/```(r)?|```/g, '')
        .replace(/^#.*$/gm, '') // Remove comment lines that start with #
        .trim();
      
      // Basic validation that it's R code
      if (cleanedRCode.includes('args') && (cleanedRCode.includes('jsonlite') || cleanedRCode.includes('toJSON'))) {
        console.log('✅ [LLM] R code validation passed');
        return {
          provider: "vertex",
          r_code: cleanedRCode,
          based_on_plan: true,
        };
      } else {
        console.warn('⚠️ [LLM] R code validation failed - missing required components');
      }
    } catch (error) {
      console.warn('⚠️ [LLM] Vertex AI R code generation failed:', error.message);
    }
  } else {
    console.log('⏭️ [LLM] Using fallback provider for R code (Vertex AI not configured or no plan)');
  }
  
  console.log('📝 [LLM] Using fallback R script');
  
  // Fallback to existing script
  const baselinePath = path.join(__dirname, "..", "r", "analyze.R");
  if (fs.existsSync(baselinePath)) {
    return {
      provider: "fallback",
      r_code: fs.readFileSync(baselinePath, "utf8"),
      based_on_plan: !!plan,
    };
  }
  return { provider: "fallback", r_code: MINIMAL_R, based_on_plan: false };
}

async function generateSummary(results) {
  console.log('📝 [LLM] Starting summary generation...');
  if (PROVIDER === 'vertex' && generativeModel) {
    console.log('🤖 [LLM] Using Vertex AI provider for summary generation');
    try {
      const systemPrompt = `# Role
You are a medical communications expert who translates complex clinical 
trial statistics into clear, actionable summaries for non-statistician 
audiences such as medical directors and regulators.

# Objective
You will receive JSON results from a clinical trial analysis. Your goal 
is to write a plain English summary that a medical director or regulator 
can read and act on without any statistical background.

# Output Format
Write exactly 3 paragraphs with no headers, no bullet points, no 
statistical jargon, and no markdown formatting.

Paragraph 1: What the trial found overall. Did the treatment work? 
How strong was the effect? Keep it to 2 to 3 sentences.

Paragraph 2: Which specific patient subgroup responded best and why 
this matters clinically. Reference the actual subgroup name and 
response rate from the results. Keep it to 2 to 3 sentences.

Paragraph 3: What should happen next based on these findings. Should 
a new trial be designed targeting this subgroup? Is further 
investigation needed? Keep it to 2 to 3 sentences.

# Critical Rules
- Never use statistical terms like p-value, odds ratio, hazard ratio, 
  confidence interval, or coefficient
- Never use numbers with more than 2 decimal places
- Always reference specific subgroup names and response rates from 
  the results
- Never invent findings that are not in the results JSON
- Never use markdown formatting, headers, or bullet points
- Write in plain conversational English that a non-scientist can 
  understand
- If no standout subgroup was found say so clearly and explain what 
  that means for next steps
- Total response must be under 200 words
- Never use the phrase "statistically significant"
- Instead say "this difference is meaningful" or "this finding is reliable"`;
      
      const prompt = `# Analysis Results
The following JSON contains the results of the clinical trial analysis:

${JSON.stringify(results, null, 2)}

Write the 3-paragraph summary based on these results:`;
      
      const summary = await callVertexAI(prompt, systemPrompt);
      console.log('✅ [LLM] Vertex AI summary generated successfully');
      return { provider: "vertex", summary: summary.trim() };
    } catch (error) {
      console.warn('⚠️ [LLM] Vertex AI summary generation failed:', error.message);
    }
  } else {
    console.log('⏭️ [LLM] Using fallback provider for summary (Vertex AI not configured)');
  }
  
  console.log('📝 [LLM] Using fallback summary');
  
  // Fallback
  const subgroup = pickHeadlineSubgroup(results);
  const text = subgroup
    ? `${subgroup.name} (n=${subgroup.size}) responded at ${(subgroup.response_rate * 100).toFixed(0)}% vs a baseline of ${(subgroup.baseline_rate * 100).toFixed(0)}%, suggesting a candidate enrichment subgroup worth prospective evaluation.`
    : "Analysis completed but no standout subgroup was identified above the 1.5x baseline threshold.";
  return { provider: "fallback", summary: text };
}

async function managerCheck(results) {
  console.log('🔍 [LLM] Starting manager check/QC review...');
  if (PROVIDER === 'vertex' && generativeModel) {
    console.log('🤖 [LLM] Using Vertex AI provider for manager check');
    try {
      const systemPrompt = `# Role
You are a senior biostatistician and FDA regulatory expert reviewing 
the work of a junior statistician. Your job is to identify any 
statistical, methodological, or data quality issues that would 
concern a regulator or delay a submission.

# Objective
You will receive JSON results from a clinical trial analysis. Your 
goal is to review the results and produce a structured QC report 
that flags any issues, warnings, or concerns a senior biostatistician 
would raise.

# Output Format
Return a JSON object with exactly this structure:

{
  "clinically_reasonable": true or false,
  "overall_assessment": "one sentence summary of the analysis quality",
  "flags": [
    {
      "severity": "warning" or "info",
      "category": "sample_size" or "data_quality" or "methodology" 
                  or "subgroup" or "model_fit" or "shap",
      "message": "specific description of the issue"
    }
  ],
  "recommendations": [
    "specific actionable recommendation for the statistician"
  ],
  "notes": "any additional context for the reviewing statistician"
}

# What To Check
- Sample size: flag any subgroup with fewer than 30 patients as 
  a warning
- Response rates: flag any subgroup with response rate above 95% 
  as suspicious, possible label leakage
- SHAP importance: flag if any single feature dominates with 
  importance above 0.7, suggests possible confounding, use 
  category "shap"
- Subgroup findings: flag if the flagged subgroup is very small 
  relative to the overall population, findings may not be 
  generalizable
- Treatment arm balance: flag if one arm has more than twice the 
  patients of the other arm
- clinically_reasonable: MUST be set to false if the flags array 
  contains ANY item with severity "warning". This is non-negotiable.
  Only set to true if there are zero warning severity flags.

# Critical Rules
- Return valid JSON only with no explanation or commentary around it
- Never invent flags that are not supported by the results data
- Every flag message must reference specific numbers from the results
- Always include at least one recommendation even if no flags are raised
- Notes field must always remind the reviewer that human sign-off 
  is required before clinical decisions
- If flags array contains ANY item with severity "warning" then 
  clinically_reasonable MUST be false. No exceptions.
- Valid flag categories are: sample_size, data_quality, methodology, 
  subgroup, model_fit, shap
- Do not use any category not in the list above`;
      
      const prompt = `# Analysis Results
The following JSON contains the results of the clinical trial analysis:

${JSON.stringify(results, null, 2)}

Provide the QC review in the specified JSON format:`;
      
      const response = await callVertexAI(prompt, systemPrompt);
      console.log('✅ [LLM] Vertex AI manager check completed successfully');
      const cleanResponse = response.replace(/```(json)?|```/g, '').trim();
      const parsed = JSON.parse(cleanResponse);
      
      return {
        provider: "vertex",
        clinically_reasonable: parsed.clinically_reasonable || false,
        flags: parsed.flags || [],
        overall_assessment: parsed.overall_assessment || "Analysis completed",
        recommendations: parsed.recommendations || [],
        notes: parsed.notes || "Automated review only. Statistician sign-off required before clinical decisions.",
      };
    } catch (error) {
      console.warn('⚠️ [LLM] Vertex AI manager check failed:', error.message);
    }
  } else {
    console.log('⏭️ [LLM] Using fallback provider for manager check (Vertex AI not configured)');
  }
  
  console.log('📝 [LLM] Using fallback manager check');
  
  // Fallback logic with structured output matching new format
  const flags = [];
  const recommendations = [];
  const subgroups = (results && results.subgroups) || [];
  
  for (const s of subgroups) {
    if (typeof s.size === "number" && s.size < 30) {
      flags.push({
        severity: "warning",
        category: "sample_size",
        message: `Subgroup "${s.name}" has ${s.size} patients, below the recommended minimum of 30 for stable inference.`,
      });
    }
    if (
      typeof s.response_rate === "number" &&
      typeof s.baseline_rate === "number" &&
      s.response_rate > 0.95
    ) {
      flags.push({
        severity: "warning",
        category: "data_quality",
        message: `Subgroup "${s.name}" has ${(s.response_rate * 100).toFixed(0)}% response rate, which is suspiciously high and may indicate label leakage.`,
      });
    }
  }

  const shap = results && results.shap;
  if (shap && Array.isArray(shap.importance)) {
    const sum = shap.importance.reduce((a, b) => a + (b || 0), 0);
    if (sum > 1.05) {
      flags.push({
        severity: "info",
        category: "shap",
        message: `SHAP importance values sum to ${sum.toFixed(2)}, suggesting unnormalized feature weights.`,
      });
    }
    
    const maxImportance = Math.max(...shap.importance);
    if (maxImportance > 0.7) {
      flags.push({
        severity: "warning",
        category: "shap",
        message: `Single feature dominates SHAP importance at ${(maxImportance * 100).toFixed(0)}%, suggesting possible confounding.`,
      });
    }
  }

  // Add recommendations based on flags
  if (flags.some(f => f.category === "sample_size")) {
    recommendations.push("Consider pooling small subgroups or collecting additional data before drawing conclusions.");
  }
  if (flags.some(f => f.category === "data_quality")) {
    recommendations.push("Verify outcome definitions and data entry procedures to rule out label leakage.");
  }
  if (flags.length === 0) {
    recommendations.push("Analysis appears methodologically sound; proceed with clinical interpretation review.");
  }

  const hasWarnings = flags.some(f => f.severity === "warning");
  
  return {
    provider: "fallback",
    clinically_reasonable: !hasWarnings,
    overall_assessment: hasWarnings ? "Analysis contains methodological concerns requiring attention." : "Analysis meets basic quality standards.",
    flags,
    recommendations,
    notes: "Automated review only. Senior biostatistician sign-off required before clinical decisions.",
  };
}

function pickHeadlineSubgroup(results) {
  const subs = (results && results.subgroups) || [];
  if (!subs.length) return null;
  return subs
    .filter(
      (s) =>
        typeof s.response_rate === "number" && typeof s.baseline_rate === "number"
    )
    .sort(
      (a, b) =>
        b.response_rate - b.baseline_rate - (a.response_rate - a.baseline_rate)
    )[0];
}

const MINIMAL_R = `args <- commandArgs(trailingOnly = TRUE)
csv_path <- args[1]
out_path <- args[2]
out <- list(shap = list(features = list(), importance = list()),
            survival = list(time_points = list(), curves = list()),
            subgroups = list())
writeLines(jsonlite::toJSON(out, auto_unbox = TRUE), out_path)
`;

module.exports = {
  PROVIDER,
  VERTEX_MODEL,
  VERTEX_PROJECT_ID,
  VERTEX_LOCATION,
  isConfigured: () => PROVIDER === 'vertex' && !!VERTEX_PROJECT_ID,
  generateAnalysisPlan,
  generateRCode,
  generateSummary,
  managerCheck,
};
