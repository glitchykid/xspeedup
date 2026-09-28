export function allWorkersVerified(passes: ReadonlyMap<number, number>, count: number): boolean {
  for (let id = 0; id < count; id++) {
    const value = passes.get(id);
    if (value === undefined || !Number.isSafeInteger(value) || value < 1) return false;
  }
  return true;
}
