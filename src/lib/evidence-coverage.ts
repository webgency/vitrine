import { caliberTier, scoreDimensionEvidence } from "./scoring";
import { DIMENSIONS } from "./rubrics";
import type { Watch } from "./types";

/** Explain the same recorded inputs used by scoreDimensionEvidence. */
export function evidenceBreakdown(watch: Watch) {
  const s = watch.specs;
  const f = watch.qualityFlags ?? {};
  const evidence = scoreDimensionEvidence(watch);
  const inputs: Record<typeof DIMENSIONS[number], Array<[string, boolean]>> = {
    movement: [["Recognized caliber", caliberTier(s.caliber, s.movement) !== undefined], ["Regulation (positions or accuracy spec)", f.regulatedPositions !== undefined || f.accuracySpecSpd !== undefined], ["Power reserve", s.powerReserveHours !== undefined]],
    wearability: [["Case diameter", s.caseDiameterMm !== undefined && s.caseDiameterMm > 0], ["Case thickness", s.caseThicknessMm !== undefined], ["Lug-to-lug", s.lugToLugMm !== undefined]],
    caseCraft: [["Case hardening", f.hardenedCoatingHv !== undefined], ["Bezel insert (sapphire or ceramic)", f.sapphireBezelInsert !== undefined || f.ceramicBezelInsert !== undefined], ["Drilled lugs", f.drilledLugs !== undefined], ["AR coating", f.arLayers !== undefined || f.arCoated !== undefined]],
    bracelet: [["Included bracelet or strap", f.braceletIncluded !== undefined], ["Clasp micro-adjustment", f.microAdjustClasp !== undefined], ["Quick release", f.quickRelease !== undefined]],
    durability: [["Water resistance", s.waterResistanceM !== undefined], ["Crystal", s.crystal !== undefined]],
  };
  return DIMENSIONS.map(dimension => ({
    dimension,
    applicable: dimension !== "bracelet" || f.braceletIncluded !== false,
    coverage: evidence[dimension]?.coverage ?? 0,
    recorded: inputs[dimension].filter(([, known]) => known).map(([label]) => label),
    missing: inputs[dimension].filter(([, known]) => !known).map(([label]) => label),
    gated: evidence[dimension] === undefined,
  }));
}
