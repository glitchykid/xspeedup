// A single row edits one ID; mounted/visible rows never define the whole selection.
export function selectId(selected: string[], id: string, checked: boolean): string[] {
  const next = new Set(selected);
  if (checked) next.add(id);
  else next.delete(id);
  return [...next];
}
