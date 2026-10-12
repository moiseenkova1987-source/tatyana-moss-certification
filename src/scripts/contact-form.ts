type SmartCaptcha = {
  render: (element: HTMLElement, options: Record<string, unknown>) => number;
  getResponse: (id: number) => string;
  reset: (id: number) => void;
  subscribe: (id: number, event: string, callback: () => void) => () => void;
};
declare global {
  interface Window {
    smartCaptcha?: SmartCaptcha;
    tmCertSmartCaptchaLoaded?: () => void;
  }
}
const errorMessage =
  'Не удалось отправить вопрос. Попробуйте ещё раз или свяжитесь со мной напрямую.';
let scriptReady: Promise<SmartCaptcha> | undefined;
function loadSmartCaptcha(): Promise<SmartCaptcha> {
  return (scriptReady ??= new Promise((resolve, reject) => {
    if (window.smartCaptcha) {
      resolve(window.smartCaptcha);
      return;
    }
    const script = document.createElement('script');
    const timeout = setTimeout(() => reject(new Error()), 15000);
    window.tmCertSmartCaptchaLoaded = () => {
      clearTimeout(timeout);
      if (window.smartCaptcha) resolve(window.smartCaptcha);
      else reject(new Error());
    };
    script.src =
      'https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload&onload=tmCertSmartCaptchaLoaded';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error());
    };
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
  let captchaValid = false;
  let criticalCaptchaError = false;
  let api: SmartCaptcha;
  let widget: number;
  try {
    api = await loadSmartCaptcha();
    widget = api.render(form.querySelector<HTMLElement>('[data-smartcaptcha]')!, {
      sitekey,
      hl: 'ru',
      callback: (token: string) => {
        captchaValid = !!token && !criticalCaptchaError;
        button.disabled = pending || !captchaValid;
      },
    });
    api.subscribe(widget, 'token-expired', () => {
      captchaValid = false;
      button.disabled = true;
    });
    for (const event of ['network-error', 'javascript-error']) {
      api.subscribe(widget, event, () => {
        if (event === 'javascript-error') criticalCaptchaError = true;
        captchaValid = false;
        button.disabled = true;
        status.textContent = errorMessage;
      });
    }
  } catch {
    status.textContent = errorMessage;
    return;
  }
  form.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      event.target.setCustomValidity('');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    for (const name of ['name', 'contact', 'productName', 'message']) {
      const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name=${name}]`)!;
      field.setCustomValidity(!field.value.trim() ? 'Заполните это поле.' : '');
    }
    if (!form.reportValidity()) return;
    const token = api.getResponse(widget);
    if (!token || !captchaValid || criticalCaptchaError) {
      status.textContent = 'Пройдите проверку защиты от автоматических заявок.';
      status.focus();
      return;
    }
    const values = new FormData(form);
    const body: Record<string, string | boolean> = {
      consent: values.get('consent') === 'accepted',
      captchaToken: token,
    };
    for (const key of ['name', 'contact', 'productName', 'message', 'website'])
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
      status.textContent = 'Вопрос отправлен. Я свяжусь с вами в ближайшее время.';
    } catch {
      status.textContent = errorMessage;
    } finally {
      clearTimeout(timeout);
      pending = false;
      form.removeAttribute('aria-busy');
      button.textContent = 'Отправить вопрос ↗';
      button.disabled = true;
      captchaValid = false;
      api.reset(widget);
      status.focus();
    }
  });
}
