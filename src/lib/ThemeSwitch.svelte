<script lang="ts">
  import Icon from './Icon.svelte';
  import { preferredTheme, saveTheme, type Theme } from './theme';

  let theme = $state<Theme>(preferredTheme());

  function selectTheme(next: Theme) {
    theme = next;
    saveTheme(next);
  }
</script>

<div class="theme-switch" role="group" aria-label="Тема оформления">
  <button
    aria-label="Светлая тема"
    aria-pressed={theme === 'light'}
    title="Светлая тема — выбор сохраняется"
    onclick={() => selectTheme('light')}><Icon name="sun" size={17} /><span>Светлая</span></button
  >
  <button
    aria-label="Тёмная тема"
    aria-pressed={theme === 'dark'}
    title="Тёмная тема — выбор сохраняется"
    onclick={() => selectTheme('dark')}><Icon name="moon" size={17} /><span>Тёмная</span></button
  >
</div>
