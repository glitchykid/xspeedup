import { mount } from 'svelte';
import App from './App.svelte';
import { applyTheme, preferredTheme } from './lib/theme';
import './styles.css';
applyTheme(preferredTheme());
mount(App, { target: document.getElementById('app')! });
