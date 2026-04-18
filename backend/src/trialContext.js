/**
 * Trial context provider.
 *
 * IMPORTANT (agent guardrail):
 *   - This is a stub for now. The shape returned here is the contract that
 *     Dashboard.jsx renders against (see the trialInfo state in
 *     hack-princeton/src/Dashboard.jsx).
 *   - TODO(team): replace `getTrialContext` with a live TREKIDS lookup once
 *     API access is provisioned. Keep the same return shape so the frontend
 *     does not need to change.
 */

const ACTG_175 = {
  name: "ACTG 175",
  nct_id: "NCT00000625",
  indication: "HIV infection in adults with CD4 counts 200-500",
  status: "Phase 3 - Completed",
  sponsor: "NIH / NIAID",
  description:
    "Randomized, double-blind trial comparing zidovudine (ZDV) monotherapy to ZDV + didanosine, ZDV + zalcitabine, and didanosine monotherapy in HIV-infected adults.",
  required_columns: ["age", "trt", "label"],
  source: "stub",
};

function getTrialContext(/* trialId */) {
  // TODO(team): use trialId to look up TREKIDS metadata when API is ready.
  return ACTG_175;
}

module.exports = { getTrialContext };
