import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="text-center space-y-6"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25 shadow-[0_0_32px_rgba(45_212_191_0.15)]">
            <Compass className="size-10 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">404</h1>
            <p className="text-lg font-medium text-muted-foreground">{t('notFound.title')}</p>
            <p className="text-sm text-muted-foreground/70 max-w-md">
              {t('notFound.description')}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          <Link to="/">
            <Button className="gap-2 bg-primary hover:bg-primary/90 shadow-[0_0_16px_rgba(45_212_191_0.25)]">
              <Home className="size-4" />
              {t('notFound.back')}
            </Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
