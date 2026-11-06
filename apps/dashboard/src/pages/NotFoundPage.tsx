import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { pageClass, pageSubtitleClass, pageTitleClass } from '../components/ui/control-styles.js';

export function NotFoundPage() {
  const { t } = useTranslation();
  return <section className={pageClass}>
    <h1 className={pageTitleClass}>{t('notFoundPage.title')}</h1>
    <p className={pageSubtitleClass}>{t('notFoundPage.description')}</p>
    <Link className="text-primary underline" to="/knowledge">{t('notFoundPage.back')}</Link>
  </section>;
}
