import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';
import { applyPreferences, preferredLocale, preferredTheme } from './lib/preferences';
applyPreferences(preferredTheme(), preferredLocale(), false);
mount(App, { target: document.getElementById('app')! });
