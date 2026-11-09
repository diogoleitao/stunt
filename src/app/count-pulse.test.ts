import { describe, expect, it } from "vitest";
import { countPulse } from "./count-pulse.ts";

describe("a count's pulse", () => {
  it("does not pulse when a check leaves the count as shown", () => {
    expect(countPulse({ shown: 3, value: 3, visible: true })).toEqual({ pulse: false, shown: 3 });
  });

  it("pulses when a check raises the count, showing the new value", () => {
    expect(countPulse({ shown: 3, value: 4, visible: true })).toEqual({ pulse: true, shown: 4 });
  });

  it("pulses when a check lowers the count, down to zero", () => {
    expect(countPulse({ shown: 1, value: 0, visible: true })).toEqual({ pulse: true, shown: 0 });
  });

  it("holds the pulse while the browser tab is hidden, keeping the value last shown", () => {
    expect(countPulse({ shown: 3, value: 5, visible: false })).toEqual({ pulse: false, shown: 3 });
  });

  it("pulses once the browser tab is visible again after checks changed the count while hidden", () => {
    const hidden = countPulse({ shown: 3, value: 4, visible: false });
    const laterHidden = countPulse({ shown: hidden.shown, value: 5, visible: false });
    expect(countPulse({ shown: laterHidden.shown, value: 5, visible: true })).toEqual({ pulse: true, shown: 5 });
  });

  it("does not pulse when checks changed the count and back while the browser tab was hidden", () => {
    const hidden = countPulse({ shown: 3, value: 4, visible: false });
    const laterHidden = countPulse({ shown: hidden.shown, value: 3, visible: false });
    expect(countPulse({ shown: laterHidden.shown, value: 3, visible: true })).toEqual({ pulse: false, shown: 3 });
  });
});
