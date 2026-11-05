import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold">{t('notFoundPage.title')}</h1>
    <p className="text-muted-foreground">{t('notFoundPage.description')}</p>
    <Link className="text-primary underline" to="/knowledge">{t('notFoundPage.back')}</Link>
  </section>;
}
