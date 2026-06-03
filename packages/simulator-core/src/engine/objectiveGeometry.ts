export const MM_PER_INCH = 25.4;
export const OBJECTIVE_MARKER_DIAMETER_MM = 40;
export const OBJECTIVE_MARKER_RADIUS = (OBJECTIVE_MARKER_DIAMETER_MM / MM_PER_INCH) / 2;
export const OBJECTIVE_CONTROL_DISTANCE = 3;
export const OBJECTIVE_CONTROL_RADIUS = OBJECTIVE_MARKER_RADIUS + OBJECTIVE_CONTROL_DISTANCE;

export type ObjectiveControlKind = 'marker' | 'terrain-area' | 'custom';

export interface ObjectiveControlProfile {
  id: string;
  label: string;
  kind: ObjectiveControlKind;
  description: string;
  markerRadius?: number;
  controlDistance?: number;
}

export const TENTH_EDITION_MARKER_OBJECTIVE_CONTROL: ObjectiveControlProfile = {
  id: 'w40k-10e-marker-objectives',
  label: '10e Objective Markers',
  kind: 'marker',
  description: 'Units control 40mm objective markers from within 3 inches.',
  markerRadius: OBJECTIVE_MARKER_RADIUS,
  controlDistance: OBJECTIVE_CONTROL_DISTANCE,
};

export const ELEVENTH_EDITION_TERRAIN_OBJECTIVE_PLACEHOLDER: ObjectiveControlProfile = {
  id: 'w40k-11e-terrain-objectives-placeholder',
  label: '11e Terrain Objectives',
  kind: 'terrain-area',
  description: 'Placeholder for 11th Edition terrain-mat objective rules.',
};

export function objectiveControlRadius(profile: ObjectiveControlProfile): number | null {
  if (profile.kind !== 'marker') return null;
  return (profile.markerRadius ?? 0) + (profile.controlDistance ?? 0);
}
