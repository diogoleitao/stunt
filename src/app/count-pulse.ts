export type CountPulse = {
  // Whether the count pulses now.
  pulse: boolean;
  // The value the count has last shown while the browser tab was visible.
  shown: number;
};

// Whether a count pulses on taking `value`, given the value it has last shown
// while the browser tab was visible. A hidden tab holds the pulse until it is
// visible again, so a count that changed and changed back meanwhile does not
// pulse.
export function countPulse({
  shown,
  value,
  visible,
}: {
  shown: number;
  value: number;
  visible: boolean;
}): CountPulse {
  if (!visible) return { pulse: false, shown };
  return { pulse: value !== shown, shown: value };
}
