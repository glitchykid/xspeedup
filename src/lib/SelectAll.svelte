<script lang="ts">
  let {
    ids,
    selected = $bindable<string[]>([]),
    disabled = false,
    label,
    onchange = () => {},
  }: {
    ids: string[];
    selected: string[];
    disabled?: boolean;
    label: string;
    onchange?: () => void;
  } = $props();
  const chosen = $derived(new Set(selected));
  const count = $derived(ids.reduce((sum, id) => sum + Number(chosen.has(id)), 0));
  function toggle() {
    const group = new Set(ids);
    selected =
      count === ids.length
        ? selected.filter((id) => !group.has(id))
        : [...new Set([...selected, ...ids])];
    onchange();
  }
</script>

<label class="select-all">
  <input
    type="checkbox"
    checked={ids.length > 0 && count === ids.length}
    indeterminate={count > 0 && count < ids.length}
    disabled={disabled || !ids.length}
    onchange={toggle}
  />
  <span>{label}</span><small>{count} / {ids.length}</small>
</label>
