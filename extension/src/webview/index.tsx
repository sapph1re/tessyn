import { render } from 'preact';
import { App } from './App.js';
import { signalReady } from './api.js';

const root = document.getElementById('root');
if (root) {
  render(<App />, root);
  signalReady();
}
