// Which word a one-sided exercise uses for what it does one of at a time: "arm" (the default) or "leg".
// An exercise whose primary muscles are all leg muscles is a "leg" exercise ("10-12 reps each leg", "Switch legs").
// Used by tools/program.mjs (the check) and tools/apply_patch.mjs (sets it for a new one-sided exercise).
export const LEG_MUSCLES = ['Glutes', 'Side glutes', 'Upper glutes', 'Quads', 'Hamstrings', 'Calves', 'Inner thighs', 'Hip flexors'];
export const sideFor = (e) => {
  const p = e && e.muscles && Array.isArray(e.muscles.primary) ? e.muscles.primary : [];
  return p.length && p.every((m) => LEG_MUSCLES.includes(m)) ? 'leg' : 'arm';
};
