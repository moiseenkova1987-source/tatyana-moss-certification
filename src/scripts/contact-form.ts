type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  getResponse: (id: string) => string;
  reset: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
const errorMessage =
  'Не удалось отправить заявку. Попробуйте ещё раз или свяжитесь со мной напрямую.';
let scriptReady: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  return (scriptReady ??= new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error()));
    script.onerror = () => reject(new Error());
    document.head.append(script);
  }));
}

export async function initContactForm(form: HTMLFormElement) {
  // Prevent native GET navigation (and data in URLs), even if the widget fails to load.
  form.addEventListener('submit', (event) => event.preventDefault());
  const status = form.querySelector<HTMLElement>('.form-status')!;
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const endpoint = form.dataset.endpoint;
  const sitekey = form.dataset.sitekey;
  // No loader and no submission listener capable of sending data while disabled.
  if (!endpoint || !sitekey) {
    form.addEventListener('submit', (event) => event.preventDefault());
    return;
  }
  button.disabled = true;
  let pending = false;
  let api: Turnstile;
  let widget: string;
  try {
    api = await loadTurnstile();
    widget = api.render(form.querySelector<HTMLElement>('[data-turnstile]')!, {
      sitekey,
      action: 'contact',
      size: 'compact',
      language: 'ru',
      'response-field': false,
      callback: () => {
        if (!pending) button.disabled = false;
      },
      'expired-callback': () => {
        if (!pending) button.disabled = true;
      },
      'error-callback': () => {
        button.disabled = true;
        status.textContent = errorMessage;
      },
    });
  } catch {
    status.textContent = errorMessage;
    return;
  }
  form.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement) event.target.setCustomValidity('');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    const link = form.querySelector<HTMLInputElement>('[name=productUrl]')!;
    link.setCustomValidity(
      link.value.trim() && !/^https?:\/\//i.test(link.value.trim())
        ? 'Укажите ссылку http:// или https://.'
        : '',
    );
    for (const name of ['name', 'contact', 'productName']) {
      const field = form.querySelector<HTMLInputElement>(`[name=${name}]`)!;
      field.setCustomValidity(!field.value.trim() ? 'Заполните это поле.' : '');
    }
    if (!form.reportValidity()) return;
    const token = api.getResponse(widget);
    if (!token) {
      status.textContent = 'Пройдите проверку защиты от автоматических заявок.';
      status.focus();
      return;
    }
    const values = new FormData(form);
    const body: Record<string, string | boolean> = {
      consent: values.get('consent') === 'accepted',
      turnstileToken: token,
    };
    for (const key of [
      'name',
      'contact',
      'email',
      'productName',
      'productUrl',
      'message',
      'website',
    ])
      body[key] = String(values.get(key) || '').trim();
    pending = true;
    button.disabled = true;
    button.textContent = 'Отправляем…';
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'Отправляем…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error();
      form.reset();
      status.textContent = 'Заявка отправлена. Я свяжусь с вами в ближайшее время.';
    } catch {
      status.textContent = errorMessage;
    } finally {
      clearTimeout(timeout);
      pending = false;
      form.removeAttribute('aria-busy');
      button.textContent = 'Отправить заявку ↗';
      button.disabled = true;
      api.reset(widget);
      status.focus();
    }
  });
}
