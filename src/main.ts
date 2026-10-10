import '../styles.css';
import '../mobile.css';
import '../app.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.error('Service worker registration failed.', error);
    });
  });
}
