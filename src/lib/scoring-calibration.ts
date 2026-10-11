import { DIMENSIONS, RubricCategory } from "./rubrics";
import { caseProfileEvidence, deriveCategory, landedPriceUsd, scoreDimensionEvidence, valueFromEvidence } from "./scoring";
import { Watch } from "./types";

/** Experimental allowance for the extra case stack associated with each category. */
export const CATEGORY_THICKNESS_ALLOWANCE_MM: Record<RubricCategory, number> = {
  diver: 1,
  chronograph: 0.5,
  gmt: 0.3,
  dress: 0,
  // No dive-case stack and no chronograph pushers, but not held to a dress
  // watch's thinness either — between gmt and dress.
  sports: 0.15,
};

export interface CalibrationResult {
  qualityScore?: number;
  valueScore?: number;
  wearabilityScore?: number;
}

/**
 * Comparison report for the remaining category-thickness experiment. It uses
 * production's value rule unchanged; production deliberately keeps the
 * established wearability formula until the allowance has stronger calibration
 * coverage. Value is now compared across categories, so an allowance would also
 * hand thick categories value they did not earn — weigh that before adopting it.
 */
export function calibrationScore(watch: Watch): CalibrationResult {
  const category = deriveCategory(watch);
  const priceUsd = landedPriceUsd(watch);
  const evidence = scoreDimensionEvidence(watch);

  if (category && evidence.wearability && watch.specs.caseDiameterMm && watch.specs.caseThicknessMm !== undefined) {
    evidence.wearability = caseProfileEvidence(watch.specs, CATEGORY_THICKNESS_ALLOWANCE_MM[category]);
  }

  const rated = DIMENSIONS.filter((dimension) => evidence[dimension] !== undefined);
  if (!rated.length) return {};
  const totalWeight = rated.reduce((sum, dimension) => sum + evidence[dimension]!.coverage, 0);
  const qualityScore = rated.reduce(
    (sum, dimension) => sum + evidence[dimension]!.raw * evidence[dimension]!.coverage,
    0
  ) / totalWeight;

  return {
    qualityScore,
    // Same value rule as production, so the only difference the report shows
    // is the thickness allowance.
    valueScore: valueFromEvidence(evidence, priceUsd),
    wearabilityScore: evidence.wearability?.raw,
  };
}
