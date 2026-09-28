export const site = {
  brand: 'Эксперт по сертификации',
  name: 'Татьяна Мосс',
  email: 'tatyana.moiseenk@mail.ru',
  telegram: 'https://t.me/tatimoss',
  phone: '',
  photo: '', // /images/expert.webp — реальная фотография, не стоковый портрет
  photoAlt: 'Татьяна Мосс — эксперт по сертификации продукции',
  experience: 15,
  legal: {
    ready: false, // После заполнения реквизитов и согласования правовых текстов
    operator: '',
    address: '',
    inn: '',
    retention:
      'До достижения цели обработки или отзыва согласия, если иной срок не установлен законодательством.',
  },
  accreditation: {
    enabled: false,
    name: '',
    registryNumber: '',
    registryUrl: '',
  },
  features: { blog: false, marking: false },
};
export const live = import.meta.env.PUBLIC_SITE_LIVE === 'true';
export const url = (path = '/') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
export const navigation = [
  ['Главная', '/'],
  ['Услуги', '/services/'],
  ['Проверка товара', '/proverka-tovara/'],
  ['Обо мне', '/about/'],
  ['Контакты', '/contacts/'],
] as const;
