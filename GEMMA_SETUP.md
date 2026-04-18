# Gemma 4 Setup Guide

## Overview
The backend now uses **Gemma 4** from Hugging Face for clinical analysis planning, R code generation, result summarization, and manager-level QC checks. It gracefully falls back to deterministic responses if the API is unavailable.

## Setup Steps

### 1. Get a Hugging Face API Key
- Sign up at [huggingface.co](https://huggingface.co)
- Go to [Settings → Tokens](https://huggingface.co/settings/tokens)
- Create a new token with **read** access
- Copy your API key

### 2. Configure Environment
```bash
# In backend/backend/.env:
LLM_PROVIDER=huggingface
HUGGINGFACE_API_KEY=API_KEY
```

If you copy from `.env.example`:
```bash
cp .env.example .env
# Then edit .env and paste your API key
```

### 3. Install Dependencies
```bash
npm install
```

### 4. (Optional) Choose a Different Model

By default, the backend uses `google/gemma-2-9b-it`. You can change it in `.env`:

```bash
# Use a faster model:
HF_MODEL=meta-llama/Llama-2-7b-chat-hf

# Or a more capable model:
HF_MODEL=mistralai/Mistral-7B-Instruct-v0.2
```

Popular models available on Hugging Face:
- `google/gemma-2-9b-it` - Balanced, instruction-tuned (default)
- `meta-llama/Llama-2-7b-chat-hf` - Fast, conversational
- `mistralai/Mistral-7B-Instruct-v0.2` - Very capable
- `HuggingFaceH4/zephyr-7b-beta` - Creative, experimental

See [huggingface.co/models](https://huggingface.co/models?pipeline_tag=text-generation&sort=downloads) for more options.

### 5. Verify Setup
```bash
npm start
```

Then hit `GET /health` — you should see:
```json
{
  "ok": true,
  "llm_provider": "huggingface",
  "r_runtime": { "available": true, "version": "..." }
}
```

## How It Works

### Functions Using Gemma 4

1. **`generateAnalysisPlan(csvMeta)`**
   - Input: CSV columns
   - Output: 5-step analysis plan tailored to the data
   - Fallback: Generic template

2. **`generateRCode(plan, csvMeta)`**
   - Input: Analysis plan + CSV metadata
   - Output: R code that computes SHAP, survival curves, and subgroups
   - Fallback: Loads `backend/r/analyze.R`

3. **`generateSummary(results)`**
   - Input: R analysis results
   - Output: 2-3 sentence clinical summary
   - Fallback: Headline + numbers

4. **`managerCheck(results)`**
   - Input: R results
   - Output: Rule-based flags + Gemma-powered clinical review
   - Fallback: Rule-based checks only

### Error Handling

If Gemma fails at any point:
- The pipeline **does not crash**
- Deterministic fallbacks are used
- Job completes successfully with `provider: "fallback"` in responses
- An error is logged but not surfaced to React

## Testing

### Test with Fallback (no API key needed)
```bash
LLM_PROVIDER=fallback npm start
```

### Test with Gemma 4
```bash
HUGGINGFACE_API_KEY=hf_your_key LLM_PROVIDER=huggingface npm start
```

### Postman Test
1. Start server: `npm start`
2. POST to `http://localhost:3000/health`
3. Upload a CSV to `POST /upload`
4. Poll `GET /jobs/:job_id` until completion
5. See the analysis results in `GET /results/:job_id`

## Troubleshooting

**"HUGGINGFACE_API_KEY is not set"**
- Check `.env` file exists
- Verify key is copied correctly
- Test with `GET /health` — it should show `llm_provider: "huggingface"`

**"Gemma analysis plan generation failed"**
- This is expected if your HF token has insufficient quota
- The pipeline automatically falls back to the template
- Check Hugging Face dashboard for rate limits

**"Cannot find module '@huggingface/inference'"**
```bash
npm install @huggingface/inference
```

## Model Details

- **Model**: `google/gemma-2-9b-it` (instruction-tuned Gemma variant via Hugging Face Inference API)
- **Provider**: Hugging Face Inference API
- **Temperature**: 0.2–0.5 (low for clinical safety)
- **Max tokens**: 500–2000 depending on task

## Rate Limits

Hugging Face free tier has rate limits. If you hit them:
- Switch to Hugging Face Pro or use your organization's account
- Fallback mode will still work, just slower to load
- In production, consider self-hosted inference or dedicated endpoints
