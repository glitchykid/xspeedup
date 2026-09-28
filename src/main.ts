import { mount } from 'svelte';
import App from './App.svelte';
import BenchmarkWindow from './lib/BenchmarkWindow.svelte';
import './styles.css';
import { applyPreferences, preferredLocale, preferredTheme } from './lib/preferences';
applyPreferences(preferredTheme(), preferredLocale(), false);
mount(location.hash === '#benchmark' ? BenchmarkWindow : App, {
  target: document.getElementById('app')!,
});
