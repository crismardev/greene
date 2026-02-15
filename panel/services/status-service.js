export function setStatus(element, message, isError = false, options = {}) {
  if (!element) {
    return;
  }

  const text = String(message || '');
  const loading = Boolean(options.loading);

  element.classList.toggle('is-error', isError);
  element.textContent = '';

  if (!text) {
    return;
  }

  if (!loading) {
    element.textContent = text;
    return;
  }

  const content = document.createElement('span');
  content.className = 'status__inline';

  const spinner = document.createElement('span');
  spinner.className = 'status-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.textContent = text;

  content.append(spinner, label);
  element.appendChild(content);
}
