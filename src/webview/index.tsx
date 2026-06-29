/**
 * Webview entry point. Mounts the React application and pulls in the global
 * styles (which include React Flow's base stylesheet).
 */

import { createRoot } from 'react-dom/client';

import { App } from './components/App';
// React Flow base styles first, so Atlas theme overrides take precedence.
import 'reactflow/dist/style.css';
import './styles/atlas.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Atlas webview root element not found.');
}

createRoot(container).render(<App />);
