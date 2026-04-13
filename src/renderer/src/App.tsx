import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, Power } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { HomePage } from '@/components/home/HomePage';
import { ModelsPage } from '@/components/models/ModelsPage';
import { SnippetsPage } from '@/components/snippets/SnippetsPage';
import { DictionaryPage } from '@/components/dictionary/DictionaryPage';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { DashboardPage } from '@/components/dashboard/DashboardPage';
import { AudiobookPage } from '@/components/audiobook/AudiobookPage';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useHistory } from '@/hooks/use-history';
import { useStatus } from '@/hooks/use-status';
import { useConfig } from '@/hooks/use-config';
import { usePermissions } from '@/hooks/use-permissions';

const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export default function App() {
  const [page, setPage] = useState('transcripts');
  const { entries, totalWords, clearHistory, deleteEntry, copy, paste } = useHistory();
  const { status, isError, isLoading } = useStatus();
  const appConfig = useConfig();
  const { mic, accessibility, needsRestart, restartApp } = usePermissions();

  return (
    <div className="flex h-screen">
      <Sidebar
        activePage={page}
        onNavigate={setPage}
        status={status}
        isError={isError}
        isLoading={isLoading}
      />
      <div className="flex-1 p-3 flex h-screen flex-col overflow-hidden relative">
      <main className="flex-1 main-panel rounded-lg flex flex-col overflow-hidden relative">
        <AnimatePresence mode="wait">
          {page === 'transcripts' && (
            <motion.div
              key="transcripts"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              <HomePage
                entries={entries}
                totalWords={totalWords}
                onCopy={copy}
                onDelete={deleteEntry}
                hotkey={appConfig.config.hotkey}
                missingMic={!mic}
                missingAccessibility={!accessibility}
                onGoToSettings={() => setPage('settings')}
                onGoToDashboard={() => setPage('dashboard')}
              />
            </motion.div>
          )}
          {page === 'dashboard' && (
            <motion.div
              key="dashboard"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              <DashboardPage />
            </motion.div>
          )}
          {page === 'audiobooks' && (
            <motion.div
              key="audiobooks"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              <AudiobookPage onNavigateModels={() => setPage('models')} />
            </motion.div>
          )}
          {page === 'models' && (
            <motion.div
              key="models"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              <ModelsPage
                config={appConfig.config}
                setModel={appConfig.setModel}
                setGrammarEnabled={appConfig.setGrammarEnabled}
                setTranslationEnabled={appConfig.setTranslationEnabled}
                setTranslationLanguage={appConfig.setTranslationLanguage}
                setTranscriptionEngine={appConfig.setTranscriptionEngine}
              />
            </motion.div>
          )}
          {page === 'snippets' && (
            <motion.div
              key="snippets"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              <SnippetsPage />
            </motion.div>
          )}
          {page === 'dictionary' && (
            <motion.div
              key="dictionary"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              <DictionaryPage />
            </motion.div>
          )}
          {page === 'settings' && (
            <motion.div
              key="settings"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              <SettingsPage
                visible={page === 'settings'}
                config={appConfig.config}
                setTheme={appConfig.setTheme}
                refreshConfig={appConfig.refresh}
                onClearHistory={clearHistory}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      </div>

      {/* Restart required dialog — shown once when accessibility is granted post-launch */}
      <Dialog open={needsRestart} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-[320px] p-0 overflow-hidden border-border/60"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-col items-center gap-4 p-6">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Power className="w-6 h-6 text-primary" strokeWidth={1.8} />
            </div>
            <div className="text-center">
              <DialogTitle className="text-base font-semibold">Restart required</DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                Accessibility was granted — a restart is needed for the hotkey to become active.
              </p>
            </div>
            <div className="w-full flex flex-col gap-2">
              <button
                onClick={restartApp}
                className="w-full h-9 rounded-xl bg-primary text-primary-foreground text-[13px] font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2.5} />
                Restart Tellaflow
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
